const express = require('express');
const cors = require('cors');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  CHANNEL_ALERT_INTERVAL_MS,
  CONTROL_ACTIONS,
  DEFAULT_LOG_MUTE_RULES,
  ERR_LOG_PATH,
  HOST,
  LOG_MUTE_RULES_PATH,
  LOG_PATH,
  OPENCLAW_BIN,
  OPENCLAW_CONFIG_PATH,
  PORT,
  TOKEN_PATH,
  WATCHDOG_INTERVAL_MS
} = require('./src/server/config');
const {
  ensureParentDir,
  readJsonFile,
  readTail
} = require('./src/server/runtime');
const { attachRealtimeServer } = require('./src/server/realtime');
const { buildMarkdownReport, buildSupportBundle } = require('./src/server/reports');
const { buildTimeline } = require('./src/server/timeline');
const { createAuthService } = require('./src/server/auth-service');
const { createChannelService } = require('./src/server/channel-service');
const { createGatewayService } = require('./src/server/gateway-service');
const { createMetricsService } = require('./src/server/metrics-service');
const { createOfficialDashboardService } = require('./src/server/official-dashboard-service');
const { createUpdateService } = require('./src/server/update-service');
const { redactSensitiveText } = require('./src/server/redaction');
const {
  buildVersionSourcesHealth,
  getLatestReleaseInfo,
  getLocalVersion,
  getLocalVersionStatus,
  isVersionGreater,
  parseVersion
} = require('./src/server/version-service');
const {
  buildCompatibilityReport,
  buildConfigHealth,
  createDiagnosticsService,
  getCachedOpenClawChannelProbe,
  getCurrentModelInfo,
  getFeishuCredentials,
  runCommandCheck
} = require('./src/server/diagnostics-service');
const { registerAuthRoutes } = require('./src/server/routes/auth');
const { registerChannelRoutes } = require('./src/server/routes/channels');
const { registerDiagnosticsRoutes } = require('./src/server/routes/diagnostics');
const { registerGatewayRoutes } = require('./src/server/routes/gateway');
const { registerLogRoutes } = require('./src/server/routes/logs');
const { registerMetricsRoutes } = require('./src/server/routes/metrics');
const { registerProductRoutes } = require('./src/server/routes/product');
const { registerReportRoutes } = require('./src/server/routes/reports');
const { registerUpdateRoutes } = require('./src/server/routes/updates');
const { registerVersionRoutes } = require('./src/server/routes/version');

const app = express();
const authService = createAuthService();
const gatewayService = createGatewayService();
const officialDashboardService = createOfficialDashboardService();
const { getOfficialDashboardStatus } = officialDashboardService;
const {
  appendAudit,
  clearSessionCookie,
  isLocalRequest,
  isValidDashboardToken,
  isValidSessionToken,
  parseCookies,
  readAuditEntries,
  sessionCookie,
  setSessionCookie
} = authService;
const {
  assertOpenClawAvailable,
  checkGatewayStatus,
  getGatewayProcesses,
  initializeWatchdogState,
  runGatewayControl,
  runWatchdogCheck,
  sendMacOSAlert
} = gatewayService;

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});
app.use(authService.requireApiAuth);
app.use(express.static(path.join(__dirname, 'public'), { etag: false, lastModified: false, cacheControl: false, maxAge: 0 }));

function loadLogMuteRules () {
  const saved = readJsonFile(LOG_MUTE_RULES_PATH);
  const savedRules = Array.isArray(saved?.rules) ? saved.rules : [];
  const byId = new Map(savedRules.map((rule) => [rule.id, rule]));
  return DEFAULT_LOG_MUTE_RULES.map((rule) => ({ ...rule, enabled: byId.has(rule.id) ? Boolean(byId.get(rule.id).enabled) : rule.enabled }));
}

