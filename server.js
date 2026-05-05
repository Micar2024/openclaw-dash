const express = require('express');
const axios = require('axios');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const path = require('path');
const {
  AUDIT_LOG_PATH,
  CHANNEL_ALERT_AFTER_MS,
  CHANNEL_ALERT_INTERVAL_MS,
  CHANNEL_STATS_TAIL_LINES,
  CONTROL_ACTIONS,
  DASHBOARD_PATH,
  DEFAULT_LOG_MUTE_RULES,
  ERR_LOG_PATH,
  HOST,
  LOG_MUTE_RULES_PATH,
  LOG_PATH,
  OPENCLAW_BIN,
  OPENCLAW_CONFIG_PATH,
  PORT,
  SESSION_COOKIE,
  SESSION_MAX_AGE_MS,
  TOKEN_PATH,
  WATCHDOG_INTERVAL_MS
} = require('./src/server/config');
const {
  ensureParentDir,
  readJsonFile,
  readTail
} = require('./src/server/runtime');
const { attachRealtimeServer } = require('./src/server/realtime');
const { buildMarkdownReport } = require('./src/server/reports');
const { buildTimeline } = require('./src/server/timeline');
const { createMetricsService } = require('./src/server/metrics-service');
const { createUpdateService } = require('./src/server/update-service');
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
const DASHBOARD_TOKEN = resolveDashboardToken();
let wasRunning = null;
const channelAlertState = {
  feishu: { initialized: false, offlineSince: null, alerted: false },
  telegram: { initialized: false, offlineSince: null, alerted: false }
};

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) {
    next();
    return;
  }
  if (req.path.startsWith('/api/auth/')) {
    next();
    return;
  }

  const header = req.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  if (isValidDashboardToken(token) || isValidSessionToken(parseCookies(req)[SESSION_COOKIE])) {
    next();
    return;
  }

  res.status(401).json({ error: 'Unauthorized' });
});
app.use(express.static(path.join(__dirname, 'public'), { etag: false, lastModified: false, cacheControl: false, maxAge: 0 }));

function resolveDashboardToken () {
  const envToken = (process.env.DASHBOARD_TOKEN || '').trim();
  if (envToken) return envToken;

  try {
    if (fs.existsSync(TOKEN_PATH)) {
      const fileToken = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
      if (fileToken) return fileToken;
    }

    ensureParentDir(TOKEN_PATH);
    const generatedToken = crypto.randomBytes(24).toString('base64url');
    fs.writeFileSync(TOKEN_PATH, `${generatedToken}\n`, { mode: 0o600 });
    console.log(`[Auth] 首次启动，已生成访问令牌并写入 ${TOKEN_PATH}`);
    return generatedToken;
  } catch (error) {
    console.error('[Auth] 访问口令文件初始化失败:', error.message);
    return crypto.randomBytes(24).toString('base64url');
  }
}

