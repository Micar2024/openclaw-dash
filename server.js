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
    detail: exists ? (readable ? '可读取' : '存在但不可读取') : (options.optional ? '未发现，可选项' : '未发现')
  };
}

async function buildSetupStatus () {
  const gatewayRunning = await checkGatewayStatus();
  const launchAgentPath = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.openclaw.dashboard.plist');
  const cliCheck = await runCommandCheck('OpenClaw CLI', OPENCLAW_BIN, ['--version'], 5000);
  const remoteMode = !['127.0.0.1', 'localhost', '::1'].includes(HOST);
  const checks = [
    { name: 'OpenClaw CLI', ok: cliCheck.ok, detail: cliCheck.ok ? cliCheck.output : (cliCheck.error || '未检测到 OpenClaw CLI。') },
    { name: 'Gateway 当前状态', ok: gatewayRunning, detail: gatewayRunning ? 'Gateway 正在运行。' : 'Gateway 未运行，可在控制面板启动。' },
    fileCheck('Gateway 日志路径', LOG_PATH),
    fileCheck('错误日志路径', ERR_LOG_PATH, { optional: true }),
    fileCheck('OpenClaw 配置文件', OPENCLAW_CONFIG_PATH),
    fileCheck('Dashboard 访问口令', TOKEN_PATH),
    fileCheck('macOS LaunchAgent', launchAgentPath, { optional: true }),
    {
      name: '访问模式',
      ok: !remoteMode,
      detail: remoteMode ? `当前监听 ${HOST}，请确认只在可信局域网使用。` : '仅本机访问，默认安全。'
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

  addCheck('Gateway', metrics.gateway.isRunning, metrics.gateway.isRunning ? `PID ${metrics.gateway.pid || '-'}` : '未检测到 Gateway 进程。', 35);
  const channelItems = Array.isArray(metrics.channelItems) && metrics.channelItems.length ? metrics.channelItems : Object.entries(metrics.channels || {}).map(([id, value]) => ({ id, ...value }));
  const channelPenalty = channelItems.length ? Math.max(5, Math.floor(30 / channelItems.length)) : 0;
  for (const channel of channelItems) {
    addCheck(`${channel.label || channel.id}通道`, channel.status === 'online', channel.reason || channel.status, channelPenalty);
  }
  addCheck('磁盘空间', Number(metrics.disk.usedPercent || 0) < 90, `已用 ${metrics.disk.usedPercent ?? '-'}%`, Number(metrics.disk.usedPercent || 0) > 75 ? 10 : 5);
  addCheck('版本状态', !metrics.version.updateAvailable, metrics.version.updateAvailable ? `${metrics.version.local} → ${metrics.version.latest}` : '当前版本未发现更新。', 5);

  const errorPenalty = Math.min(20, errors.errors.length * 3);
  if (errorPenalty) score -= errorPenalty;
  checks.push({
    name: '近期错误日志',
    ok: errors.errors.length === 0,
    detail: errors.errors.length ? `${errors.errors.length} 条未静音错误，${errors.mutedCount} 条已静音。` : `${errors.mutedCount} 条已静音，无未处理错误。`,
    penalty: errorPenalty
  });

  score = Math.max(0, Math.min(100, score));
  const level = score >= 90 ? 'excellent' : score >= 75 ? 'good' : score >= 60 ? 'attention' : 'critical';
  const summary = score >= 90
    ? '今日状态稳定，可以放心使用。'
    : score >= 75
      ? '核心功能可用，但有少量项目值得关注。'
      : score >= 60
        ? '存在影响体验的风险，建议先处理黄色项。'
        : '核心链路存在明显异常，建议立即检查。';

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
      detail: '本看板仍可导出报告；下一步点击 Gateway 运行控制的「启动」，失败时查看最近错误日志和 openclaw doctor。'
    });
  } else if (!officialDashboard.reachable) {
    steps.push({
      level: 'warning',
      title: 'Gateway 在运行，但官方 Control UI 不可达',
      detail: `检查 ${officialDashboard.url}、端口 ${process.env.OPENCLAW_GATEWAY_PORT || '18789'}、gateway.controlUi.basePath 或官方 Dashboard 鉴权配置。`
    });
  } else if (!officialDashboard.auth?.configured) {
    steps.push({
      level: 'info',
      title: '官方 Control UI 可达，但未发现显式 auth 配置',
      detail: '如果官方 UI 出现 unauthorized / 1008，运行 openclaw doctor --generate-gateway-token 或检查 gateway.auth.token/password。'
    });
  } else {
    steps.push({
      level: 'ok',
      title: '官方 Control UI 可作为操作入口',
      detail: 'OpenClaw Dash 负责诊断和导出报告；需要聊天、官方设置或 Gateway 原生能力时，打开官方 Control UI。'
    });
  }

  if (offlineChannels.length) {
    steps.push({
      level: 'warning',
      title: '处理离线通道',
      detail: `离线通道：${offlineChannels.map((channel) => channel.label || channel.id).join('、')}。先看可信度标签；支持真实验证的通道可发送端到端测试消息。`
    });
  }

  if (metrics.version?.updateAvailable) {
    steps.push({
      level: 'info',
      title: '升级前先预检',
      detail: `检测到 ${metrics.version.latest || '新版本'}。先查看升级前预检，确认磁盘、CLI 兼容性、Gateway 状态和通道探针再更新。`
    });
  }

  if (errors.errors.length) {
    steps.push({
      level: 'warning',
      title: '带着错误摘要求助',
      detail: `发现 ${errors.errors.length} 条未静音错误。导出求助包会自动脱敏，适合直接贴到社区。`
    });
  }

  if (!steps.some((step) => ['critical', 'warning'].includes(step.level))) {
    steps.push({
      level: 'ok',
      title: '状态稳定，保留为应急工具',
      detail: '没事时不用盯着看；遇到异常时先导出报告，再决定是否打开官方 Control UI 操作。'
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
    'long numeric identifiers',
    'IPv4 addresses',
    'PID values',
    '/Users/* paths'
  ]
};
