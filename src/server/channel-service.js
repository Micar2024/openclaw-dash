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
  const realVerifyState = {};
  const REAL_VERIFY_TTL_MS = 10 * 60 * 1000;
  const channelLabels = {
    feishu: 'Feishu',
    lark: 'Lark',
    telegram: 'Telegram',
    email: 'Email',
    slack: 'Slack',
    discord: 'Discord',
    wechat: 'WeChat',
    wecom: 'WeCom'
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
    if (channel === 'feishu') return ['feishu', 'lark', '\u98de\u4e66'];
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

  function verificationMeta (source, channel, detail) {
    const labels = {
      direct: 'Direct verify',
      probe: 'CLI probe',
      log: 'Log signal',
      config: 'Config only',
      none: 'No signal'
    };
    const confidence = {
      direct: 'high',
      probe: 'high',
      log: 'medium',
      config: 'low',
      none: 'low'
    };
    return {
      source,
      label: labels[source] || source,
      confidence: confidence[source] || 'low',
      detail: detail || `${getChannelLabel(channel)} 使用 ${labels[source] || source} 判断状态。`
    };
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
      if (/status code 400/i.test(lastErrorLine)) return '最近一次连接请求返回 400，通道可能需要适配升级后的配置。';
      if (/connect failed|unable to connect/i.test(lastErrorLine)) return '检测到最近一次连接失败。';
      return '最新错误日志晚于最新健康信号。';
    }

    if (lastSignalLine && status === 'online') return '最新 healthy signal 晚于最新 error signal。';
    return '近期没有足够的 healthy signal 证明该 channel 在线。';
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
    const verificationDetail = status === 'online' ? `OpenClaw CLI 返回 ${onlineReason}。` : 'OpenClaw CLI 未确认 channel 在线。';

    return {
      id: channel,
      label,
      supportsVerify: supportsRealVerify(channel),
      status,
      lastSeenAt,
      lastSignalAt: status === 'online' ? lastSeenAt : null,
      lastErrorAt: null,
      lastError,
      verification: verificationMeta('probe', channel, verificationDetail),
      reason: status === 'online'
        ? `OpenClaw CLI probe 确认 ${label} ${onlineReason}。`
        : (configured ? (lastError || 'OpenClaw CLI probe 未确认 channel 在线。') : 'OpenClaw CLI 报告 channel 未配置。')
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
        verification: probeHealth.verification,
        reason: probeHealth.reason
      };
    }
    if (logHealth.status === 'online') return logHealth;
    return {
      ...logHealth,
      lastSeenAt: logHealth.lastSeenAt || probeHealth.lastSeenAt,
      lastError: logHealth.lastError || probeHealth.lastError,
      verification: probeHealth.verification || logHealth.verification,
      reason: probeHealth.reason || logHealth.reason
    };
  }

  function applyRealVerification (channel, health) {
    const verified = realVerifyState[channel];
    if (!verified || Date.now() - verified.verifiedAt > REAL_VERIFY_TTL_MS) return health;
    return {
      ...health,
      status: verified.received ? 'online' : health.status,
      lastSeenAt: verified.lastInboundAt || health.lastSeenAt,
      lastSignalAt: verified.received ? (verified.lastInboundAt || new Date(verified.verifiedAt).toISOString()) : health.lastSignalAt,
      verification: verificationMeta(
        'direct',
        channel,
        verified.received
          ? '最近一次 direct verify 已发送测试消息，并确认 Gateway 有活动。'
          : '最近一次 direct verify 已发送测试消息，但 Gateway 活动尚未确认。'
      ),
      reason: verified.received
        ? 'Direct verify 确认测试消息已发送，Gateway 活动正常。'
        : health.reason
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
        verification: verificationMeta('config', channel, '该 channel 已在配置中禁用。'),
        reason: '该 channel 已在配置中禁用。'
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
      verification: verificationMeta(lastSignalLine ? 'log' : 'none', channel, lastSignalLine ? 'Gateway 日志中发现近期 healthy signal。' : '没有 log 或 probe signal 能证明该 channel 在线。'),
      reason: explainChannelStatus(channel, status, lastSignalLine, lastErrorLine)
    };
    return applyRealVerification(channel, mergeChannelHealth(logHealth, deriveChannelHealthFromProbe(channel, probe)));
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

    if (!receiveId) throw new Error('Feishu allowFrom is empty, so the test-message recipient cannot be determined.');
    if (!creds.appId || !creds.appSecret) throw new Error('Feishu App ID or App Secret could not be read.');

    const tokenResponse = await axios.post(`${baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
      app_id: creds.appId,
      app_secret: creds.appSecret
    }, { timeout: 8000 });
    const tenantToken = tokenResponse.data?.tenant_access_token;
    if (tokenResponse.data?.code !== 0 || !tenantToken) throw new Error(tokenResponse.data?.msg || 'tenant_access_token fetch failed.');

    const text = `OpenClaw Dash channel verification ${new Date().toLocaleString('en-US', { hour12: false })}`;
    const response = await axios.post(`${baseUrl}/open-apis/im/v1/messages`, {
      receive_id: receiveId,
      msg_type: 'text',
      content: JSON.stringify({ text })
    }, {
      params: { receive_id_type: 'open_id' },
      headers: { Authorization: `Bearer ${tenantToken}` },
      timeout: 10000
    });

    if (response.data?.code !== 0) throw new Error(response.data?.msg || 'Feishu test message failed to send.');
    const health = await getChannelHealth('feishu', await deps.getCachedOpenClawChannelProbe(true));
    return {
      channel: 'feishu',
      sent: true,
      received: health.status === 'online',
      messageId: response.data?.data?.message_id || null,
      target: receiveId,
      lastInboundAt: health.lastSeenAt,
      note: 'Test message sent through the official Feishu API; receiving side uses recent Gateway activity as reference.'
    };
  }

  async function verifyTelegramChannel () {
    const creds = getTelegramCredentials();
    if (!creds.enabled) throw new Error('Telegram channel is disabled.');
    if (!creds.botToken || !creds.chatId) throw new Error('Telegram botToken or allowFrom is not configured.');

    const text = `OpenClaw Dash channel verification ${new Date().toLocaleString('en-US', { hour12: false })}`;
    const response = await axios.post(`https://api.telegram.org/bot${creds.botToken}/sendMessage`, {
      chat_id: creds.chatId,
      text
    }, { timeout: 10000 });

    if (!response.data?.ok) throw new Error(response.data?.description || 'Telegram test message failed to send.');
    const health = await getChannelHealth('telegram', await deps.getCachedOpenClawChannelProbe(true));
    return {
      channel: 'telegram',
      sent: true,
      received: health.status === 'online',
      messageId: response.data?.result?.message_id || null,
      target: creds.chatId,
      lastInboundAt: health.lastSeenAt,
      note: 'Test message sent through Telegram Bot API; receiving side uses recent Gateway activity as reference.'
    };
  }

  async function verifyChannel (channel) {
    let result;
    if (channel === 'feishu') result = await verifyFeishuChannel();
    else if (channel === 'telegram') result = await verifyTelegramChannel();
    else throw new Error('Only feishu or telegram is supported.');
    realVerifyState[channel] = {
      sent: Boolean(result.sent),
      received: Boolean(result.received),
      lastInboundAt: result.lastInboundAt,
      verifiedAt: Date.now()
    };
    return result;
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
        const label = `${health.label || getChannelLabel(channel)} Channel`;

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
          await deps.sendMacOSAlert(`${label} has been offline for more than 5 minutes. Please check the dashboard.${health.reason ? `\n${health.reason}` : ''}`, 'OpenClaw Channel Alert');
        }
      }
    } catch (error) {
      console.error('[ChannelWatchdog] Status check failed:', error.message);
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
