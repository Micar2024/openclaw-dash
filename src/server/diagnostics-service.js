const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const {
  CHANNEL_STATS_TAIL_LINES,
  DASHBOARD_PATH,
  LOG_PATH,
  OPENCLAW_BIN,
  OPENCLAW_CONFIG_PATH
} = require('./config');
const { readJsonFile, readTail } = require('./runtime');

let channelProbeCache = { value: null, expiresAt: 0, promise: null };

function execJsonFile (file, args, timeoutMs = 15000) {
  return new Promise((resolve) => {
    execFile(file, args, { env: { ...process.env, PATH: DASHBOARD_PATH }, timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, error: (stderr || stdout || error.message).trim(), data: null });
        return;
      }

      try {
        resolve({ ok: true, error: null, data: JSON.parse(stdout.trim()) });
      } catch (parseError) {
        resolve({ ok: false, error: `JSON parse failed: ${parseError.message}`, data: null, raw: stdout.trim().slice(-1000) });
      }
    });
  });
}

function extractTimestamp (line) {
  if (!line) return null;
  const match = line.match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})/);
  return match ? match[1] : null;
}

async function getLatestAgentModelLine () {
  const content = await readTail(LOG_PATH, CHANNEL_STATS_TAIL_LINES);
  return content.split(/\r?\n/).reverse().find((line) => /agent model:/i.test(line))?.trim() || '';
}

function resolveModelMetadata (config, modelId) {
  if (!config || !modelId) return {};
  const provider = modelId.includes('/') ? modelId.split('/')[0] : null;
  const shortId = provider ? modelId.slice(provider.length + 1) : modelId;
  const providerConfig = provider ? config.models?.providers?.[provider] : null;
  const providerModels = Array.isArray(providerConfig?.models) ? providerConfig.models : [];
  const modelMeta = providerModels.find((m) => m.id === shortId || m.id === modelId) || {};
  const configuredAlias = config.agents?.defaults?.models?.[modelId]?.alias || null;
  return { provider, id: modelId, name: modelMeta.name || shortId || modelId, alias: configuredAlias, contextWindow: modelMeta.contextWindow || null, maxTokens: modelMeta.maxTokens || null, reasoning: typeof modelMeta.reasoning === 'boolean' ? modelMeta.reasoning : null, input: Array.isArray(modelMeta.input) ? modelMeta.input : [] };
}

async function getCurrentModelInfo () {
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

async function runOpenClawChannelProbe () {
  const result = await execJsonFile(OPENCLAW_BIN, ['channels', 'status', '--probe', '--json'], 35000);
  if (!result.ok) return { ok: false, error: result.error, channels: {} };
  return { ok: true, error: null, ...result.data };
}

async function getCachedOpenClawChannelProbe (force = false) {
  const now = Date.now();
  if (!force && channelProbeCache.value && channelProbeCache.expiresAt > now) return channelProbeCache.value;
  if (!force && channelProbeCache.promise) return channelProbeCache.promise;

  channelProbeCache.promise = runOpenClawChannelProbe()
    .then((probe) => {
      channelProbeCache = {
        value: probe,
        expiresAt: Date.now() + 15000,
        promise: null
      };
      return probe;
    })
    .catch((error) => {
      const probe = { ok: false, error: error.message, channels: {} };
      channelProbeCache = {
        value: probe,
        expiresAt: Date.now() + 5000,
        promise: null
      };
      return probe;
    });

  return channelProbeCache.promise;
}

function getFeishuSecretPath (config) {
  const secretRef = config.channels?.feishu?.appSecret || {};
  if (secretRef.source === 'file' && typeof secretRef.id === 'string') {
    const cleanId = secretRef.id.replace(/^\/+/, '');
    const candidate = path.join(os.homedir(), '.openclaw/credentials', `${cleanId}.json`);
    if (fs.existsSync(candidate)) return { path: candidate, source: `openclaw-config:${secretRef.id}` };
  }

  const fallback = path.join(os.homedir(), '.openclaw/credentials/lark.secrets.json');
  return fs.existsSync(fallback) ? { path: fallback, source: 'legacy-lark-secret-file' } : { path: null, source: null };
}

function getNestedValue (source, keyPath) {
  return keyPath.split('.').reduce((value, key) => (value && typeof value === 'object' ? value[key] : undefined), source);
}

function resolveFeishuAppSecret (config) {
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
    return { value: null, source: null, schema: null, file: null, warning: 'Feishu credential file was not found; setting OPENCLAW_DASH_FEISHU_APP_SECRET is recommended.' };
  }

  const secrets = readJsonFile(secretLocation.path) || {};
  const candidates = [
    'appSecret',
    'app_secret',
    'lark.appSecret',
    'lark.app_secret',
    'feishu.appSecret',
    'feishu.app_secret'
  ];
  const matchedPath = candidates.find((candidate) => typeof getNestedValue(secrets, candidate) === 'string' && getNestedValue(secrets, candidate).trim());
  const value = matchedPath ? getNestedValue(secrets, matchedPath).trim() : null;

  return {
    value,
    source: secretLocation.source,
    schema: matchedPath || null,
    file: secretLocation.path,
    warning: value ? null : 'Feishu credential file exists, but appSecret was not recognized; setting OPENCLAW_DASH_FEISHU_APP_SECRET is recommended.'
  };
}

