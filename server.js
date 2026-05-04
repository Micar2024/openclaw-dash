const express = require('express');
const axios = require('axios');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const { execFile, spawn } = require('child_process');
const path = require('path');

const app = express();
const PORT = Number(process.env.DASHBOARD_PORT || 3000);
const ERR_LOG_PATH = path.join(os.homedir(), '.openclaw/logs/gateway.err.log');
const TOKEN_PATH = path.join(os.homedir(), '.openclaw/dash-token');
const AUDIT_LOG_PATH = path.join(os.homedir(), '.openclaw/dash-audit.log');
const UPDATE_JOB_PATH = path.join(os.homedir(), '.openclaw/dash-update-job.json');
const DASH_VERSION_CACHE_PATH = path.join(os.homedir(), '.openclaw/dash-version-cache.json');
const LOG_MUTE_RULES_PATH = path.join(os.homedir(), '.openclaw/dash-log-muted-rules.json');
const LOG_PATH = path.join(os.homedir(), '.openclaw/logs/gateway.log');
const OPENCLAW_CONFIG_PATH = path.join(os.homedir(), '.openclaw/openclaw.json');
const UPDATE_CHECK_PATH = path.join(os.homedir(), '.openclaw/update-check.json');
const OPENCLAW_BIN = path.join(os.homedir(), '.npm-global/bin/openclaw');
const GATEWAY_PORT = process.env.OPENCLAW_GATEWAY_PORT || '18789';
const HOST = process.env.DASHBOARD_HOST || '127.0.0.1';
const DASHBOARD_PATH = [
  path.join(os.homedir(), '.npm-global/bin'),
  '/usr/local/bin',
  '/opt/homebrew/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
].join(':');
const WATCHDOG_INTERVAL_MS = 60 * 1000;
const CHANNEL_ALERT_INTERVAL_MS = 60 * 1000;
const CHANNEL_ALERT_AFTER_MS = 5 * 60 * 1000;
const DASH_VERSION_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CONTROL_ACTIONS = new Set(['start', 'stop', 'restart']);
const CHANNEL_STATS_TAIL_LINES = 5000;
const UPDATE_OUTPUT_TAIL_CHARS = 6000;
const SESSION_COOKIE = 'openclaw_dash_session';
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const DASHBOARD_TOKEN = resolveDashboardToken();
const DEFAULT_LOG_MUTE_RULES = [
  {
    id: 'feishu-open-id-resolved-unknown',
    label: '飞书 bot open_id resolved: unknown',
    description: '飞书插件解析发送者时的已知无害日志，不计入错误统计。',
    pattern: 'bot open_id resolved:\\s*unknown|resolved:\\s*unknown',
    enabled: true,
  },
];
let wasRunning = null;
let channelAlertState = {
  feishu: { initialized: false, offlineSince: null, alerted: false },
  telegram: { initialized: false, offlineSince: null, alerted: false },
};
let updateJob = loadPersistedUpdateJob();

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

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function resolveDashboardToken() {
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

function isValidDashboardToken(token) {
  if (!token) return false;

  try {
    const expected = Buffer.from(DASHBOARD_TOKEN);
    const actual = Buffer.from(String(token).trim());
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function parseCookies(req) {
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

function signSession(issuedAt) {
  return crypto.createHmac('sha256', DASHBOARD_TOKEN).update(String(issuedAt)).digest('hex');
}

function createSessionToken() {
  const issuedAt = Date.now();
  return `${issuedAt}.${signSession(issuedAt)}`;
}

function isValidSessionToken(sessionToken) {
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

function setSessionCookie(res) {
  const token = createSessionToken();
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}; HttpOnly; SameSite=Lax`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
}

function isLocalRequest(req) {
  const address = req.socket?.remoteAddress || req.ip || '';
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
}

app.get('/api/auth/status', (req, res) => {
  res.json({ authenticated: isValidSessionToken(parseCookies(req)[SESSION_COOKIE]), local: isLocalRequest(req) });
});

app.post('/api/auth/local-login', (req, res) => {
  if (!isLocalRequest(req)) {
    return res.status(403).json({ success: false, message: '仅允许本机浏览器一键登录。' });
  }

  setSessionCookie(res);
  appendAudit(req, 'auth.localLogin', true);
  res.json({ success: true, message: '本机登录成功。' });
});

app.post('/api/auth/login', (req, res) => {
  if (!isValidDashboardToken(req.body?.token)) {
    appendAudit(req, 'auth.login', false);
    return res.status(401).json({ success: false, message: '访问口令无效。' });
  }

  setSessionCookie(res);
  appendAudit(req, 'auth.login', true);
  res.json({ success: true, message: '登录成功。' });
});

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookie(res);
  appendAudit(req, 'auth.logout', true);
  res.json({ success: true });
});

function appendAudit(req, action, success, detail = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    action,
    success: Boolean(success),
    ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip || 'unknown',
    userAgent: req.get('User-Agent') || '',
    detail,
  };

  try {
    ensureParentDir(AUDIT_LOG_PATH);
    fs.appendFile(AUDIT_LOG_PATH, `${JSON.stringify(entry)}\n`, () => {});
  } catch (error) {
    console.error('[Audit] 写入失败:', error.message);
  }
}

function readTail(filePath, lines = 200) {
  return new Promise((resolve) => {
    const safeLines = Math.max(1, Math.min(Number(lines) || 200, 20000));
    execFile('tail', ['-n', String(safeLines), filePath], { timeout: 5000 }, (err, stdout) => {
      resolve(err || !stdout ? '' : stdout);
    });
  });
}

function getDiskInfo() {
  return new Promise((resolve) => {
    execFile('df', ['-k', os.homedir()], { timeout: 3000 }, (err, stdout) => {
      if (err || !stdout.trim()) {
        resolve({ freeGb: null, usedPercent: null });
        return;
      }

      const parts = stdout.trim().split('\n')[1]?.split(/\s+/) || [];
      const availKb = parseInt(parts[3], 10);
      const usedPct = parts[4] ? parseInt(parts[4], 10) : null;
      resolve({
        freeGb: Number.isFinite(availKb) ? Number((availKb / 1048576).toFixed(1)) : null,
        usedPercent: usedPct,
      });
    });
  });
}

function getProcessResourceInfo(pid) {
  return new Promise((resolve) => {
    execFile('ps', ['-p', String(pid), '-o', 'etime=,rss='], { timeout: 3000 }, (err, stdout) => {
      if (err || !stdout.trim()) {
        resolve(null);
        return;
      }

      const parts = stdout.trim().split(/\s+/);
      resolve({ etime: parts[0] || null, rssKb: parseInt(parts[1], 10) || null });
    });
  });
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch { return null; }
}

function parseDateMs(value) {
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function isFreshTimestamp(value, maxAgeMs) {
  const ms = parseDateMs(value);
  return ms != null && Date.now() - ms <= maxAgeMs;
}

function createDefaultUpdateJob() {
  return {
    id: null,
    running: false,
    status: 'idle',
    startedAt: null,
    finishedAt: null,
    steps: [],
    message: '暂无更新任务。',
    error: null,
    postUpdateDiagnostics: null,
  };
}

function loadPersistedUpdateJob() {
  const saved = readJsonFile(UPDATE_JOB_PATH);
  if (!saved || typeof saved !== 'object') return createDefaultUpdateJob();

  const job = { ...createDefaultUpdateJob(), ...saved, steps: Array.isArray(saved.steps) ? saved.steps : [] };
  if (job.running) {
    job.running = false;
    job.status = 'error';
    job.finishedAt = new Date().toISOString();
    job.message = '看板服务重启，上一轮更新状态未能确认。';
    job.postUpdateDiagnostics = null;
    job.steps = [...job.steps, {
      name: '看板服务重启',
      status: 'warning',
      detail: '更新任务运行期间 dashboard 进程重启，无法确认该任务是否完整结束。请手动运行升级后复检。',
      timestamp: job.finishedAt,
    }];
  }

  const diagnosticsAt = parseDateMs(job.postUpdateDiagnostics?.collectedAt);
  const finishedAt = parseDateMs(job.finishedAt);
  if (job.postUpdateDiagnostics && (!diagnosticsAt || (finishedAt && diagnosticsAt < finishedAt))) {
    job.postUpdateDiagnostics = null;
    job.steps = [...job.steps, {
      name: '复检结果已失效',
      status: 'warning',
      detail: '持久化的升级后复检时间早于任务结束时间，已忽略旧结果。请重新运行升级后复检。',
      timestamp: new Date().toISOString(),
    }];
  }
  return job;
}

function persistUpdateJob() {
  try {
    ensureParentDir(UPDATE_JOB_PATH);
    fs.writeFileSync(UPDATE_JOB_PATH, `${JSON.stringify(updateJob, null, 2)}\n`, { mode: 0o600 });
  } catch (error) {
    console.error('[UpdateJob] 状态持久化失败:', error.message);
  }
}

function loadLogMuteRules() {
  const saved = readJsonFile(LOG_MUTE_RULES_PATH);
  const savedRules = Array.isArray(saved?.rules) ? saved.rules : [];
  const byId = new Map(savedRules.map((rule) => [rule.id, rule]));
  return DEFAULT_LOG_MUTE_RULES.map((rule) => ({ ...rule, enabled: byId.has(rule.id) ? Boolean(byId.get(rule.id).enabled) : rule.enabled }));
}

function persistLogMuteRules(rules) {
  ensureParentDir(LOG_MUTE_RULES_PATH);
  fs.writeFileSync(LOG_MUTE_RULES_PATH, `${JSON.stringify({ rules, updatedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
}

function getActiveLogMuteRules() {
  return loadLogMuteRules().filter((rule) => rule.enabled);
}

function matchesMutedLogRule(line, rules = getActiveLogMuteRules()) {
  const text = String(line || '');
  return rules.find((rule) => {
    try {
      return new RegExp(rule.pattern, 'i').test(text);
    } catch {
      return false;
    }
  }) || null;
}

function execJsonFile(file, args, timeoutMs = 15000) {
  return new Promise((resolve) => {
    execFile(file, args, { env: { ...process.env, PATH: DASHBOARD_PATH }, timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, error: (stderr || stdout || error.message).trim(), data: null });
        return;
      }

      try {
        resolve({ ok: true, error: null, data: JSON.parse(stdout.trim()) });
      } catch (parseError) {
        resolve({ ok: false, error: `JSON 解析失败：${parseError.message}`, data: null, raw: stdout.trim().slice(-1000) });
      }
    });
  });
}

function extractTimestamp(line) {
  if (!line) return null;
  const match = line.match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})/);
  return match ? match[1] : null;
}

function extractDateFromLogLine(line) {
  if (!line) return null;
  const match = line.match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/);
  if (!match) return null;
  const normalized = match[1].replace(' ', 'T');
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function lineMatchesAnyKeyword(line, keywords) {
  const lower = String(line || '').toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword));
}

