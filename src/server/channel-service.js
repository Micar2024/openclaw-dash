const axios = require('axios');
const {
  CHANNEL_ALERT_AFTER_MS,
  CHANNEL_STATS_TAIL_LINES,
  LOG_PATH,
  OPENCLAW_CONFIG_PATH
} = require('./config');
const { readJsonFile, readTail } = require('./runtime');

function createChannelService (deps) {
  const channelAlertState = {};
  const channelLabels = {
    feishu: '飞书',
    lark: '飞书',
    telegram: 'Telegram',
    email: 'Email',
    slack: 'Slack',
    discord: 'Discord',
    wechat: '微信',
    wecom: '企业微信'
  };

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
    return [channel, channelLabels[channel]].filter(Boolean).map((item) => String(item).toLowerCase());
  }

  function normalizeChannelId (channel) {
    const id = String(channel || '').trim().toLowerCase();
    return id === 'lark' ? 'feishu' : id;
  }

  function getChannelLabel (channel) {
    return channelLabels[channel] || channel.replace(/(^|[-_])([a-z])/g, (_, sep, char) => (sep ? ' ' : '') + char.toUpperCase());
  }

  function supportsRealVerify (channel) {
    return ['feishu', 'telegram'].includes(channel);
  }

  function getConfiguredChannels () {
    const config = readJsonFile(OPENCLAW_CONFIG_PATH) || {};
    const channels = config.channels && typeof config.channels === 'object' ? Object.keys(config.channels) : [];
    return channels.map(normalizeChannelId).filter(Boolean);
  }

  function getChannelConfig (channel) {
    const config = readJsonFile(OPENCLAW_CONFIG_PATH) || {};
    const channels = config.channels && typeof config.channels === 'object' ? config.channels : {};
    return channels[channel] || (channel === 'feishu' ? channels.lark : null) || {};
  }

  function getProbeChannels (probe) {
    const names = new Set();
    for (const key of Object.keys(probe?.channels || {})) names.add(normalizeChannelId(key));
    for (const key of Object.keys(probe?.channelAccounts || {})) names.add(normalizeChannelId(key));
    return [...names].filter(Boolean);
  }

  function getKnownChannels (probe = null) {
    const names = new Set([...getConfiguredChannels(), ...getProbeChannels(probe), 'feishu', 'telegram']);
    return [...names]
      .map(normalizeChannelId)
      .filter(Boolean)
      .sort((a, b) => {
        const priority = { feishu: 0, telegram: 1 };
        return (priority[a] ?? 20) - (priority[b] ?? 20) || a.localeCompare(b);
      });
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

    const label = getChannelLabel(channel);
    const onlineReason = probeOk ? 'probe.ok' : connected ? 'connected' : 'running';

    return {
      id: channel,
      label,
      supportsVerify: supportsRealVerify(channel),
      status,
      lastSeenAt,
      lastSignalAt: status === 'online' ? lastSeenAt : null,
      lastErrorAt: null,
      lastError,
      reason: status === 'online'
        ? `OpenClaw CLI 探针确认 ${label} ${onlineReason}。`
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
    const channelConfig = getChannelConfig(channel);
    if (channelConfig.enabled === false) {
      return {
        id: channel,
        label: getChannelLabel(channel),
        supportsVerify: supportsRealVerify(channel),
        status: 'offline',
        lastSeenAt: null,
        lastSignalAt: null,
        lastErrorAt: null,
        lastError: null,
        reason: '配置中该通道未启用。'
      };
    }

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
      id: channel,
      label: getChannelLabel(channel),
      supportsVerify: supportsRealVerify(channel),
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

      if (hasError && !deps.matchesMutedLogRule(line)) errorCount++;
      if (!at || !hasMessage || hasError) continue;
      if (at >= todayStart) todayMessages++;
      if (at >= oneHourAgo) lastHourMessages++;
    }

    return { todayMessages, lastHourMessages, errorCount, windowLines: lines.length };
  }

  function inferLatestChannelStatus (line) {
    if (!line || !line.trim()) return 'offline';
    const norm = line.trim().toLowerCase();
    const pos = /(^|[^a-z0-9])(connected|online|success|resolved|running|start(?:ed|ing)?|active|login|logged\s*in|ready|authenticated|received|message|reaction|event|dispatch(?:ing)?|provider|register(?:ed|ing)?|command|menu|immediate)(?=$|[^a-z0-9])/gi;
    const neg = /(^|[^a-z0-9])(error|failed|fail|disconnected|disconnect|offline|stopped|closed|timeout|unauthorized|denied|crash(?:ed)?)(?=$|[^a-z0-9])/gi;
    function lastIdx (p) {
      let i = -1;
      let m;
      while ((m = p.exec(norm)) !== null) i = m.index + m[1].length;
      return i;
    }
    const lp = lastIdx(pos);
    const ln = lastIdx(neg);
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
    const creds = deps.getFeishuCredentials();
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
    const health = await getChannelHealth('feishu', await deps.getCachedOpenClawChannelProbe(true));
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
    const health = await getChannelHealth('telegram', await deps.getCachedOpenClawChannelProbe(true));
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
    const channelProbe = probe || await deps.getCachedOpenClawChannelProbe();
    const ids = getKnownChannels(channelProbe);
    const healthEntries = await Promise.all(ids.map(async (id) => [id, await getChannelHealth(id, channelProbe)]));
    const detail = Object.fromEntries(healthEntries);
    const items = healthEntries.map(([, health]) => health);
    return {
      feishu: detail.feishu?.status || 'offline',
      telegram: detail.telegram?.status || 'offline',
      detail,
      items
    };
  }

  async function runChannelWatchdogCheck () {
    try {
      const channels = await checkChannelsStatus();
      const now = Date.now();

      for (const channel of (channels.items || []).map((item) => item.id)) {
        const health = channels.detail?.[channel] || {};
        const state = channelAlertState[channel] || (channelAlertState[channel] = { initialized: false, offlineSince: null, alerted: false });
        const label = `${health.label || getChannelLabel(channel)}通道`;

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
          await deps.sendMacOSAlert(`${label} 已连续离线超过 5 分钟，请前往管理面板检查。${health.reason ? `\n${health.reason}` : ''}`, 'OpenClaw 通道告警');
        }
      }
    } catch (error) {
      console.error('[ChannelWatchdog] 状态检查失败:', error.message);
    }
  }

  return {
    checkChannelsStatus,
    getKnownChannels,
    getChannelHealth,
    getChannelMessageStats,
    inferLatestChannelStatus,
    runChannelWatchdogCheck,
    verifyChannel
  };
}

module.exports = { createChannelService };
