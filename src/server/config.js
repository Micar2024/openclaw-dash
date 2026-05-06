const os = require('os');
const path = require('path');

const HOME = os.homedir();

const PORT = Number(process.env.DASHBOARD_PORT || 3000);
const HOST = process.env.DASHBOARD_HOST || '127.0.0.1';
const ERR_LOG_PATH = path.join(HOME, '.openclaw/logs/gateway.err.log');
const TOKEN_PATH = path.join(HOME, '.openclaw/dash-token');
const AUDIT_LOG_PATH = path.join(HOME, '.openclaw/dash-audit.log');
const UPDATE_JOB_PATH = path.join(HOME, '.openclaw/dash-update-job.json');
const DASH_VERSION_CACHE_PATH = path.join(HOME, '.openclaw/dash-version-cache.json');
const LOG_MUTE_RULES_PATH = path.join(HOME, '.openclaw/dash-log-muted-rules.json');
const LOG_PATH = path.join(HOME, '.openclaw/logs/gateway.log');
const OPENCLAW_CONFIG_PATH = path.join(HOME, '.openclaw/openclaw.json');
const UPDATE_CHECK_PATH = path.join(HOME, '.openclaw/update-check.json');
const OPENCLAW_BIN = process.env.OPENCLAW_BIN || path.join(HOME, '.npm-global/bin/openclaw');
const GATEWAY_PORT = process.env.OPENCLAW_GATEWAY_PORT || '18789';
const GATEWAY_HOST = process.env.OPENCLAW_GATEWAY_HOST || '127.0.0.1';
const DASHBOARD_PATH = [
  path.join(HOME, '.npm-global/bin'),
  '/usr/local/bin',
  '/opt/homebrew/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin'
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

const DEFAULT_LOG_MUTE_RULES = [
  {
    id: 'feishu-open-id-resolved-unknown',
    label: '飞书 bot open_id 解析失败 (resolved: unknown)',
    description: '飞书插件解析发送者 open_id 时的已知无害日志，已排除出错误统计。',
    pattern: 'bot open_id resolved:\\s*unknown|resolved:\\s*unknown',
    enabled: true
  }
];

module.exports = {
  AUDIT_LOG_PATH,
  CHANNEL_ALERT_AFTER_MS,
  CHANNEL_ALERT_INTERVAL_MS,
  CHANNEL_STATS_TAIL_LINES,
  CONTROL_ACTIONS,
  DASH_VERSION_CACHE_MAX_AGE_MS,
  DASH_VERSION_CACHE_PATH,
  DASHBOARD_PATH,
  DEFAULT_LOG_MUTE_RULES,
  ERR_LOG_PATH,
  GATEWAY_HOST,
  GATEWAY_PORT,
  HOST,
  LOG_MUTE_RULES_PATH,
  LOG_PATH,
  OPENCLAW_BIN,
  OPENCLAW_CONFIG_PATH,
  PORT,
  SESSION_COOKIE,
  SESSION_MAX_AGE_MS,
  TOKEN_PATH,
  UPDATE_CHECK_PATH,
  UPDATE_JOB_PATH,
  UPDATE_OUTPUT_TAIL_CHARS,
  WATCHDOG_INTERVAL_MS
};