function getChannelKeywords(channel) {
  if (channel === 'feishu') return ['feishu', 'lark', '飞书'];
  if (channel === 'telegram') return ['telegram', 'tg'];
  return [channel];
}

function isChannelRelatedLine(channel, line) {
  const lower = String(line || '').toLowerCase();
  if (lineMatchesAnyKeyword(lower, getChannelKeywords(channel))) return true;

  if (channel === 'feishu') {
    return lower.includes('[ws]')
      || lower.includes('openclaw_bot/ping')
      || lower.includes('persistent connection')
      || lower.includes('connect failed');
  }

  return false;
}

function explainChannelStatus(channel, status, lastSignalLine, lastErrorLine) {
  if (lastErrorLine && status === 'offline') {
    if (/status code 400/i.test(lastErrorLine)) return '最近检测到连接请求返回 400，通道可能未完成升级后的配置适配。';
    if (/connect failed|unable to connect/i.test(lastErrorLine)) return '最近检测到连接失败。';
    return '最近错误日志晚于连接日志。';
  }

  if (lastSignalLine && status === 'online') return '最近健康信号晚于错误信号。';
  return '未检测到可证明通道在线的近期健康信号。';
}

async function getChannelHealth(channel) {
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

  return {
    status,
    lastSeenAt: lastSeenAt || lastSignalAt || lastErrorAt || null,
    lastSignalAt,
    lastErrorAt,
    lastError: lastErrorLine ? lastErrorLine.slice(0, 500) : null,
    reason: explainChannelStatus(channel, status, lastSignalLine, lastErrorLine),
  };
}

async function getChannelMessageStats(channel) {
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

function normalizeVersion(value) {
  if (!value) return null;
  const match = String(value).match(/v?(\d{4}\.\d{1,2}\.\d{1,2})/i);
  return match ? match[1] : String(value).replace(/^v/i, '').trim();
}

function parseVersion(value) {
  const text = String(value || '');
  const match = text.match(/v?(\d{4})\.(\d{1,2})\.(\d{1,2})(?:-([0-9a-z.-]+))?/i);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || '',
    raw: match[0],
  };
}

function compareVersions(a, b) {
  const av = parseVersion(a);
  const bv = parseVersion(b);
  if (!av && !bv) return 0;
  if (!av) return -1;
  if (!bv) return 1;
  for (const key of ['major', 'minor', 'patch']) {
    if (av[key] !== bv[key]) return av[key] - bv[key];
  }

  function suffixRank(suffix) {
    if (!suffix) return { type: 0, value: 0, text: '' };
    if (/^\d+$/.test(suffix)) return { type: 1, value: Number(suffix), text: suffix };
    return { type: -1, value: 0, text: suffix };
  }

  const as = suffixRank(av.prerelease);
  const bs = suffixRank(bv.prerelease);
  if (as.type !== bs.type) return as.type - bs.type;
  if (as.value !== bs.value) return as.value - bs.value;
  return as.text.localeCompare(bs.text, undefined, { numeric: true });
}

function isVersionGreater(latest, local) {
  return compareVersions(latest, local) > 0;
}

function buildReleaseUrl(version) {
  return version ? `https://github.com/openclaw/openclaw/releases/tag/v${normalizeVersion(version)}` : null;
}