function isValidDashboardToken (token) {
  if (!token) return false;

  try {
    const expected = Buffer.from(DASHBOARD_TOKEN);
    const actual = Buffer.from(String(token).trim());
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function parseCookies (req) {
  const header = req.headers.cookie || '';
  return header.split(';').reduce((cookies, item) => {
    const index = item.indexOf('=');
    if (index === -1) return cookies;
    const key = item.slice(0, index).trim();
    const value = item.slice(index + 1).trim();
    cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function signSession (issuedAt) {
  return crypto.createHmac('sha256', DASHBOARD_TOKEN).update(String(issuedAt)).digest('hex');
}

function createSessionToken () {
  const issuedAt = Date.now();
  return `${issuedAt}.${signSession(issuedAt)}`;
}

function isValidSessionToken (sessionToken) {
  if (!sessionToken || !sessionToken.includes('.')) return false;

  const [issuedAtText, signature] = sessionToken.split('.');
  const issuedAt = Number(issuedAtText);
  if (!issuedAt || Date.now() - issuedAt > SESSION_MAX_AGE_MS) return false;

  const expected = signSession(issuedAt);
  try {
    const actual = Buffer.from(signature || '');
    const wanted = Buffer.from(expected);
    return actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted);
  } catch {
    return false;
  }
}

function setSessionCookie (res) {
  const token = createSessionToken();
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}; HttpOnly; SameSite=Lax`);
}

function clearSessionCookie (res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
}

function isLocalRequest (req) {
  const address = req.socket?.remoteAddress || req.ip || '';
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
}

function appendAudit (req, action, success, detail = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    action,
    success: Boolean(success),
    ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip || 'unknown',
    userAgent: req.get('User-Agent') || '',
    detail
  };

  try {
    ensureParentDir(AUDIT_LOG_PATH);
    fs.appendFile(AUDIT_LOG_PATH, `${JSON.stringify(entry)}\n`, () => {});
  } catch (error) {
    console.error('[Audit] 写入失败:', error.message);
  }
}

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

function extractDateFromLogLine (line) {
  if (!line) return null;
  const match = line.match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/);
  if (!match) return null;
  const normalized = match[1].replace(' ', 'T');
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function lineMatchesAnyKeyword (line, keywords) {
  const lower = String(line || '').toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword));
}

function getChannelKeywords (channel) {
  if (channel === 'feishu') return ['feishu', 'lark', '飞书'];
  if (channel === 'telegram') return ['telegram', 'tg'];
  return [channel];
}

function isChannelRelatedLine (channel, line) {
  const lower = String(line || '').toLowerCase();
  if (lineMatchesAnyKeyword(lower, getChannelKeywords(channel))) return true;

  if (channel === 'feishu') {
    return lower.includes('[ws]') ||
      lower.includes('openclaw_bot/ping') ||
      lower.includes('persistent connection') ||
      lower.includes('connect failed');
  }

  return false;
}

function explainChannelStatus (channel, status, lastSignalLine, lastErrorLine) {
  if (lastErrorLine && status === 'offline') {
    if (/status code 400/i.test(lastErrorLine)) return '最近检测到连接请求返回 400，通道可能未完成升级后的配置适配。';
    if (/connect failed|unable to connect/i.test(lastErrorLine)) return '最近检测到连接失败。';
    return '最近错误日志晚于连接日志。';
  }

  if (lastSignalLine && status === 'online') return '最近健康信号晚于错误信号。';
  return '未检测到可证明通道在线的近期健康信号。';
}

function maxProbeTimestamp (...values) {
  const timestamps = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!timestamps.length) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}

function deriveChannelHealthFromProbe (channel, probe) {
  if (!probe?.ok) return null;

  const channelProbe = probe.channels?.[channel] || {};
  const accounts = Array.isArray(probe.channelAccounts?.[channel]) ? probe.channelAccounts[channel] : [];
  const account = accounts.find((item) => item.connected || item.probe?.ok || item.running) || accounts[0] || {};
  const configured = channelProbe.configured !== false && account.configured !== false;
  const running = Boolean(channelProbe.running ?? account.running);
  const probeOk = Boolean(channelProbe.probe?.ok || account.probe?.ok);
  const connected = Boolean(channelProbe.connected || account.connected);
  const lastSeenAt = maxProbeTimestamp(
    channelProbe.lastProbeAt,
    channelProbe.lastStartAt,
    channelProbe.lastConnectedAt,
    channelProbe.lastTransportActivityAt,
    channelProbe.lastInboundAt,
    channelProbe.lastOutboundAt,
    account.lastProbeAt,
    account.lastStartAt,
    account.lastConnectedAt,
    account.lastTransportActivityAt,
    account.lastInboundAt,
    account.lastOutboundAt
  );
  const lastError = channelProbe.lastError || account.lastError || null;
  const status = configured && (probeOk || connected || running) ? 'online' : 'offline';

  return {
    status,
    lastSeenAt,
    lastSignalAt: status === 'online' ? lastSeenAt : null,
    lastErrorAt: null,
    lastError,
    reason: status === 'online'
      ? `OpenClaw CLI 探针确认 ${channel === 'telegram' ? 'Telegram' : '飞书'} ${probeOk ? 'probe.ok' : connected ? 'connected' : 'running'}。`
      : (configured ? (lastError || 'OpenClaw CLI 探针未确认通道在线。') : 'OpenClaw CLI 显示通道未配置。')
  };
}

function mergeChannelHealth (logHealth, probeHealth) {
  if (!probeHealth) return logHealth;
  if (probeHealth.status === 'online') {
    return {
      ...logHealth,
      status: 'online',
      lastSeenAt: probeHealth.lastSeenAt || logHealth.lastSeenAt,
      lastSignalAt: probeHealth.lastSignalAt || logHealth.lastSignalAt,
      lastErrorAt: logHealth.lastErrorAt,
      lastError: logHealth.lastError || probeHealth.lastError,
      reason: probeHealth.reason
    };
  }
  if (logHealth.status === 'online') return logHealth;
  return {
    ...logHealth,
    lastSeenAt: logHealth.lastSeenAt || probeHealth.lastSeenAt,
    lastError: logHealth.lastError || probeHealth.lastError,
    reason: probeHealth.reason || logHealth.reason
  };
}

async function getChannelHealth (channel, probe = null) {
  const content = await readTail(LOG_PATH, CHANNEL_STATS_TAIL_LINES);
  const related = content.split(/\r?\n/).filter((line) => isChannelRelatedLine(channel, line));
  const positivePattern = /(^|[^a-z0-9])(connected|online|success|running|started|active|login|logged\s*in|ready|authenticated|received|message|reaction|event|dispatch(?:ing)?|provider|register(?:ed|ing)?|command|menu|listening)(?=$|[^a-z0-9])/i;
  const negativePattern = /(^|[^a-z0-9])(error|failed|fail|connect failed|status code 400|disconnected|disconnect|offline|stopped|closed|timeout|unauthorized|denied|crash(?:ed)?|unknown|unable to connect)(?=$|[^a-z0-9])/i;
  let lastSignalLine = '';
  let lastSignalAt = null;
  let lastErrorLine = '';
  let lastErrorAt = null;
  let lastSeenAt = null;

  for (const line of related) {
    const at = extractTimestamp(line);
    if (at) lastSeenAt = at;

    if (negativePattern.test(line)) {
      lastErrorLine = line.trim();
      lastErrorAt = at || lastSeenAt;
      continue;
    }

    if (positivePattern.test(line) && !/resolved:\s*unknown/i.test(line)) {
      lastSignalLine = line.trim();
      lastSignalAt = at || lastSeenAt;
    }
  }

  const errorIsLater = lastErrorLine && (!lastSignalLine || String(lastErrorAt || '') >= String(lastSignalAt || ''));
  const status = lastSignalLine && !errorIsLater ? 'online' : 'offline';

  const logHealth = {
    status,
    lastSeenAt: lastSeenAt || lastSignalAt || lastErrorAt || null,
    lastSignalAt,
    lastErrorAt,
    lastError: lastErrorLine ? lastErrorLine.slice(0, 500) : null,
    reason: explainChannelStatus(channel, status, lastSignalLine, lastErrorLine)
  };
  return mergeChannelHealth(logHealth, deriveChannelHealthFromProbe(channel, probe));
}

async function getChannelMessageStats (channel) {
  const content = await readTail(LOG_PATH, CHANNEL_STATS_TAIL_LINES);
  const lines = content.split(/\r?\n/).filter(Boolean);
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const messagePattern = /(^|[^a-z])(message|msg|received|send|sent|dispatch|event|reaction|chat|callback|update)(?=$|[^a-z])/i;
  const errorPattern = /(^|[^a-z])(error|failed|fail|timeout|unauthorized|denied|crash|exception|fatal|disconnected|offline)(?=$|[^a-z])/i;
  let todayMessages = 0;
  let lastHourMessages = 0;
  let errorCount = 0;

  for (const line of lines) {
    if (!isChannelRelatedLine(channel, line)) continue;

    const at = extractDateFromLogLine(line);
    const hasMessage = messagePattern.test(line);
    const hasError = errorPattern.test(line);

    if (hasError && !matchesMutedLogRule(line)) errorCount++;
    if (!at || !hasMessage || hasError) continue;
    if (at >= todayStart) todayMessages++;
    if (at >= oneHourAgo) lastHourMessages++;
  }

  return { todayMessages, lastHourMessages, errorCount, windowLines: lines.length };
}

function checkGatewayStatus () {
  return getGatewayProcesses().then((processes) => processes.length > 0);
}

function getGatewayProcesses () {
  return new Promise((resolve) => {
    execFile('ps', ['ax', '-o', 'pid=,command='], { timeout: 5000 }, (error, stdout) => {
      if (error || !stdout.trim()) { resolve([]); return; }
      const processes = stdout.split(/\r?\n/)
        .map((line) => { const match = line.trim().match(/^(\d+)\s+(.+)$/); return match ? { pid: Number(match[1]), command: match[2] } : null; })
        .filter(Boolean)
        .filter(({ pid, command }) => {
          const cmd = command.toLowerCase();
          return pid !== process.pid && (/\/openclaw\/dist\/index\.js\s+gateway\b/.test(cmd) || /\/openclaw(?:\.mjs)?\s+gateway\b/.test(cmd));
        });
      resolve(processes);
    });
  });
}

function inferLatestChannelStatus (line) {
  if (!line || !line.trim()) return 'offline';
  const norm = line.trim().toLowerCase();
  const pos = /(^|[^a-z0-9])(connected|online|success|resolved|running|start(?:ed|ing)?|active|login|logged\s*in|ready|authenticated|received|message|reaction|event|dispatch(?:ing)?|provider|register(?:ed|ing)?|command|menu|immediate)(?=$|[^a-z0-9])/gi;
  const neg = /(^|[^a-z0-9])(error|failed|fail|disconnected|disconnect|offline|stopped|closed|timeout|unauthorized|denied|crash(?:ed)?)(?=$|[^a-z0-9])/gi;
  function lastIdx (p) { let i = -1; let m; while ((m = p.exec(norm)) !== null) i = m.index + m[1].length; return i; }
  const lp = lastIdx(pos); const ln = lastIdx(neg);
  if (ln >= 0 && ln > lp) return 'offline';
  if (lp >= 0) return 'online';
  return 'unknown';
}

function getTelegramCredentials () {
  const config = readJsonFile(OPENCLAW_CONFIG_PATH) || {};
  const telegram = config.channels?.telegram || {};
  const botToken = typeof telegram.botToken === 'string' ? telegram.botToken : null;
  const chatId = Array.isArray(telegram.allowFrom) ? telegram.allowFrom[0] : null;
  return { enabled: Boolean(telegram.enabled), botToken, chatId };
}

async function verifyFeishuChannel () {
  const creds = getFeishuCredentials();
  const config = readJsonFile(OPENCLAW_CONFIG_PATH) || {};
  const receiveId = config.channels?.feishu?.allowFrom?.[0] || null;
  const baseUrl = creds.domain === 'larksuite' ? 'https://open.larksuite.com' : 'https://open.feishu.cn';

  if (!receiveId) throw new Error('飞书 allowFrom 为空，无法确定测试消息接收人。');
  if (!creds.appId || !creds.appSecret) throw new Error('飞书 App ID 或 App Secret 未读取到。');

  const tokenResponse = await axios.post(`${baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
    app_id: creds.appId,
    app_secret: creds.appSecret
  }, { timeout: 8000 });
  const tenantToken = tokenResponse.data?.tenant_access_token;
  if (tokenResponse.data?.code !== 0 || !tenantToken) throw new Error(tokenResponse.data?.msg || 'tenant_access_token 获取失败。');

  const text = `OpenClaw Dash 通道验证 ${new Date().toLocaleString('zh-CN', { hour12: false })}`;
  const response = await axios.post(`${baseUrl}/open-apis/im/v1/messages`, {
    receive_id: receiveId,
    msg_type: 'text',
    content: JSON.stringify({ text })
  }, {
    params: { receive_id_type: 'open_id' },
    headers: { Authorization: `Bearer ${tenantToken}` },
    timeout: 10000
  });

  if (response.data?.code !== 0) throw new Error(response.data?.msg || '飞书测试消息发送失败。');
  const health = await getChannelHealth('feishu', await getCachedOpenClawChannelProbe(true));
  return {
    channel: 'feishu',
    sent: true,
    received: health.status === 'online',
    messageId: response.data?.data?.message_id || null,
    target: receiveId,
    lastInboundAt: health.lastSeenAt,
    note: '已通过飞书官方 API 发送测试消息；接收侧以 Gateway 最近活动日志作为参考。'
  };
}

async function verifyTelegramChannel () {
  const creds = getTelegramCredentials();
  if (!creds.enabled) throw new Error('Telegram 通道未启用。');
  if (!creds.botToken || !creds.chatId) throw new Error('Telegram botToken 或 allowFrom 未配置。');

  const text = `OpenClaw Dash 通道验证 ${new Date().toLocaleString('zh-CN', { hour12: false })}`;
  const response = await axios.post(`https://api.telegram.org/bot${creds.botToken}/sendMessage`, {
    chat_id: creds.chatId,
    text
  }, { timeout: 10000 });

  if (!response.data?.ok) throw new Error(response.data?.description || 'Telegram 测试消息发送失败。');
  const health = await getChannelHealth('telegram', await getCachedOpenClawChannelProbe(true));
  return {
    channel: 'telegram',
    sent: true,
    received: health.status === 'online',
    messageId: response.data?.result?.message_id || null,
    target: creds.chatId,
    lastInboundAt: health.lastSeenAt,
    note: '已通过 Telegram Bot API 发送测试消息；接收侧以 Gateway 最近活动日志作为参考。'
  };
}

async function verifyChannel (channel) {
  if (channel === 'feishu') return verifyFeishuChannel();
  if (channel === 'telegram') return verifyTelegramChannel();
  throw new Error('仅支持 feishu 或 telegram。');
}

async function checkChannelsStatus (probe = null) {
  const channelProbe = probe || await getCachedOpenClawChannelProbe();
  const [feishu, telegram] = await Promise.all([getChannelHealth('feishu', channelProbe), getChannelHealth('telegram', channelProbe)]);
  return { feishu: feishu.status, telegram: telegram.status, detail: { feishu, telegram } };
}

const { buildDiagnostics } = createDiagnosticsService({
  checkChannelsStatus,
  getGatewayProcesses,
  getLatestReleaseInfo,
  getLocalVersion,
  isVersionGreater,
  parseVersion
});

function assertOpenClawAvailable () {
  return new Promise((resolve, reject) => {
    fs.access(OPENCLAW_BIN, fs.constants.X_OK, (error) => {
      if (error) reject(new Error(`未检测到 openclaw 命令，请确认 ${OPENCLAW_BIN} 存在且可执行。`));
      else resolve();
    });
  });
}

function sleep (ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitForGatewayState (expectedRunning, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const isRunning = await checkGatewayStatus();
    if (isRunning === expectedRunning) return true;
    await sleep(500);
  }
  return false;
}

async function runGatewayControl (action) {
  await assertOpenClawAvailable();
  if (action === 'start') {
    await runOpenClawDaemonCommand('start');
    const started = await waitForGatewayState(true, 20000);
    if (!started) throw new Error('OpenClaw daemon start 已执行，但 Gateway 未能在超时时间内进入运行状态。');
    wasRunning = true;
    return { changed: true, pids: (await getGatewayProcesses()).map((p) => p.pid), isRunning: true, message: 'Gateway 已启动。' };
  }
  if (action === 'stop') {
    wasRunning = false;
    await runOpenClawDaemonCommand('stop');
    const stopped = await waitForGatewayState(false, 15000);
    if (!stopped) throw new Error('OpenClaw daemon stop 已执行，但 Gateway 未能在超时时间内停止。');
    return { changed: true, pids: [], isRunning: false, message: 'Gateway 已停止。' };
  }
  // restart
  wasRunning = false;
  await runOpenClawDaemonCommand('restart');
  const restarted = await waitForGatewayState(true, 25000);
  if (!restarted) throw new Error('OpenClaw daemon restart 已执行，但 Gateway 未能在超时时间内恢复运行。');
  wasRunning = true;
  return { changed: true, pids: (await getGatewayProcesses()).map((p) => p.pid), isRunning: true, message: 'Gateway 已重启。' };
}

function runOpenClawDaemonCommand (action) {
  return new Promise((resolve, reject) => {
    execFile(OPENCLAW_BIN, ['daemon', action], { env: { ...process.env, PATH: DASHBOARD_PATH }, timeout: 30000 }, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || stdout || error.message).trim()));
      else resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

function sendMacOSAlert (message = 'Gateway 进程意外终止，请前往管理面板检查！', title = 'OpenClaw 告警') {
  return new Promise((resolve) => {
    const script = `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)} sound name "Basso"`;
    execFile('osascript', ['-e', script], { timeout: 5000 }, (error) => {
      if (error) console.error('[Watchdog] macOS 通知发送失败:', error.message);
      resolve();
    });
  });
}

async function runWatchdogCheck () {
  try {
    const isRunning = await checkGatewayStatus();
    if (wasRunning === null) {
      wasRunning = isRunning;
      return;
    }
    if (!isRunning && wasRunning) { wasRunning = false; await sendMacOSAlert(); return; }
    if (isRunning) wasRunning = true;
  } catch (error) { console.error('[Watchdog] 状态检查失败:', error.message); }
}

async function initializeWatchdogState () {
  try {
    wasRunning = await checkGatewayStatus();
    console.log(`[Watchdog] 初始 Gateway 状态: ${wasRunning ? 'running' : 'stopped'}`);
  } catch (error) {
    wasRunning = null;
    console.error('[Watchdog] 初始状态读取失败:', error.message);
  }
}

async function runChannelWatchdogCheck () {
  try {
    const channels = await checkChannelsStatus();
    const now = Date.now();

    for (const channel of ['feishu', 'telegram']) {
      const health = channels.detail?.[channel] || {};
      const state = channelAlertState[channel];
      const label = channel === 'feishu' ? '飞书通道' : 'Telegram 通道';

      if (health.status === 'online') {
        state.initialized = true;
        state.offlineSince = null;
        state.alerted = false;
        continue;
      }

      if (!state.initialized) {
        state.initialized = true;
        state.offlineSince = now;
        state.alerted = true;
        continue;
      }

      if (!state.offlineSince) state.offlineSince = now;
      const offlineMs = now - state.offlineSince;
      if (!state.alerted && offlineMs >= CHANNEL_ALERT_AFTER_MS) {
        state.alerted = true;
        await sendMacOSAlert(`${label} 已连续离线超过 5 分钟，请前往管理面板检查。${health.reason ? `\n${health.reason}` : ''}`, 'OpenClaw 通道告警');
      }
    }
  } catch (error) {
    console.error('[ChannelWatchdog] 状态检查失败:', error.message);
  }
}

async function readAuditEntries (limit = 30) {
  const text = await readTail(AUDIT_LOG_PATH, Math.max(limit * 3, 50));
  return text.split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean)
    .slice(-limit)
    .reverse();
}

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
      matches.push({ timestamp: extractTimestamp(line), source: path.basename(filePath), message: line.trim().slice(0, 500) });
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
  addCheck('飞书通道', metrics.channels.feishu.status === 'online', metrics.channels.feishu.reason || metrics.channels.feishu.status, 15);
  addCheck('Telegram 通道', metrics.channels.telegram.status === 'online', metrics.channels.telegram.reason || metrics.channels.telegram.status, 15);
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

const { buildMetrics } = createMetricsService({
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
  sessionCookie: SESSION_COOKIE,
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
  buildSetupStatus
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
    buildDiagnostics,
    buildHealthSummary,
    buildMetrics,
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
    sessionCookie: SESSION_COOKIE
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