function getFeishuCredentials () {
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
    credentialWarning: secret.warning
  };
}

async function getFeishuDirectProbe () {
  const creds = getFeishuCredentials();
  const baseUrl = creds.domain === 'larksuite' ? 'https://open.larksuite.com' : 'https://open.feishu.cn';

  if (!creds.enabled) return { ok: false, error: 'Feishu channel is disabled.', appId: creds.appId, connectionMode: creds.connectionMode, blockStreamingConfigured: creds.blockStreamingConfigured };
  if (!creds.appId || !creds.appSecret) return { ok: false, error: creds.credentialWarning || 'Feishu App ID or App Secret could not be read.', appId: creds.appId, appIdSource: creds.appIdSource, connectionMode: creds.connectionMode, blockStreamingConfigured: creds.blockStreamingConfigured, credentialSource: creds.credentialSource, credentialSchema: creds.credentialSchema };

  try {
    const tokenResponse = await axios.post(`${baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
      app_id: creds.appId,
      app_secret: creds.appSecret
    }, { timeout: 8000 });

    if (tokenResponse.data?.code !== 0 || !tokenResponse.data?.tenant_access_token) {
      return { ok: false, error: tokenResponse.data?.msg || 'tenant_access_token fetch failed.', appId: creds.appId, appIdSource: creds.appIdSource, connectionMode: creds.connectionMode, credentialSource: creds.credentialSource, credentialSchema: creds.credentialSchema };
    }

    const headers = { Authorization: `Bearer ${tokenResponse.data.tenant_access_token}` };
    const [botInfo, ping] = await Promise.all([
      axios.get(`${baseUrl}/open-apis/bot/v3/info`, { headers, timeout: 8000 }).catch((error) => ({ error })),
      axios.post(`${baseUrl}/open-apis/bot/v1/openclaw_bot/ping`, {}, { headers, timeout: 8000 }).catch((error) => ({ error }))
    ]);

    const botError = botInfo.error;
    const pingError = ping.error;
    const pingOk = !pingError && ping.data?.code === 0;

    return {
      ok: pingOk,
      error: pingOk ? null : (pingError?.response?.data?.msg || pingError?.response?.data?.message || pingError?.message || 'Feishu bot ping failed.'),
      appId: creds.appId,
      appIdSource: creds.appIdSource,
      botOpenId: botError ? null : botInfo.data?.bot?.open_id || null,
      botName: botError ? null : botInfo.data?.bot?.name || null,
      connectionMode: creds.connectionMode,
      blockStreamingConfigured: creds.blockStreamingConfigured,
      blockStreaming: creds.blockStreaming ?? null,
      secretFile: creds.secretFile,
      credentialSource: creds.credentialSource,
      credentialSchema: creds.credentialSchema
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
      credentialSchema: creds.credentialSchema
    };
  }
}

function buildRecommendations ({ gatewayRunning, channels, openclawProbe, feishuDirect, model, version }) {
  const recommendations = [];
  const feishuGatewayProbe = openclawProbe?.channels?.feishu?.probe;

  if (!gatewayRunning) {
    recommendations.push({ level: 'critical', title: 'Gateway is not running', detail: 'Click Start above. If startup fails, check: 1. `openclaw --version`; 2. `openclaw doctor` for `~/.openclaw/openclaw.json`; 3. `lsof -i :18789` for port conflicts.' });
  }

  if (feishuDirect?.ok && feishuGatewayProbe && feishuGatewayProbe.ok === false) {
    const upgradeHint = version?.updateAvailable
      ? `A newer version ${version.latest} is available; update first and rerun diagnostics. The 5.3 series includes the Feishu SDK path fix.`
      : 'Wait for plugin updates, or update and restart Gateway before rerunning diagnostics.';
    recommendations.push({
      level: 'warning',
      title: 'Feishu API works, but the Gateway probe failed',
      detail: `This looks more like an OpenClaw/Feishu plugin runtime or long-connection adaptation issue: ${feishuGatewayProbe.error || 'Unknown error'}.${upgradeHint}`
    });
  } else if (channels?.detail?.feishu?.status === 'offline') {
    recommendations.push({ level: 'warning', title: 'Feishu channel offline', detail: (channels.detail.feishu.reason || 'No recent healthy signal detected.') + ' Troubleshooting: 1. confirm network access to the Feishu Open Platform (`curl -I https://open.feishu.cn`); 2. check whether the Feishu appSecret expired; 3. restart Gateway and observe for 5 minutes.' });
  }

  if (channels?.detail?.telegram?.status === 'offline') {
    recommendations.push({ level: 'warning', title: 'Telegram channel offline', detail: (channels.detail.telegram.reason || 'No recent healthy signal detected.') + ' Troubleshooting: 1. confirm botToken validity; 2. check Telegram server status; 3. restart Gateway and observe for 5 minutes.' });
  }

  if (version?.updateAvailable) {
    recommendations.push({ level: 'info', title: 'OpenClaw update available', detail: `Local ${version.local || '-'}, latest ${version.latest || '-'}. Update during an idle window.` });
  }

  if (!model?.current) {
    recommendations.push({ level: 'info', title: 'Current model not detected', detail: 'Model information could not be read from config or Gateway logs. Send any message to the bot; model data should refresh after the next model call. If it remains unavailable, check `models.providers` in `openclaw.json` for syntax errors.' });
  }

  if (!recommendations.length) {
    recommendations.push({ level: 'ok', title: 'Core status healthy', detail: 'Gateway, channels, and model checks found no new high-priority issues. If the experience still feels wrong, export a diagnostic report and ask the community for help.' });
  }

  return recommendations;
}

function createDiagnosticsService (deps) {
  async function buildDiagnostics () {
    const [gatewayProcesses, openclawProbe, feishuDirect, localVersion, latestRelease, model] = await Promise.all([
      deps.getGatewayProcesses(),
      getCachedOpenClawChannelProbe(true),
      getFeishuDirectProbe(),
      deps.getLocalVersion(),
      deps.getLatestReleaseInfo(),
      getCurrentModelInfo()
    ]);
    const channels = await deps.checkChannelsStatus(openclawProbe);
    const version = {
      local: localVersion,
      latest: latestRelease.latestVersion,
      updateAvailable: Boolean(deps.parseVersion(localVersion) && deps.parseVersion(latestRelease.latestVersion) && deps.isVersionGreater(latestRelease.latestVersion, localVersion)),
      releaseUrl: latestRelease.releaseUrl,
      source: latestRelease.source
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
        version
      })
    };
  }

  return { buildDiagnostics };
}