function persistLatestReleaseInfo(info) {
  if (!info?.latestVersion || info.source?.includes('cache')) return info;
  try {
    ensureParentDir(DASH_VERSION_CACHE_PATH);
    fs.writeFileSync(DASH_VERSION_CACHE_PATH, `${JSON.stringify({ ...info, cachedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  } catch (error) {
    console.error('[Version] 版本缓存写入失败:', error.message);
  }
  return info;
}

app.get('/api/version', (req, res) => {
  execFile(OPENCLAW_BIN, ['--version'], { env: { ...process.env, PATH: DASHBOARD_PATH }, timeout: 5000 }, (error, stdout, stderr) => {
    if (error) return res.json({ installed: false, version: null, message: '未检测到 openclaw，或执行 openclaw --version 时发生错误。', detail: stderr ? stderr.trim() : error.message });
    res.json({ installed: true, version: stdout.trim() || '未知版本', message: '已检测到本地 openclaw。' });
  });
});

function getLocalVersion() {
  return new Promise((resolve) => {
    execFile(OPENCLAW_BIN, ['--version'], { env: { ...process.env, PATH: DASHBOARD_PATH }, timeout: 5000 }, (error, stdout) => {
      resolve(error ? null : (stdout.trim() || null));
    });
  });
}

async function getLatestReleaseInfo() {
  let githubError = null;
  try {
    const response = await axios.get('https://api.github.com/repos/openclaw/openclaw/releases', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'openclaw-dash' },
      params: { per_page: 20 },
      timeout: 8000,
    });

    const releases = Array.isArray(response.data) ? response.data.filter((release) => !release.draft) : [];
    const stable = releases.filter((release) => !release.prerelease);
    const candidates = stable.length ? stable : releases;
    const latest = candidates
      .filter((release) => parseVersion(release.tag_name))
      .sort((a, b) => compareVersions(b.tag_name, a.tag_name))[0];

    if (latest?.tag_name) {
      return persistLatestReleaseInfo({
        latestVersion: latest.tag_name,
        releaseUrl: latest.html_url || buildReleaseUrl(latest.tag_name),
        publishedAt: latest.published_at || null,
        source: stable.length ? 'github-releases' : 'github-releases-prerelease',
      });
    }
  } catch (error) {
    githubError = error.response?.data?.message || error.message;
  }

  try {
    const response = await axios.get('https://registry.npmjs.org/openclaw/latest', {
      headers: { Accept: 'application/json', 'User-Agent': 'openclaw-dash' },
      timeout: 8000,
    });
    const npmVersion = response.data?.version || null;
    if (npmVersion) {
      return persistLatestReleaseInfo({
        latestVersion: `v${npmVersion}`,
        releaseUrl: buildReleaseUrl(npmVersion),
        publishedAt: response.data?.time || null,
        source: githubError ? `npm-registry (github: ${githubError})` : 'npm-registry',
      });
    }
  } catch (error) {
    // Keep falling through to OpenClaw's local cache.
  }

  const dashCached = readJsonFile(DASH_VERSION_CACHE_PATH);
  if (dashCached?.latestVersion && isFreshTimestamp(dashCached.cachedAt, DASH_VERSION_CACHE_MAX_AGE_MS)) {
    return {
      latestVersion: dashCached.latestVersion,
      releaseUrl: dashCached.releaseUrl || buildReleaseUrl(dashCached.latestVersion),
      publishedAt: dashCached.publishedAt || dashCached.cachedAt || null,
      source: 'dash-version-cache',
    };
  }

  const cached = readJsonFile(UPDATE_CHECK_PATH);
  const cachedVersion = cached?.lastAvailableVersion || cached?.lastNotifiedVersion || null;
  return {
    latestVersion: cachedVersion ? `v${normalizeVersion(cachedVersion)}` : null,
    releaseUrl: cachedVersion ? buildReleaseUrl(cachedVersion) : null,
    publishedAt: cached?.lastCheckedAt || null,
    source: cachedVersion ? 'update-check-cache' : 'unavailable',
  };
}

app.get('/api/check-update', async (req, res) => {
  try {
    const latestRelease = await getLatestReleaseInfo();
    if (!latestRelease.latestVersion) return res.status(502).json({ success: false, latestVersion: null, message: '无法获取最新版本信息，请稍后重试。' });
    res.json({ success: true, latestVersion: latestRelease.latestVersion, releaseName: '', releaseUrl: latestRelease.releaseUrl || '', publishedAt: latestRelease.publishedAt || '', source: latestRelease.source });
  } catch (error) {
    res.status(502).json({ success: false, latestVersion: null, message: '无法获取 GitHub 最新 Release 信息，请稍后重试。', detail: error.response?.data?.message || error.message });
  }
});

function checkGatewayStatus() {
  return getGatewayProcesses().then((processes) => processes.length > 0);
}

function getGatewayProcesses() {
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

app.get('/api/status', async (req, res) => {
  const isRunning = await checkGatewayStatus();
  res.json({ isRunning });
});

function inferLatestChannelStatus(line) {
  if (!line || !line.trim()) return 'offline';
  const norm = line.trim().toLowerCase();
  const pos = /(^|[^a-z0-9])(connected|online|success|resolved|running|start(?:ed|ing)?|active|login|logged\s*in|ready|authenticated|received|message|reaction|event|dispatch(?:ing)?|provider|register(?:ed|ing)?|command|menu|immediate)(?=$|[^a-z0-9])/gi;
  const neg = /(^|[^a-z0-9])(error|failed|fail|disconnected|disconnect|offline|stopped|closed|timeout|unauthorized|denied|crash(?:ed)?)(?=$|[^a-z0-9])/gi;
  function lastIdx(p) { let i = -1, m; while ((m = p.exec(norm)) !== null) i = m.index + m[1].length; return i; }
  const lp = lastIdx(pos), ln = lastIdx(neg);
  if (ln >= 0 && ln > lp) return 'offline';
  if (lp >= 0) return 'online';
  return 'unknown';
}

async function getLatestAgentModelLine() {
  const content = await readTail(LOG_PATH, CHANNEL_STATS_TAIL_LINES);
  return content.split(/\r?\n/).reverse().find((line) => /agent model:/i.test(line))?.trim() || '';
}

function resolveModelMetadata(config, modelId) {
  if (!config || !modelId) return {};
  const provider = modelId.includes('/') ? modelId.split('/')[0] : null;
  const shortId = provider ? modelId.slice(provider.length + 1) : modelId;
  const providerConfig = provider ? config.models?.providers?.[provider] : null;
  const providerModels = Array.isArray(providerConfig?.models) ? providerConfig.models : [];
  const modelMeta = providerModels.find((m) => m.id === shortId || m.id === modelId) || {};
  const configuredAlias = config.agents?.defaults?.models?.[modelId]?.alias || null;
  return { provider, id: modelId, name: modelMeta.name || shortId || modelId, alias: configuredAlias, contextWindow: modelMeta.contextWindow || null, maxTokens: modelMeta.maxTokens || null, reasoning: typeof modelMeta.reasoning === 'boolean' ? modelMeta.reasoning : null, input: Array.isArray(modelMeta.input) ? modelMeta.input : [] };
}

async function getCurrentModelInfo() {
  const config = readJsonFile(OPENCLAW_CONFIG_PATH) || {};
  const defaultModel = config.agents?.defaults?.model?.primary || null;
  const fallbacks = Array.isArray(config.agents?.defaults?.model?.fallbacks) ? config.agents.defaults.model.fallbacks : [];
  const imageModel = config.agents?.defaults?.imageModel?.primary || null;
  const latestModelLine = await getLatestAgentModelLine();
  const runtimeModel = latestModelLine.match(/agent model:\s*([^\s]+)/i)?.[1] || null;
  const current = runtimeModel || defaultModel;
  const metadata = resolveModelMetadata(config, current);
  return { current, configuredPrimary: defaultModel, runtimeModel, provider: metadata.provider || null, name: metadata.name || current, alias: metadata.alias || null, fallbacks, imageModel, contextWindow: metadata.contextWindow || null, maxTokens: metadata.maxTokens || null, reasoning: metadata.reasoning, input: metadata.input || [], lastSeenAt: extractTimestamp(latestModelLine), source: runtimeModel ? 'gateway.log' : 'config' };
}

async function runOpenClawChannelProbe() {
  const result = await execJsonFile(OPENCLAW_BIN, ['channels', 'status', '--probe', '--json'], 35000);
  if (!result.ok) return { ok: false, error: result.error, channels: {} };
  return { ok: true, error: null, ...result.data };
}

function getFeishuSecretPath(config) {
  const secretRef = config.channels?.feishu?.appSecret || {};
  if (secretRef.source === 'file' && typeof secretRef.id === 'string') {
    const cleanId = secretRef.id.replace(/^\/+/, '');
    const candidate = path.join(os.homedir(), '.openclaw/credentials', `${cleanId}.json`);
    if (fs.existsSync(candidate)) return { path: candidate, source: `openclaw-config:${secretRef.id}` };
  }

  const fallback = path.join(os.homedir(), '.openclaw/credentials/lark.secrets.json');
  return fs.existsSync(fallback) ? { path: fallback, source: 'legacy-lark-secret-file' } : { path: null, source: null };
}

function getNestedValue(source, keyPath) {
  return keyPath.split('.').reduce((value, key) => (value && typeof value === 'object' ? value[key] : undefined), source);
}

function resolveFeishuAppSecret(config) {
  const envSecret = (process.env.OPENCLAW_DASH_FEISHU_APP_SECRET || '').trim();
  if (envSecret) {
    return { value: envSecret, source: 'env:OPENCLAW_DASH_FEISHU_APP_SECRET', schema: 'explicit-env', file: null, warning: null };
  }

  const configSecret = config.channels?.feishu?.appSecret;
  if (typeof configSecret === 'string' && configSecret.trim()) {
    return { value: configSecret.trim(), source: 'openclaw-config:channels.feishu.appSecret', schema: 'literal', file: null, warning: null };
  }

  const secretLocation = getFeishuSecretPath(config);
  if (!secretLocation.path) {
    return { value: null, source: null, schema: null, file: null, warning: '未找到飞书凭据文件；推荐设置 OPENCLAW_DASH_FEISHU_APP_SECRET。' };
  }

  const secrets = readJsonFile(secretLocation.path) || {};
  const candidates = [
    'appSecret',
    'app_secret',
    'lark.appSecret',
    'lark.app_secret',
    'feishu.appSecret',
    'feishu.app_secret',
  ];
  const matchedPath = candidates.find((candidate) => typeof getNestedValue(secrets, candidate) === 'string' && getNestedValue(secrets, candidate).trim());
  const value = matchedPath ? getNestedValue(secrets, matchedPath).trim() : null;

  return {
    value,
    source: secretLocation.source,
    schema: matchedPath || null,
    file: secretLocation.path,
    warning: value ? null : '飞书凭据文件存在，但未识别到 appSecret；推荐设置 OPENCLAW_DASH_FEISHU_APP_SECRET。',
  };
}

function getFeishuCredentials() {
  const config = readJsonFile(OPENCLAW_CONFIG_PATH) || {};
  const envAppId = (process.env.OPENCLAW_DASH_FEISHU_APP_ID || '').trim();
  const appId = envAppId || config.channels?.feishu?.appId || null;
  const secret = resolveFeishuAppSecret(config);

  return {
    appId,
    appSecret: secret.value,
    domain: config.channels?.feishu?.domain || 'feishu',
    connectionMode: config.channels?.feishu?.connectionMode || null,
    enabled: Boolean(config.channels?.feishu?.enabled),
    blockStreamingConfigured: Object.prototype.hasOwnProperty.call(config.channels?.feishu || {}, 'blockStreaming'),
    blockStreaming: config.channels?.feishu?.blockStreaming,
    secretFile: secret.file ? path.basename(secret.file) : null,
    appIdSource: envAppId ? 'env:OPENCLAW_DASH_FEISHU_APP_ID' : 'openclaw-config:channels.feishu.appId',
    credentialSource: secret.source,
    credentialSchema: secret.schema,
    credentialWarning: secret.warning,
  };
}

async function getFeishuDirectProbe() {
  const creds = getFeishuCredentials();
  const baseUrl = creds.domain === 'larksuite' ? 'https://open.larksuite.com' : 'https://open.feishu.cn';

  if (!creds.enabled) return { ok: false, error: '飞书通道未启用。', appId: creds.appId, connectionMode: creds.connectionMode, blockStreamingConfigured: creds.blockStreamingConfigured };
  if (!creds.appId || !creds.appSecret) return { ok: false, error: creds.credentialWarning || '飞书 App ID 或 App Secret 未读取到。', appId: creds.appId, appIdSource: creds.appIdSource, connectionMode: creds.connectionMode, blockStreamingConfigured: creds.blockStreamingConfigured, credentialSource: creds.credentialSource, credentialSchema: creds.credentialSchema };

  try {
    const tokenResponse = await axios.post(`${baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
      app_id: creds.appId,
      app_secret: creds.appSecret,
    }, { timeout: 8000 });

    if (tokenResponse.data?.code !== 0 || !tokenResponse.data?.tenant_access_token) {
      return { ok: false, error: tokenResponse.data?.msg || 'tenant_access_token 获取失败。', appId: creds.appId, appIdSource: creds.appIdSource, connectionMode: creds.connectionMode, credentialSource: creds.credentialSource, credentialSchema: creds.credentialSchema };
    }

    const headers = { Authorization: `Bearer ${tokenResponse.data.tenant_access_token}` };
    const [botInfo, ping] = await Promise.all([
      axios.get(`${baseUrl}/open-apis/bot/v3/info`, { headers, timeout: 8000 }).catch((error) => ({ error })),
      axios.post(`${baseUrl}/open-apis/bot/v1/openclaw_bot/ping`, {}, { headers, timeout: 8000 }).catch((error) => ({ error })),
    ]);

    const botError = botInfo.error;
    const pingError = ping.error;
    const pingOk = !pingError && ping.data?.code === 0;

    return {
      ok: pingOk,
      error: pingOk ? null : (pingError?.response?.data?.msg || pingError?.response?.data?.message || pingError?.message || '飞书 bot ping 失败。'),
      appId: creds.appId,
      appIdSource: creds.appIdSource,
      botOpenId: botError ? null : botInfo.data?.bot?.open_id || null,
      botName: botError ? null : botInfo.data?.bot?.name || null,
      connectionMode: creds.connectionMode,
      blockStreamingConfigured: creds.blockStreamingConfigured,
      blockStreaming: creds.blockStreaming ?? null,
      secretFile: creds.secretFile,
      credentialSource: creds.credentialSource,
      credentialSchema: creds.credentialSchema,
    };
  } catch (error) {
    return {
      ok: false,
      error: error.response?.data?.msg || error.response?.data?.message || error.message,
      appId: creds.appId,
      appIdSource: creds.appIdSource,
      connectionMode: creds.connectionMode,
      blockStreamingConfigured: creds.blockStreamingConfigured,
      blockStreaming: creds.blockStreaming ?? null,
      secretFile: creds.secretFile,
      credentialSource: creds.credentialSource,
      credentialSchema: creds.credentialSchema,
    };
  }
}