function persistLogMuteRules (rules) {
  ensureParentDir(LOG_MUTE_RULES_PATH);
  fs.writeFileSync(LOG_MUTE_RULES_PATH, `${JSON.stringify({ rules, updatedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
}

function getActiveLogMuteRules () {
  return loadLogMuteRules().filter((rule) => rule.enabled);
}

function matchesMutedLogRule (line, rules = getActiveLogMuteRules()) {
  const text = String(line || '');
  return rules.find((rule) => {
    try {
      return new RegExp(rule.pattern, 'i').test(text);
    } catch {
      return false;
    }
  }) || null;
}

function extractTimestamp (line) {
  if (!line) return null;
  const match = line.match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})/);
  return match ? match[1] : null;
}

const channelService = createChannelService({
  getCachedOpenClawChannelProbe,
  getFeishuCredentials,
  matchesMutedLogRule,
  sendMacOSAlert
});
const {
  checkChannelsStatus,
  getChannelHealth,
  getChannelMessageStats,
  inferLatestChannelStatus,
  runChannelWatchdogCheck,
  verifyChannel
} = channelService;

const { buildDiagnostics } = createDiagnosticsService({
  checkChannelsStatus,
  getGatewayProcesses,
  getLatestReleaseInfo,
  getLocalVersion,
  isVersionGreater,
  parseVersion
});

async function readRecentErrorEntries (maxLines = 1000, maxResults = 10) {
  const result = await readRecentErrorEntriesWithMeta(maxLines, maxResults);
  return result.errors;
}

async function readRecentErrorEntriesWithMeta (maxLines = 1000, maxResults = 10) {
  const pattern = /error|failed|fail|timeout|unauthorized|denied|crash|exception|degraded|fatal/i;
  const muteRules = getActiveLogMuteRules();
  let mutedCount = 0;
  async function readErrorLines (filePath) {
    const stdout = await readTail(filePath, maxLines);
    if (!stdout.trim()) return [];

    const matches = [];
    for (const line of stdout.split('\n')) {
      if (!pattern.test(line)) continue;
      const mutedBy = matchesMutedLogRule(line, muteRules);
      if (mutedBy) {
        mutedCount++;
        continue;
      }
      matches.push({ timestamp: extractTimestamp(line), source: path.basename(filePath), message: redactSensitiveText(line.trim()).slice(0, 500) });
    }
    return matches;
  }

  const errors = [...(await readErrorLines(LOG_PATH)), ...(await readErrorLines(ERR_LOG_PATH))]
    .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
    .slice(0, maxResults);
  return { errors, mutedCount, activeRules: muteRules };
}

function fileCheck (name, filePath, options = {}) {
  const exists = fs.existsSync(filePath);
  let readable = false;
  if (exists) {
    try {
      fs.accessSync(filePath, fs.constants.R_OK);
      readable = true;
    } catch {}
  }
  return {
    name,
    ok: options.optional ? true : Boolean(exists && readable),
    exists,
    readable,
    path: filePath,
    detail: exists ? (readable ? 'Readable' : 'Exists but not readable') : (options.optional ? 'Not found, optional' : 'Not found')
  };
}

async function buildSetupStatus () {
  const gatewayRunning = await checkGatewayStatus();
  const launchAgentPath = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.openclaw.dashboard.plist');
  const cliCheck = await runCommandCheck('OpenClaw CLI', OPENCLAW_BIN, ['--version'], 5000);
  const remoteMode = !['127.0.0.1', 'localhost', '::1'].includes(HOST);
  const checks = [
    { name: 'OpenClaw CLI', ok: cliCheck.ok, detail: cliCheck.ok ? cliCheck.output : (cliCheck.error || 'OpenClaw CLI was not detected.') },
    { name: 'Gateway Status', ok: gatewayRunning, detail: gatewayRunning ? 'Gateway is running.' : 'Gateway is not running; start it from the control panel.' },
    fileCheck('Gateway Log Path', LOG_PATH),
    fileCheck('Error Log Path', ERR_LOG_PATH, { optional: true }),
    fileCheck('OpenClaw Config File', OPENCLAW_CONFIG_PATH),
    fileCheck('Dashboard Access Token', TOKEN_PATH),
    fileCheck('macOS LaunchAgent', launchAgentPath, { optional: true }),
    {
      name: 'Access Mode',
      ok: !remoteMode,
      detail: remoteMode ? `Listening on ${HOST}; use only on trusted LANs.` : 'Local-only access, safe by default.'
    }
  ];
  const required = checks.filter((check) => !['macOS LaunchAgent', 'Error Log Path'].includes(check.name));
  const passed = required.filter((check) => check.ok).length;
  return {
    ok: passed === required.length,
    passed,
    required: required.length,
    checks,
    host: HOST,
    port: PORT,
    remoteMode,
    collectedAt: new Date().toISOString()
  };
}

async function buildHealthSummary () {
  const [metrics, errors] = await Promise.all([
    buildMetrics(),
    readRecentErrorEntriesWithMeta(1000, 10)
  ]);
  let score = 100;
  const checks = [];

  function addCheck (name, ok, detail, penalty) {
    checks.push({ name, ok, detail, penalty: ok ? 0 : penalty });
    if (!ok) score -= penalty;
  }

  addCheck('Gateway', metrics.gateway.isRunning, metrics.gateway.isRunning ? `PID ${metrics.gateway.pid || '-'}` : 'Gateway process was not detected.', 35);
  const channelItems = Array.isArray(metrics.channelItems) && metrics.channelItems.length ? metrics.channelItems : Object.entries(metrics.channels || {}).map(([id, value]) => ({ id, ...value }));
  const channelPenalty = channelItems.length ? Math.max(5, Math.floor(30 / channelItems.length)) : 0;
  for (const channel of channelItems) {
    addCheck(`${channel.label || channel.id} Channel`, channel.status === 'online', channel.reason || channel.status, channelPenalty);
  }
  addCheck('Disk Space', Number(metrics.disk.usedPercent || 0) < 90, `Used ${metrics.disk.usedPercent ?? '-'}%`, Number(metrics.disk.usedPercent || 0) > 75 ? 10 : 5);
  addCheck('Version Status', !metrics.version.updateAvailable, metrics.version.updateAvailable ? `${metrics.version.local} → ${metrics.version.latest}` : 'No update detected for the current version.', 5);

  const errorPenalty = Math.min(20, errors.errors.length * 3);
  if (errorPenalty) score -= errorPenalty;
  checks.push({
    name: 'Recent Error Logs',
    ok: errors.errors.length === 0,
    detail: errors.errors.length ? `${errors.errors.length} unmuted errors, ${errors.mutedCount} muted.` : `${errors.mutedCount} muted, no unhandled errors.`,
    penalty: errorPenalty
  });

  score = Math.max(0, Math.min(100, score));
  const level = score >= 90 ? 'excellent' : score >= 75 ? 'good' : score >= 60 ? 'attention' : 'critical';
  const summary = score >= 90
    ? 'Today looks stable. You can use OpenClaw with confidence.'
    : score >= 75
      ? 'Core functions are available, with a few items worth checking.'
      : score >= 60
        ? 'Some risks may affect the experience; handle the yellow items first.'
        : 'The core path has clear issues; check it immediately.';

  return { score, level, summary, checks, collectedAt: new Date().toISOString() };
}

async function buildTroubleshootingGuide () {
  const [metrics, officialDashboard, diagnostics, errors] = await Promise.all([
    buildMetrics(),
    getOfficialDashboardStatus(),
    buildDiagnostics(),
    readRecentErrorEntriesWithMeta(1000, 5)
  ]);
  const steps = [];
  const channelItems = Array.isArray(metrics.channelItems) ? metrics.channelItems : [];
  const offlineChannels = channelItems.filter((channel) => channel.status !== 'online');

  if (!metrics.gateway?.isRunning) {
    steps.push({
      level: 'critical',
      title: 'Restore the Gateway process first',
      detail: 'The dashboard can still export reports. Next, click Start in Gateway Control; if it fails, check Recent Error Logs and `openclaw doctor`.'
    });
  } else if (!officialDashboard.reachable) {
    steps.push({
      level: 'warning',
      title: 'Gateway is running, but the official Control UI is unreachable',
      detail: `Check ${officialDashboard.url}, port ${process.env.OPENCLAW_GATEWAY_PORT || '18789'}, gateway.controlUi.basePath, or official Dashboard auth config.`
    });
  } else if (!officialDashboard.auth?.configured) {
    steps.push({
      level: 'info',
      title: 'Official Control UI is reachable, but no explicit auth config was found',
      detail: 'If the official UI shows unauthorized / 1008, run `openclaw doctor --generate-gateway-token` or check `gateway.auth.token/password`.'
    });
  } else {
    steps.push({
      level: 'ok',
      title: 'Official Control UI can be used as the operation surface',
      detail: 'OpenClaw Dash handles diagnostics and report export. Use the official Control UI for chat, official settings, and Gateway-native capabilities.'
    });
  }

  if (offlineChannels.length) {
    steps.push({
      level: 'warning',
      title: 'Handle offline channels',
      detail: `Offline channels: ${offlineChannels.map((channel) => channel.label || channel.id).join(', ')}. Check the confidence labels first; channels with direct verification can send end-to-end test messages.`
    });
  }

  if (metrics.version?.updateAvailable) {
    steps.push({
      level: 'info',
      title: 'Run preflight before updating',
      detail: `Detected ${metrics.version.latest || 'a new version'}. Check update preflight first, then confirm disk, CLI compatibility, Gateway state, and channel probes before updating.`
    });
  }

  if (errors.errors.length) {
    steps.push({
      level: 'warning',
      title: 'Ask for help with an error summary',
      detail: `Found ${errors.errors.length} unmuted errors. The support bundle is automatically redacted and safe to paste into the community.`
    });
  }

  if (!steps.some((step) => ['critical', 'warning'].includes(step.level))) {
    steps.push({
      level: 'ok',
      title: 'Status is stable; keep this as an emergency tool',
      detail: 'No need to watch it all day. When something feels wrong, export a report first, then decide whether to open the official Control UI.'
    });
  }

  return {
    steps,
    officialDashboard,
    collectedAt: new Date().toISOString(),
    context: {
      gatewayRunning: Boolean(metrics.gateway?.isRunning),
      offlineChannels: offlineChannels.map((channel) => channel.id),
      recommendations: diagnostics.recommendations || []
    }
  };
}

const { buildMetrics } = createMetricsService({
  checkChannelsStatus,
  getCachedOpenClawChannelProbe,
  getChannelHealth,
  getChannelMessageStats,
  getCurrentModelInfo,
  getGatewayProcesses,
  getLatestReleaseInfo,
  getLocalVersion,
  isVersionGreater,
  parseVersion
});

const updateService = createUpdateService({
  appendAudit,
  buildCompatibilityReport,
  buildDiagnostics,
  getGatewayProcesses,
  getLatestReleaseInfo,
  getLocalVersion,
  isVersionGreater,
  parseVersion,
  runGatewayControl
});

registerAuthRoutes(app, {
  appendAudit,
  clearSessionCookie,
  isLocalRequest,
  isValidDashboardToken,
  isValidSessionToken,
  parseCookies,
  sessionCookie,
  setSessionCookie
});

registerGatewayRoutes(app, {
  appendAudit,
  checkGatewayStatus,
  controlActions: CONTROL_ACTIONS,
  runGatewayControl
});

registerChannelRoutes(app, {
  appendAudit,
  checkChannelsStatus,
  verifyChannel
});

registerVersionRoutes(app, {
  buildVersionSourcesHealth,
  getLatestReleaseInfo,
  getLocalVersionStatus
});

registerDiagnosticsRoutes(app, {
  appendAudit,
  buildCompatibilityReport,
  buildConfigHealth,
  buildDiagnostics,
  getCurrentModelInfo
});

registerUpdateRoutes(app, {
  appendAudit,
  assertOpenClawAvailable,
  buildUpdatePreflight: updateService.buildUpdatePreflight,
  checkGatewayStatus,
  getUpdateJob: updateService.getUpdateJob,
  resetUpdateJob: updateService.resetUpdateJob,
  runUpdateJob: updateService.runUpdateJob
});

registerMetricsRoutes(app, { buildMetrics });

registerProductRoutes(app, {
  buildHealthSummary,
  buildSetupStatus,
  buildTroubleshootingGuide,
  getOfficialDashboardStatus
});

registerLogRoutes(app, {
  appendAudit,
  buildTimeline: () => buildTimeline({
    checkChannelsStatus,
    checkGatewayStatus,
    getUpdateSteps: () => updateService.getUpdateJob().steps || [],
    readAuditEntries,
    readRecentErrorEntries
  }),
  loadLogMuteRules,
  persistLogMuteRules,
  readAuditEntries,
  readRecentErrorEntriesWithMeta
});

registerReportRoutes(app, {
  buildMarkdownReport: () => buildMarkdownReport({
    buildCompatibilityReport,
    buildConfigHealth,
    buildDiagnostics,
    buildHealthSummary,
    buildTroubleshootingGuide,
    buildMetrics,
    getOfficialDashboardStatus,
    readRecentErrorEntriesWithMeta
  }),
  buildSupportBundle: () => buildSupportBundle({
    buildCompatibilityReport,
    buildConfigHealth,
    buildDiagnostics,
    buildHealthSummary,
    buildTroubleshootingGuide,
    buildMetrics,
    getOfficialDashboardStatus,
    readRecentErrorEntriesWithMeta
  })
});

async function collectRealtimeSnapshot () {
  const [processes, channels] = await Promise.all([
    getGatewayProcesses(),
    checkChannelsStatus()
  ]);

  return {
    gateway: {
      isRunning: processes.length > 0,
      pids: processes.map((p) => p.pid)
    },
    channels,
    update: {
      running: updateService.getUpdateJob().running,
      status: updateService.getUpdateJob().status,
      message: updateService.getUpdateJob().message,
      finishedAt: updateService.getUpdateJob().finishedAt
    },
    collectedAt: new Date().toISOString()
  };
}

function startDashboard () {
  let watchdogTimer = null;
  let channelTimer = null;
  const httpServer = app.listen(PORT, HOST, async () => {
    console.log(`OpenClaw Dash is running at http://${HOST}:${PORT}`);
    if (!['127.0.0.1', 'localhost', '::1'].includes(HOST)) {
      console.warn(`[Security] Dashboard is listening on ${HOST}. Only expose it on trusted networks and keep the dashboard token private.`);
    }
    await initializeWatchdogState();
    runChannelWatchdogCheck();
    watchdogTimer = setInterval(runWatchdogCheck, WATCHDOG_INTERVAL_MS);
    channelTimer = setInterval(runChannelWatchdogCheck, CHANNEL_ALERT_INTERVAL_MS);
  });

  const realtime = attachRealtimeServer(httpServer, {
    collectSnapshot: collectRealtimeSnapshot,
    intervalMs: 5000,
    isValidSession: isValidSessionToken,
    isValidToken: isValidDashboardToken,
    parseCookies,
    sessionCookie
  });

  httpServer.on('close', () => {
    if (watchdogTimer) clearInterval(watchdogTimer);
    if (channelTimer) clearInterval(channelTimer);
    realtime.close();
  });

  return httpServer;
}

if (require.main === module) {
  startDashboard();
}

module.exports = {
  app,
  inferLatestChannelStatus,
  startDashboard,
  isValidDashboardToken,
  isValidSessionToken,
  maskableExportPatterns: [
    'ou_* / cli_* identifiers',
    'very long numeric identifiers',
    'IPv4 addresses',
    'PID values',
    '/Users/* paths'
  ]
};
