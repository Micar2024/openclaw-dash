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
    detail: exists ? (readable ? '可读' : '文件存在但不可读') : (options.optional ? '未找到，可选项' : '未找到')
  };
}

async function buildSetupStatus () {
  const gatewayRunning = await checkGatewayStatus();
  const launchAgentPath = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.openclaw.dashboard.plist');
  const cliCheck = await runCommandCheck('OpenClaw CLI', OPENCLAW_BIN, ['--version'], 5000);
  const remoteMode = !['127.0.0.1', 'localhost', '::1'].includes(HOST);
  const checks = [
    { name: 'OpenClaw CLI', ok: cliCheck.ok, detail: cliCheck.ok ? cliCheck.output : (cliCheck.error || '未检测到 OpenClaw CLI。') },
    { name: 'Gateway 状态', ok: gatewayRunning, detail: gatewayRunning ? 'Gateway 运行中。' : 'Gateway 未运行；请从 Gateway Control 启动。' },
    fileCheck('Gateway 日志路径', LOG_PATH),
    fileCheck('错误日志路径', ERR_LOG_PATH, { optional: true }),
    fileCheck('OpenClaw 配置文件', OPENCLAW_CONFIG_PATH),
    fileCheck('Dashboard Access Token', TOKEN_PATH),
    fileCheck('macOS LaunchAgent', launchAgentPath, { optional: true }),
    {
      name: '访问模式',
      ok: !remoteMode,
      detail: remoteMode ? `监听地址 ${HOST}；仅在可信局域网内使用。` : '本地访问模式，安全。'
    }
  ];
  const required = checks.filter((check) => !['macOS LaunchAgent', '错误日志路径'].includes(check.name));
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

  addCheck('Gateway', metrics.gateway.isRunning, metrics.gateway.isRunning ? `PID ${metrics.gateway.pid || '-'}` : 'Gateway 进程未检测到。', 35);
  const channelItems = Array.isArray(metrics.channelItems) && metrics.channelItems.length ? metrics.channelItems : Object.entries(metrics.channels || {}).map(([id, value]) => ({ id, ...value }));
  const channelPenalty = channelItems.length ? Math.max(5, Math.floor(30 / channelItems.length)) : 0;
  for (const channel of channelItems) {
    addCheck(`${channel.label || channel.id} Channel`, channel.status === 'online', channel.reason || channel.status, channelPenalty);
  }
  addCheck('磁盘空间', Number(metrics.disk.usedPercent || 0) < 90, `已用 ${metrics.disk.usedPercent ?? '-'}%`, Number(metrics.disk.usedPercent || 0) > 75 ? 10 : 5);
  addCheck('版本状态', !metrics.version.updateAvailable, metrics.version.updateAvailable ? `${metrics.version.local} → ${metrics.version.latest}` : '当前版本未检测到更新。', 5);

  const errorPenalty = Math.min(20, errors.errors.length * 3);
  if (errorPenalty) score -= errorPenalty;
  checks.push({
    name: '近期错误日志',
    ok: errors.errors.length === 0,
    detail: errors.errors.length ? `${errors.errors.length} 非静音错误，已静音 ${errors.mutedCount}。` : `已静音 ${errors.mutedCount}，无非未处理错误。`,
    penalty: errorPenalty
  });

  score = Math.max(0, Math.min(100, score));
  const level = score >= 90 ? 'excellent' : score >= 75 ? 'good' : score >= 60 ? 'attention' : 'critical';
  const summary = score >= 90
    ? '系统稳定，可放心使用 OpenClaw。'
    : score >= 75
      ? '核心功能可用，部分项目值得检查。'
      : score >= 60
        ? '部分风险可能影响体验，优先处理黄色项目。'
        : '核心路径存在明显问题，请立即检查。';

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
      title: '先恢复 Gateway 进程',
      detail: 'Dashboard 仍可导出报告。接下来点击 Gateway Control 中的「启动」；如果失败，请查看近期错误日志并运行 `openclaw doctor`。'
    });
  } else if (!officialDashboard.reachable) {
    steps.push({
      level: 'warning',
      title: 'Gateway 运行中，但 Official Dashboard 不可达',
      detail: `检查 Official Dashboard URL（${officialDashboard.url}）、端口（${process.env.OPENCLAW_GATEWAY_PORT || '18789'}）、gateway.controlUi.basePath 或 Official Dashboard 认证配置。`
    });
  } else if (!officialDashboard.auth?.configured) {
    steps.push({
      level: 'info',
      title: 'Official Dashboard 可达，但未检测到显式认证配置',
      detail: '如果官方 UI 显示 unauthorized / 1008，请运行 `openclaw doctor --generate-gateway-token` 或检查 gateway.auth.token/password。'
    });
  } else {
    steps.push({
      level: 'ok',
      title: 'Official Dashboard 可作为操作界面',
      detail: 'OpenClaw Dash 负责 diagnostics 和 report export。日常聊天、官方设置和 Gateway 原生操作请使用 Official Dashboard。'
    });
  }

  if (offlineChannels.length) {
    steps.push({
      level: 'warning',
      title: '处理离线 Channels',
      detail: `离线 channels：${offlineChannels.map((channel) => channel.label || channel.id).join(', ')}。请先查看 confidence 标签；支持 direct verify 的 channel 可发送端到端测试消息。`
    });
  }

  if (metrics.version?.updateAvailable) {
    steps.push({
      level: 'info',
      title: '更新前运行预检',
      detail: `检测到新版本 ${metrics.version.latest || '未知版本'}。请先运行 update preflight，然后确认磁盘、CLI 兼容性、Gateway 状态和 channel probe 后再执行更新。`
    });
  }

  if (errors.errors.length) {
    steps.push({
      level: 'warning',
      title: '求助时附带错误摘要',
      detail: `发现 ${errors.errors.length} 条非静音错误。Bundle 已自动脱敏，可安全粘贴到社区求助。`
    });
  }

  if (!steps.some((step) => ['critical', 'warning'].includes(step.level))) {
    steps.push({
      level: 'ok',
      title: '系统稳定，Dashboard 作为应急工具备用',
      detail: '无需全天候盯着。发现异常时请先导出 report，再决定是否打开 Official Dashboard。'
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