function getTelegramCredentials() {
  const config = readJsonFile(OPENCLAW_CONFIG_PATH) || {};
  const telegram = config.channels?.telegram || {};
  const botToken = typeof telegram.botToken === 'string' ? telegram.botToken : null;
  const chatId = Array.isArray(telegram.allowFrom) ? telegram.allowFrom[0] : null;
  return { enabled: Boolean(telegram.enabled), botToken, chatId };
}

async function verifyFeishuChannel() {
  const creds = getFeishuCredentials();
  const config = readJsonFile(OPENCLAW_CONFIG_PATH) || {};
  const receiveId = config.channels?.feishu?.allowFrom?.[0] || null;
  const baseUrl = creds.domain === 'larksuite' ? 'https://open.larksuite.com' : 'https://open.feishu.cn';

  if (!receiveId) throw new Error('飞书 allowFrom 为空，无法确定测试消息接收人。');
  if (!creds.appId || !creds.appSecret) throw new Error('飞书 App ID 或 App Secret 未读取到。');

  const tokenResponse = await axios.post(`${baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
    app_id: creds.appId,
    app_secret: creds.appSecret,
  }, { timeout: 8000 });
  const tenantToken = tokenResponse.data?.tenant_access_token;
  if (tokenResponse.data?.code !== 0 || !tenantToken) throw new Error(tokenResponse.data?.msg || 'tenant_access_token 获取失败。');

  const text = `OpenClaw Dash 通道验证 ${new Date().toLocaleString('zh-CN', { hour12: false })}`;
  const response = await axios.post(`${baseUrl}/open-apis/im/v1/messages`, {
    receive_id: receiveId,
    msg_type: 'text',
    content: JSON.stringify({ text }),
  }, {
    params: { receive_id_type: 'open_id' },
    headers: { Authorization: `Bearer ${tenantToken}` },
    timeout: 10000,
  });

  if (response.data?.code !== 0) throw new Error(response.data?.msg || '飞书测试消息发送失败。');
  const health = await getChannelHealth('feishu');
  return {
    channel: 'feishu',
    sent: true,
    received: health.status === 'online',
    messageId: response.data?.data?.message_id || null,
    target: receiveId,
    lastInboundAt: health.lastSeenAt,
    note: '已通过飞书官方 API 发送测试消息；接收侧以 Gateway 最近活动日志作为参考。',
  };
}

async function verifyTelegramChannel() {
  const creds = getTelegramCredentials();
  if (!creds.enabled) throw new Error('Telegram 通道未启用。');
  if (!creds.botToken || !creds.chatId) throw new Error('Telegram botToken 或 allowFrom 未配置。');

  const text = `OpenClaw Dash 通道验证 ${new Date().toLocaleString('zh-CN', { hour12: false })}`;
  const response = await axios.post(`https://api.telegram.org/bot${creds.botToken}/sendMessage`, {
    chat_id: creds.chatId,
    text,
  }, { timeout: 10000 });

  if (!response.data?.ok) throw new Error(response.data?.description || 'Telegram 测试消息发送失败。');
  const health = await getChannelHealth('telegram');
  return {
    channel: 'telegram',
    sent: true,
    received: health.status === 'online',
    messageId: response.data?.result?.message_id || null,
    target: creds.chatId,
    lastInboundAt: health.lastSeenAt,
    note: '已通过 Telegram Bot API 发送测试消息；接收侧以 Gateway 最近活动日志作为参考。',
  };
}

async function verifyChannel(channel) {
  if (channel === 'feishu') return verifyFeishuChannel();
  if (channel === 'telegram') return verifyTelegramChannel();
  throw new Error('仅支持 feishu 或 telegram。');
}

function buildRecommendations({ gatewayRunning, channels, openclawProbe, feishuDirect, model, version }) {
  const recommendations = [];
  const feishuGatewayProbe = openclawProbe?.channels?.feishu?.probe;

  if (!gatewayRunning) {
    recommendations.push({ level: 'critical', title: 'Gateway 未运行', detail: '先在控制区启动 Gateway，再复查通道与模型状态。' });
  }

  if (feishuDirect?.ok && feishuGatewayProbe && feishuGatewayProbe.ok === false) {
    const upgradeHint = version?.updateAvailable
      ? `当前有新版本 ${version.latest}，建议先升级后复检；5.3 系列包含飞书 SDK 路径修复。`
      : '可等待插件更新，或更新后重启 Gateway 再复检。';
    recommendations.push({
      level: 'warning',
      title: '飞书 API 正常，但 Gateway 探针失败',
      detail: `当前更像是 OpenClaw/飞书插件运行态或长连接适配问题：${feishuGatewayProbe.error || '未知错误'}。${upgradeHint}`,
    });
  } else if (channels?.detail?.feishu?.status === 'offline') {
    recommendations.push({ level: 'warning', title: '飞书通道离线', detail: channels.detail.feishu.reason || '未检测到近期健康信号。' });
  }

  if (channels?.detail?.telegram?.status === 'offline') {
    recommendations.push({ level: 'warning', title: 'Telegram 通道离线', detail: channels.detail.telegram.reason || '未检测到近期健康信号。' });
  }

  if (version?.updateAvailable) {
    recommendations.push({ level: 'info', title: 'OpenClaw 有新版本', detail: `本地 ${version.local || '-'}，最新 ${version.latest || '-'}。建议在空闲时段执行更新。` });
  }

  if (!model?.current) {
    recommendations.push({ level: 'info', title: '未检测到当前模型', detail: '模型信息未能从配置或 Gateway 日志读取，可在下次消息调用后刷新。' });
  }

  if (!recommendations.length) {
    recommendations.push({ level: 'ok', title: '核心状态正常', detail: 'Gateway、通道和模型没有发现新的高优先级异常。' });
  }

  return recommendations;
}