async function runCommandCheck (name, file, args, timeoutMs = 12000, json = false) {
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
        data: parsed
      });
    });
  });
}

async function buildCompatibilityReport () {
  const checks = [];
  checks.push(await runCommandCheck('OpenClaw CLI executable', OPENCLAW_BIN, ['--version'], 5000));
  checks.push(await runCommandCheck('daemon control command available', OPENCLAW_BIN, ['daemon', '--help'], 8000));
  checks.push(await runCommandCheck('channels status help available', OPENCLAW_BIN, ['channels', 'status', '--help'], 8000));
  checks.push(await runCommandCheck('doctor command available', OPENCLAW_BIN, ['doctor', '--help'], 8000));
  checks.push(await runCommandCheck('update command available', OPENCLAW_BIN, ['update', '--help'], 8000));

  const probe = await runCommandCheck('channels status --probe --json schema', OPENCLAW_BIN, ['channels', 'status', '--probe', '--json'], 35000, true);
  const channels = probe.data?.channels || {};
  const channelNames = Object.keys(channels);
  const schemaOk = Boolean(probe.ok && channelNames.length && channelNames.every((name) => typeof channels[name] === 'object'));
  checks.push({
    ...probe,
    ok: schemaOk,
    requiredFields: ['channels.<name>'],
    detectedChannels: channelNames,
    error: schemaOk ? null : (probe.error || 'JSON is missing the channels status object.')
  });

  const required = checks.length;
  const passed = checks.filter((check) => check.ok).length;
  return {
    ok: passed === required,
    passed,
    required,
    checks: checks.map(({ data, ...check }) => check),
    collectedAt: new Date().toISOString()
  };
}

function summarizeChannelConfig (config, channel) {
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
    hasSecret: Boolean(value.appSecret || value.botToken || value.accounts)
  };
}

function buildConfigHealth () {
  const config = readJsonFile(OPENCLAW_CONFIG_PATH) || {};
  const plugins = config.plugins?.entries || {};
  const configuredChannels = Object.keys(config.channels || {});
  const channels = [...new Set([...configuredChannels, 'feishu', 'telegram'])].sort((a, b) => {
    const priority = { feishu: 0, telegram: 1 };
    return (priority[a] ?? 20) - (priority[b] ?? 20) || a.localeCompare(b);
  });
  return {
    configExists: fs.existsSync(OPENCLAW_CONFIG_PATH),
    channels: channels.map((channel) => summarizeChannelConfig(config, channel)),
    plugins: Object.keys(plugins).sort().map((name) => ({ name, enabled: Boolean(plugins[name]?.enabled) })),
    collectedAt: new Date().toISOString()
  };
}

module.exports = {
  buildCompatibilityReport,
  buildConfigHealth,
  createDiagnosticsService,
  getCachedOpenClawChannelProbe,
  getCurrentModelInfo,
  getFeishuCredentials,
  getFeishuDirectProbe,
  runCommandCheck
};