async function buildDiagnostics() {
  const [gatewayProcesses, channels, openclawProbe, feishuDirect, localVersion, latestRelease, model] = await Promise.all([
    getGatewayProcesses(),
    checkChannelsStatus(),
    runOpenClawChannelProbe(),
    getFeishuDirectProbe(),
    getLocalVersion(),
    getLatestReleaseInfo(),
    getCurrentModelInfo(),
  ]);
  const version = {
    local: localVersion,
    latest: latestRelease.latestVersion,
    updateAvailable: Boolean(parseVersion(localVersion) && parseVersion(latestRelease.latestVersion) && isVersionGreater(latestRelease.latestVersion, localVersion)),
    releaseUrl: latestRelease.releaseUrl,
    source: latestRelease.source,
  };

  return {
    collectedAt: new Date().toISOString(),
    gateway: { isRunning: gatewayProcesses.length > 0, processes: gatewayProcesses },
    channels,
    openclawProbe,
    feishuDirect,
    model,
    version,
    recommendations: buildRecommendations({
      gatewayRunning: gatewayProcesses.length > 0,
      channels,
      openclawProbe,
      feishuDirect,
      model,
      version,
    }),
  };
}

async function checkChannelsStatus() {
  const [feishu, telegram] = await Promise.all([getChannelHealth('feishu'), getChannelHealth('telegram')]);
  return { feishu: feishu.status, telegram: telegram.status, detail: { feishu, telegram } };
}

app.get('/api/channels', async (req, res) => { res.json(await checkChannelsStatus()); });

app.post('/api/channels/verify', async (req, res) => {
  const channel = String(req.body?.channel || '').toLowerCase();
  if (!['feishu', 'telegram'].includes(channel)) {
    return res.status(400).json({ success: false, message: '仅支持 feishu 或 telegram。' });
  }
  if (req.body?.confirm !== true) {
    return res.status(400).json({ success: false, message: '真实通道验证会发送测试消息，需要显式确认。' });
  }

  try {
    const result = await verifyChannel(channel);
    appendAudit(req, `channel.${channel}.verify`, true, {
      sent: result.sent,
      received: result.received,
      messageId: result.messageId,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    appendAudit(req, `channel.${channel}.verify`, false, { error: error.message });
    res.status(500).json({ success: false, channel, message: error.message });
  }
});

app.get('/api/model', async (req, res) => {
  try { res.json(await getCurrentModelInfo()); } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/diagnostics', async (req, res) => {
  try {
    res.json(await buildDiagnostics());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/diagnostics/probe', async (req, res) => {
  try {
    const diagnostics = await buildDiagnostics();
    appendAudit(req, 'diagnostics.probe', true, {
      gatewayRunning: diagnostics.gateway.isRunning,
      feishuDirectOk: diagnostics.feishuDirect?.ok,
      feishuProbeOk: diagnostics.openclawProbe?.channels?.feishu?.probe?.ok,
    });
    res.json(diagnostics);
  } catch (error) {
    appendAudit(req, 'diagnostics.probe', false, { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

function assertOpenClawAvailable() {
  return new Promise((resolve, reject) => {
    fs.access(OPENCLAW_BIN, fs.constants.X_OK, (error) => {
      if (error) reject(new Error(`未检测到 openclaw 命令，请确认 ${OPENCLAW_BIN} 存在且可执行。`));
      else resolve();
    });
  });
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitForGatewayState(expectedRunning, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const isRunning = await checkGatewayStatus();
    if (isRunning === expectedRunning) return true;
    await sleep(500);
  }
  return false;
}

async function stopGateway() {
  const processes = await getGatewayProcesses();
  if (processes.length === 0) return { changed: false, pids: [] };
  for (const p of processes) { try { process.kill(p.pid, 'SIGTERM'); } catch (e) { if (e.code !== 'ESRCH') throw e; } }
  let stopped = await waitForGatewayState(false, 8000);
  if (!stopped) {
    const remaining = await getGatewayProcesses();
    for (const p of remaining) { try { process.kill(p.pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') throw e; } }
    stopped = await waitForGatewayState(false, 5000);
  }
  if (!stopped) throw new Error('Gateway 进程未能在超时时间内停止。');
  return { changed: true, pids: processes.map((p) => p.pid) };
}

async function startGateway() {
  await assertOpenClawAvailable();
  if (await checkGatewayStatus()) return { changed: false, pids: (await getGatewayProcesses()).map((p) => p.pid) };
  const child = spawn(OPENCLAW_BIN, ['gateway', '--port', GATEWAY_PORT], { detached: true, stdio: 'ignore', env: { ...process.env, PATH: DASHBOARD_PATH } });
  child.unref();
  const started = await waitForGatewayState(true, 20000);
  if (!started) throw new Error('Gateway 进程未能在超时时间内启动。');
  return { changed: true, pids: (await getGatewayProcesses()).map((p) => p.pid) };
}

async function runGatewayControl(action) {
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

function runOpenClawDaemonCommand(action) {
  return new Promise((resolve, reject) => {
    execFile(OPENCLAW_BIN, ['daemon', action], { env: { ...process.env, PATH: DASHBOARD_PATH }, timeout: 30000 }, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || stdout || error.message).trim()));
      else resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

function sendMacOSAlert(message = 'Gateway 进程意外终止，请前往管理面板检查！', title = 'OpenClaw 告警') {
  return new Promise((resolve) => {
    const script = `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)} sound name "Basso"`;
    execFile('osascript', ['-e', script], { timeout: 5000 }, (error) => {
      if (error) console.error('[Watchdog] macOS 通知发送失败:', error.message);
      resolve();
    });
  });
}

async function runWatchdogCheck() {
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

async function initializeWatchdogState() {
  try {
    wasRunning = await checkGatewayStatus();
    console.log(`[Watchdog] 初始 Gateway 状态: ${wasRunning ? 'running' : 'stopped'}`);
  } catch (error) {
    wasRunning = null;
    console.error('[Watchdog] 初始状态读取失败:', error.message);
  }
}

async function runChannelWatchdogCheck() {
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

function sanitizeOutput(text) {
  return String(text || '').slice(-UPDATE_OUTPUT_TAIL_CHARS);
}

function resetUpdateJob() {
  updateJob = {
    id: `update-${Date.now()}`,
    running: true,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    steps: [],
    message: '更新任务已开始。',
    error: null,
    postUpdateDiagnostics: null,
  };
  persistUpdateJob();
}

function addUpdateStep(name, status, detail = '') {
  updateJob.steps.push({
    name,
    status,
    detail: sanitizeOutput(detail),
    timestamp: new Date().toISOString(),
  });
  persistUpdateJob();
}

function finishUpdateJob(status, message, error = null) {
  updateJob.running = false;
  updateJob.status = status;
  updateJob.message = message;
  updateJob.error = error ? String(error).slice(0, 1200) : null;
  updateJob.finishedAt = new Date().toISOString();
  persistUpdateJob();
}

function execOpenClawUpdate() {
  return new Promise((resolve, reject) => {
    execFile(OPENCLAW_BIN, ['update', '--yes', '--json', '--no-restart'], {
      env: { ...process.env, PATH: DASHBOARD_PATH },
      timeout: 300000,
    }, (error, stdout, stderr) => {
      const output = `${stdout || ''}${stderr || ''}`;
      if (error && !stdout.trim()) {
        reject(new Error((stderr || error.message).trim()));
        return;
      }

      try {
        resolve({ success: true, output, data: JSON.parse(stdout.trim()) });
      } catch {
        resolve({ success: true, output, data: { message: output.trim() || 'openclaw update 已执行。' } });
      }
    });
  });
}

async function runUpdateJob(req, shouldRestartGateway) {
  try {
    addUpdateStep('停止 Gateway', 'running');
    if (shouldRestartGateway) {
      await runGatewayControl('stop');
      addUpdateStep('停止 Gateway', 'success', 'Gateway 已停止。');
    } else {
      addUpdateStep('停止 Gateway', 'skipped', 'Gateway 原本未运行，跳过停止步骤。');
    }

    addUpdateStep('更新 OpenClaw', 'running');
    const updateResult = await execOpenClawUpdate();
    addUpdateStep('更新 OpenClaw', 'success', updateResult.output || updateResult.data?.message || '更新命令执行完成。');

    addUpdateStep('运行 doctor', 'running');
    try {
      const doctorResult = await new Promise((resolve) => {
        execFile(OPENCLAW_BIN, ['doctor'], { env: { ...process.env, PATH: DASHBOARD_PATH }, timeout: 60000 }, (error, stdout, stderr) => {
          resolve({ ok: !error, output: `${stdout || ''}${stderr || error?.message || ''}` });
        });
      });
      addUpdateStep('运行 doctor', doctorResult.ok ? 'success' : 'warning', doctorResult.output);
    } catch (error) {
      addUpdateStep('运行 doctor', 'warning', error.message);
    }

    addUpdateStep('重启 Gateway', 'running');
    if (shouldRestartGateway) {
      await runGatewayControl('start');
      addUpdateStep('重启 Gateway', 'success', 'Gateway 已恢复运行。');
    } else {
      addUpdateStep('重启 Gateway', 'skipped', 'Gateway 更新前未运行，保持停止状态。');
    }

    addUpdateStep('升级后复检', 'running');
    try {
      const diagnostics = await buildDiagnostics();
      updateJob.postUpdateDiagnostics = {
        collectedAt: diagnostics.collectedAt,
        gatewayRunning: diagnostics.gateway.isRunning,
        feishuDirectOk: diagnostics.feishuDirect?.ok,
        feishuProbeOk: diagnostics.openclawProbe?.channels?.feishu?.probe?.ok,
        telegramProbeOk: diagnostics.openclawProbe?.channels?.telegram?.probe?.ok,
        recommendations: diagnostics.recommendations,
      };
      persistUpdateJob();
      const hasWarning = diagnostics.recommendations?.some((item) => item.level === 'warning' || item.level === 'critical');
      addUpdateStep('升级后复检', hasWarning ? 'warning' : 'success', diagnostics.recommendations?.map((item) => `${item.title}: ${item.detail}`).join('\n') || '复检完成。');
    } catch (error) {
      addUpdateStep('升级后复检', 'warning', error.message);
    }

    finishUpdateJob('success', 'OpenClaw 更新流程已完成。');
    appendAudit(req, 'update', true, { jobId: updateJob.id, restartedGateway: shouldRestartGateway });
  } catch (error) {
    addUpdateStep('更新失败', 'error', error.message);
    finishUpdateJob('error', 'OpenClaw 更新流程失败。', error.message);
    appendAudit(req, 'update', false, { jobId: updateJob.id, error: error.message });
  }
}

app.post('/api/control', async (req, res) => {
  const { action } = req.body || {};
  if (!CONTROL_ACTIONS.has(action)) return res.status(400).json({ success: false, message: '无效操作，仅支持 start、stop、restart。' });
  try {
    const result = await runGatewayControl(action);
    appendAudit(req, `gateway.${action}`, true, { pids: result.pids, isRunning: result.isRunning });
    res.json({ success: true, action, ...result });
  } catch (error) {
    appendAudit(req, `gateway.${action}`, false, { error: error.message });
    res.status(500).json({ success: false, action, message: `执行 gateway ${action} 指令失败。`, detail: error.message });
  }
});

// Update OpenClaw: stop gateway → update → restart gateway
app.post('/api/update', async (req, res) => {
  try {
    if (req.body?.dryRun) {
      appendAudit(req, 'update.dryRun', true);
      return res.json({ success: true, dryRun: true, message: 'dryRun 已确认，未执行真实更新。' });
    }

    if (req.body?.confirm !== true) {
      return res.status(400).json({ success: false, message: '更新操作需要显式确认。' });
    }

    if (updateJob.running) {
      return res.status(409).json({ success: false, message: '已有更新任务正在执行。', job: updateJob });
    }

    await assertOpenClawAvailable();
    const preflight = await buildUpdatePreflight();
    if (!preflight.updateAvailable) {
      appendAudit(req, 'update.preflight', false, { reason: 'no-update', latestVersion: preflight.latestVersion });
      return res.status(409).json({ success: false, message: '升级前预检未检测到可用更新。', preflight });
    }
    const blockingFailures = preflight.checks.filter((check) => !check.ok && ['磁盘空间', 'CLI 兼容性'].includes(check.name));
    if (blockingFailures.length) {
      appendAudit(req, 'update.preflight', false, { failures: blockingFailures });
      return res.status(409).json({ success: false, message: '升级前预检未通过，请先处理阻断项。', preflight });
    }
    appendAudit(req, 'update.preflight', true, { latestVersion: preflight.latestVersion });
    const shouldRestartGateway = await checkGatewayStatus();
    resetUpdateJob();
    res.json({ success: true, accepted: true, message: '更新任务已进入后台执行。', job: updateJob, preflight });
    runUpdateJob(req, shouldRestartGateway);
  } catch (error) {
    appendAudit(req, 'update', false, { error: error.message });
    res.status(500).json({ success: false, message: '更新过程出错：' + error.message });
  }
});

app.get('/api/update/status', (req, res) => {
  res.json(updateJob);
});

async function readAuditEntries(limit = 30) {
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

async function readRecentErrorEntries(maxLines = 1000, maxResults = 10) {
  const result = await readRecentErrorEntriesWithMeta(maxLines, maxResults);
  return result.errors;
}

async function readRecentErrorEntriesWithMeta(maxLines = 1000, maxResults = 10) {
  const pattern = /error|failed|fail|timeout|unauthorized|denied|crash|exception|degraded|fatal/i;
  const muteRules = getActiveLogMuteRules();
  let mutedCount = 0;
  async function readErrorLines(filePath) {
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

app.get('/api/audit', async (req, res) => {
  try {
    const entries = await readAuditEntries(30);
    res.json({ entries, count: entries.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/metrics', async (req, res) => {
  try {
    const processes = await getGatewayProcesses();
    const gwProc = processes[0] || null;
    let gateway = { pid: null, isRunning: processes.length > 0, uptime: null, uptimeSeconds: null, memoryRssMb: null, command: null };
    if (gwProc) {
      gateway.pid = gwProc.pid; gateway.command = gwProc.command;
      try {
        const psInfo = await getProcessResourceInfo(gwProc.pid);
        if (psInfo) {
          gateway.uptime = psInfo.etime; gateway.memoryRssMb = psInfo.rssKb ? Math.round(psInfo.rssKb / 1024) : null;
          const etime = psInfo.etime;
          if (etime) {
            const parts = etime.split('-'); let timePart = etime; let days = 0;
            if (parts.length > 1) { days = parseInt(parts[0], 10) || 0; timePart = parts[1]; }
            const tparts = timePart.split(':').map(Number); let secs = days * 86400;
            if (tparts.length === 3) secs += tparts[0] * 3600 + tparts[1] * 60 + tparts[2];
            else if (tparts.length === 2) secs += tparts[0] * 60 + tparts[1];
            gateway.uptimeSeconds = secs;
          }
        }
      } catch (_) {}
    }
    const [feishuHealth, telegramHealth, feishuStats, telegramStats] = await Promise.all([
      getChannelHealth('feishu'),
      getChannelHealth('telegram'),
      getChannelMessageStats('feishu'),
      getChannelMessageStats('telegram'),
    ]);
    const channels = {
      feishu: { ...feishuHealth, stats: feishuStats },
      telegram: { ...telegramHealth, stats: telegramStats },
    };
    const disk = await getDiskInfo();
    // Memory info (macOS: accurate via vm_stat; page size 16384 on Apple Silicon)
    const [localVersion, latestRelease, model] = await Promise.all([getLocalVersion(), getLatestReleaseInfo(), getCurrentModelInfo()]);
    const memory = await new Promise((resolve) => {
      execFile('vm_stat', [], { timeout: 5000 }, (err, stdout) => {
        if (err) {
          const totalBytes = os.totalmem();
          const freeBytes = os.freemem();
          resolve({ totalGb: (totalBytes/1024/1024/1024).toFixed(1), freeGb: (freeBytes/1024/1024/1024).toFixed(1), usedGb: ((totalBytes-freeBytes)/1024/1024/1024).toFixed(1), usedPercent: Math.round(((totalBytes-freeBytes)/totalBytes)*100), reclaimableGb: '0.0', source: 'freemem' });
          return;
        }
        const stats = {};
        for (const line of stdout.split('\n')) {
          const m = line.match(/^\s*(.+?):\s*(\d+)\./);
          if (m) stats[m[1].trim()] = parseInt(m[2], 10) || 0;
        }
        const pagesize = 16384;
        const freePages = stats['Pages free'] || 0;
        const activePages = stats['Pages active'] || 0;
        const inactivePages = stats['Pages inactive'] || 0;
        const speculativePages = stats['Pages speculative'] || 0;
        const wiredPages = stats['Pages wired down'] || 0;
        const compressedPages = stats['Pages occupied by compressor'] || 0;
        const totalBytes = os.totalmem();
        const trulyFreeBytes = freePages * pagesize;
        const reclaimableBytes = (inactivePages + speculativePages) * pagesize;
        // 已用 = Active (压缩已计入"可回收"范畴,回收时自动解压)
        const appUsedBytes = activePages * pagesize;
        const compressedBytes = compressedPages * pagesize;
        const hardwareReserved = totalBytes - (freePages + activePages + inactivePages + speculativePages + wiredPages + compressedPages) * pagesize;
        resolve({
          totalGb: (totalBytes/1024/1024/1024).toFixed(1),
          freeGb: (trulyFreeBytes/1024/1024/1024).toFixed(1),
          reclaimableGb: (reclaimableBytes/1024/1024/1024).toFixed(1),
          usedGb: (appUsedBytes/1024/1024/1024).toFixed(1),
          usedPercent: Math.round((appUsedBytes/totalBytes)*100),
          activeGb: (activePages * pagesize/1024/1024/1024).toFixed(1),
          compressedGb: (compressedBytes/1024/1024/1024).toFixed(1),
          wiredGb: (wiredPages * pagesize/1024/1024/1024).toFixed(1),
          source: 'vm_stat',
        });
      });
    });
    const memoryProcesses = await getTopMemoryProcesses();
    const updateAvailable = Boolean(parseVersion(localVersion) && parseVersion(latestRelease.latestVersion) && isVersionGreater(latestRelease.latestVersion, localVersion));
    res.json({ gateway, channels, disk, memory, memoryProcesses, version: { local: localVersion, latest: latestRelease.latestVersion, updateAvailable, releaseUrl: latestRelease.releaseUrl, publishedAt: latestRelease.publishedAt, source: latestRelease.source }, model, collectedAt: new Date().toISOString() });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/timeline', async (req, res) => {
  try {
    const [auditEntries, errorEntries, channels, gatewayRunning] = await Promise.all([
      readAuditEntries(20),
      readRecentErrorEntries(1200, 12),
      checkChannelsStatus(),
      checkGatewayStatus(),
    ]);

    const events = [];
    const now = new Date().toISOString();

    events.push({
      timestamp: now,
      type: gatewayRunning ? 'gateway.ok' : 'gateway.offline',
      level: gatewayRunning ? 'ok' : 'critical',
      title: gatewayRunning ? 'Gateway 正在运行' : 'Gateway 未运行',
      detail: gatewayRunning ? '当前进程检测正常。' : '未检测到 Gateway 进程。',
      source: 'runtime',
    });

    for (const channel of ['feishu', 'telegram']) {
      const detail = channels.detail?.[channel] || {};
      events.push({
        timestamp: detail.lastSeenAt || now,
        type: `channel.${channel}.${detail.status || 'unknown'}`,
        level: detail.status === 'online' ? 'ok' : 'warning',
        title: `${channel === 'feishu' ? '飞书' : 'Telegram'}通道 ${detail.status === 'online' ? '在线' : '离线'}`,
        detail: detail.reason || detail.lastError || '无更多细节。',
        source: 'channel',
      });
    }

    for (const entry of auditEntries) {
      events.push({
        timestamp: entry.timestamp,
        type: entry.action,
        level: entry.success ? 'info' : 'warning',
        title: `操作：${entry.action}`,
        detail: `${entry.success ? '成功' : '失败'} · ${String(entry.ip || 'unknown').replace(/^::ffff:/, '')}`,
        source: 'audit',
      });
    }

    for (const error of errorEntries) {
      events.push({
        timestamp: error.timestamp || now,
        type: 'log.error',
        level: 'warning',
        title: `错误日志：${error.source}`,
        detail: error.message,
        source: 'logs',
      });
    }

    for (const step of updateJob.steps || []) {
      events.push({
        timestamp: step.timestamp,
        type: `update.${step.status}`,
        level: step.status === 'error' ? 'critical' : step.status === 'warning' ? 'warning' : 'info',
        title: `更新步骤：${step.name}`,
        detail: step.detail || step.status,
        source: 'update',
      });
    }

    events.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
    res.json({ events: events.slice(0, 40), collectedAt: now });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function runCommandCheck(name, file, args, timeoutMs = 12000, json = false) {
  return new Promise((resolve) => {
    execFile(file, args, { env: { ...process.env, PATH: DASHBOARD_PATH }, timeout: timeoutMs }, (error, stdout, stderr) => {
      const output = `${stdout || ''}${stderr || ''}`.trim();
      let parsed = null;
      let jsonOk = false;
      if (json && stdout.trim()) {
        try {
          parsed = JSON.parse(stdout.trim());
          jsonOk = true;
        } catch {}
      }
      resolve({
        name,
        ok: !error && (!json || jsonOk),
        command: [path.basename(file), ...args].join(' '),
        error: error ? (stderr || stdout || error.message).trim().slice(0, 500) : null,
        output: output.slice(0, 500),
        jsonOk,
        data: parsed,
      });
    });
  });
}

async function buildCompatibilityReport() {
  const checks = [];
  checks.push(await runCommandCheck('OpenClaw CLI 可执行', OPENCLAW_BIN, ['--version'], 5000));
  checks.push(await runCommandCheck('daemon 控制命令可用', OPENCLAW_BIN, ['daemon', '--help'], 8000));
  checks.push(await runCommandCheck('channels status 帮助可用', OPENCLAW_BIN, ['channels', 'status', '--help'], 8000));
  checks.push(await runCommandCheck('doctor 命令可用', OPENCLAW_BIN, ['doctor', '--help'], 8000));
  checks.push(await runCommandCheck('update 命令可用', OPENCLAW_BIN, ['update', '--help'], 8000));

  const probe = await runCommandCheck('channels status --probe --json 结构', OPENCLAW_BIN, ['channels', 'status', '--probe', '--json'], 35000, true);
  const channels = probe.data?.channels || {};
  const schemaOk = Boolean(probe.ok && channels.feishu?.probe && channels.telegram?.probe);
  checks.push({
    ...probe,
    ok: schemaOk,
    requiredFields: ['channels.feishu.probe', 'channels.telegram.probe'],
    error: schemaOk ? null : (probe.error || 'JSON 缺少看板依赖的通道 probe 字段。'),
  });

  const required = checks.length;
  const passed = checks.filter((check) => check.ok).length;
  return {
    ok: passed === required,
    passed,
    required,
    checks: checks.map(({ data, ...check }) => check),
    collectedAt: new Date().toISOString(),
  };
}

async function fetchGithubVersionSource() {
  try {
    const response = await axios.get('https://api.github.com/repos/openclaw/openclaw/releases', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'openclaw-dash' },
      params: { per_page: 20 },
      timeout: 8000,
    });
    const releases = Array.isArray(response.data) ? response.data.filter((release) => !release.draft) : [];
    const latest = releases
      .filter((release) => !release.prerelease && parseVersion(release.tag_name))
      .sort((a, b) => compareVersions(b.tag_name, a.tag_name))[0];
    return { name: 'GitHub Releases', ok: Boolean(latest), latestVersion: latest?.tag_name || null, status: latest ? 'ok' : 'empty', detail: latest ? latest.html_url : '未找到稳定 release。' };
  } catch (error) {
    return { name: 'GitHub Releases', ok: false, latestVersion: null, status: 'error', detail: error.response?.data?.message || error.message };
  }
}

async function fetchNpmVersionSource() {
  try {
    const response = await axios.get('https://registry.npmjs.org/openclaw/latest', {
      headers: { Accept: 'application/json', 'User-Agent': 'openclaw-dash' },
      timeout: 8000,
    });
    return { name: 'npm registry', ok: Boolean(response.data?.version), latestVersion: response.data?.version ? `v${response.data.version}` : null, status: 'ok', detail: 'registry.npmjs.org/openclaw/latest' };
  } catch (error) {
    return { name: 'npm registry', ok: false, latestVersion: null, status: 'error', detail: error.response?.data?.error || error.message };
  }
}

function fetchDashCacheVersionSource() {
  const cached = readJsonFile(DASH_VERSION_CACHE_PATH);
  const fresh = Boolean(cached?.latestVersion && isFreshTimestamp(cached.cachedAt, DASH_VERSION_CACHE_MAX_AGE_MS));
  return {
    name: 'Dash cache',
    ok: fresh,
    latestVersion: cached?.latestVersion || null,
    status: cached?.latestVersion ? (fresh ? 'ok' : 'stale') : 'empty',
    detail: cached?.cachedAt
      ? `缓存于 ${cached.cachedAt}${fresh ? '' : '，已超过 7 天，不再作为版本依据。'}`
      : '暂无 dashboard 版本缓存。',
  };
}

async function buildVersionSourcesHealth() {
  const [github, npmSource] = await Promise.all([fetchGithubVersionSource(), fetchNpmVersionSource()]);
  const cache = fetchDashCacheVersionSource();
  return { sources: [github, npmSource, cache], collectedAt: new Date().toISOString() };
}

async function buildUpdatePreflight() {
  const [gatewayProcesses, disk, localVersion, latestRelease, compatibility, diagnostics] = await Promise.all([
    getGatewayProcesses(),
    getDiskInfo(),
    getLocalVersion(),
    getLatestReleaseInfo(),
    buildCompatibilityReport(),
    buildDiagnostics(),
  ]);
  disk.ok = disk.freeGb == null ? false : disk.freeGb >= 2;
  const updateAvailable = Boolean(parseVersion(localVersion) && parseVersion(latestRelease.latestVersion) && isVersionGreater(latestRelease.latestVersion, localVersion));
  const checks = [
    { name: '版本差异', ok: updateAvailable, detail: updateAvailable ? `${localVersion} → ${latestRelease.latestVersion}` : '当前未检测到可用更新。' },
    { name: '磁盘空间', ok: disk.ok, detail: disk.freeGb == null ? '无法读取磁盘空间。' : `可用 ${disk.freeGb} GB，已用 ${disk.usedPercent}%` },
    { name: 'Gateway 状态', ok: true, detail: gatewayProcesses.length ? `当前运行中，升级会先停止再恢复。PID ${gatewayProcesses[0].pid}` : '当前未运行，升级后会保持停止状态。' },
    { name: 'CLI 兼容性', ok: compatibility.ok, detail: `${compatibility.passed}/${compatibility.required} 项通过` },
    { name: '飞书探针', ok: Boolean(diagnostics.openclawProbe?.channels?.feishu?.probe?.ok), detail: diagnostics.openclawProbe?.channels?.feishu?.probe?.error || 'OK' },
    { name: 'Telegram 探针', ok: Boolean(diagnostics.openclawProbe?.channels?.telegram?.probe?.ok), detail: diagnostics.openclawProbe?.channels?.telegram?.probe?.error || 'OK' },
  ];
  return {
    ok: checks.every((check) => check.ok || check.name === 'Gateway 状态'),
    localVersion,
    latestVersion: latestRelease.latestVersion,
    updateAvailable,
    checks,
    collectedAt: new Date().toISOString(),
  };
}

function summarizeChannelConfig(config, channel) {
  const value = config.channels?.[channel] || {};
  return {
    channel,
    enabled: Boolean(value.enabled),
    connectionMode: value.connectionMode || null,
    dmPolicy: value.dmPolicy || null,
    groupPolicy: value.groupPolicy || null,
    allowFromCount: Array.isArray(value.allowFrom) ? value.allowFrom.length : 0,
    groupAllowFromCount: Array.isArray(value.groupAllowFrom) ? value.groupAllowFrom.length : 0,
    blockStreamingConfigured: Object.prototype.hasOwnProperty.call(value, 'blockStreaming'),
    blockStreaming: value.blockStreaming ?? null,
    hasSecret: Boolean(value.appSecret || value.botToken || value.accounts),
  };
}

function buildConfigHealth() {
  const config = readJsonFile(OPENCLAW_CONFIG_PATH) || {};
  const plugins = config.plugins?.entries || {};
  return {
    configExists: fs.existsSync(OPENCLAW_CONFIG_PATH),
    channels: ['feishu', 'telegram', 'email'].map((channel) => summarizeChannelConfig(config, channel)),
    plugins: Object.keys(plugins).sort().map((name) => ({ name, enabled: Boolean(plugins[name]?.enabled) })),
    collectedAt: new Date().toISOString(),
  };
}

app.get('/api/compatibility', async (req, res) => {
  try { res.json(await buildCompatibilityReport()); } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/update/preflight', async (req, res) => {
  try { res.json(await buildUpdatePreflight()); } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/version/sources', async (req, res) => {
  try { res.json(await buildVersionSourcesHealth()); } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/config/health', (req, res) => {
  try { res.json(buildConfigHealth()); } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/errors', async (req, res) => {
  try {
    const result = await readRecentErrorEntriesWithMeta(1000, 10);
    res.json({ count: result.errors.length, mutedCount: result.mutedCount, activeMuteRules: result.activeRules, errors: result.errors, collectedAt: new Date().toISOString() });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/log-rules', (req, res) => {
  const rules = loadLogMuteRules();
  res.json({ rules, activeCount: rules.filter((rule) => rule.enabled).length });
});

app.post('/api/log-rules', (req, res) => {
  const { id, enabled } = req.body || {};
  const rules = loadLogMuteRules();
  const target = rules.find((rule) => rule.id === id);
  if (!target) return res.status(404).json({ success: false, message: '未知日志降噪规则。' });

  target.enabled = Boolean(enabled);
  persistLogMuteRules(rules);
  appendAudit(req, 'log-rule.update', true, { id, enabled: target.enabled });
  res.json({ success: true, rules });
});

function startDashboard() {
  return app.listen(PORT, HOST, async () => {
    console.log(`OpenClaw Dash is running at http://${HOST}:${PORT}`);
    await initializeWatchdogState();
    runChannelWatchdogCheck();
    setInterval(runWatchdogCheck, WATCHDOG_INTERVAL_MS);
    setInterval(runChannelWatchdogCheck, CHANNEL_ALERT_INTERVAL_MS);
  });
}

if (require.main === module) {
  startDashboard();
}

// Process memory info
// Process name mapping → human-readable Chinese
const PROCESS_NAMES = {
  '/Applications/Telegram': 'Telegram',
  'Telegram': 'Telegram',
  '/Applications/Google Chrome.app': 'Google Chrome',
  '/Applications/Google Chrome': 'Google Chrome',
  'Google Chrome': 'Google Chrome',
  '/Applications/M-iM': '飞书/Lark',
  '/Applications/Lark.app': '飞书/Lark',
  'Lark': '飞书/Lark',
  'Feishu': '飞书/Lark',
  'claude': 'Claude',
  '/Library/Input': '输入法',
  'input': '输入法',
  'Spotlight': 'Spotlight (聚焦搜索)',
  'mds_stores': 'mds_stores (索引)',
  'corespotlightd': 'corespotlightd (索引)',
  'Terminal': 'Terminal (终端)',
  'node': 'Node.js',
  '/usr/local/bin/node': 'Node.js',
  'python': 'Python',
  'O+Connect': 'OPPO Connect',
  'WeChatAppEx': '微信',
  'WeChat': '微信',
  'com.tencent.xinWeChat': '微信',
  '/Applications/M-eM': '微信',
};

function getProcessDisplayName(cmd) {
  if (!cmd) return '?';
  for (const [key, val] of Object.entries(PROCESS_NAMES)) {
    if (cmd.includes(key)) return val;
  }
  const m = cmd.match(/\/([^\/\s]+)\.app\//);
  if (m) {
    const app = m[1];
    if (app.startsWith('M-iM')) return '飞书/Lark';
    if (app.includes('Telegram')) return 'Telegram';
    if (app.includes('Google')) return 'Google Chrome';
    if (app.includes('Lark') || app.includes('Feishu')) return '飞书/Lark';
    if (app.includes('Claude')) return 'Claude';
    if (app.includes('O+Connect')) return 'OPPO Connect';
    return app;
  }
  if (cmd.startsWith('/usr/local/bin/') || cmd.startsWith('/usr/bin/')) return cmd.split('/').pop();
  if (cmd.startsWith('/')) return cmd.split('/').pop();
  return cmd;
}

function aggregateProcesses(processes) {
  const grouped = {};
  for (const p of processes) {
    const key = p.name;
    if (!grouped[key]) {
      grouped[key] = { name: p.name, memMb: 0, user: p.user, count: 0 };
    }
    grouped[key].memMb += parseFloat(p.memMb);
    grouped[key].count++;
  }
  return Object.values(grouped)
    .map(g => ({ ...g, memMb: g.memMb.toFixed(1) }))
    .sort((a, b) => parseFloat(b.memMb) - parseFloat(a.memMb));
}

function getTopMemoryProcesses(limit = 25) {
  return new Promise((resolve) => {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 25, 100));
    execFile('ps', ['axo', 'rss=,user=,command='], { timeout: 5000 }, (err, stdout) => {
      if (err || !stdout.trim()) { resolve([]); return; }
      const processes = stdout.trim().split('\n').map((line) => {
        const parts = line.trim().match(/^(\d+)\s+(\S+)\s+(.+)$/);
        if (!parts) return null;
        const rssKb = Number(parts[1]);
        return {
          memMb: Number.isFinite(rssKb) ? (rssKb / 1024).toFixed(1) : '0.0',
          user: parts[2],
          cmd: parts[3],
          name: getProcessDisplayName(parts[3]),
        };
      }).filter(Boolean)
        .sort((a, b) => parseFloat(b.memMb) - parseFloat(a.memMb))
        .slice(0, safeLimit);
      resolve(aggregateProcesses(processes));
    });
  });
}

module.exports = {
  app,
  startDashboard,
  isValidDashboardToken,
  isValidSessionToken,
  maskableExportPatterns: [
    'ou_* / cli_* identifiers',
    'long numeric identifiers',
    'IPv4 addresses',
    'PID values',
    '/Users/* paths',
  ],
};
