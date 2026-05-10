const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const zlib = require('zlib');

function writeFile (filePath, content, mode) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, mode ? { mode } : undefined);
}

function waitForRealtimeSnapshot (server, token) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws/events?token=${encodeURIComponent(token)}`);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('Timed out waiting for realtime snapshot.'));
    }, 5000);

    ws.on('message', (message) => {
      const payload = JSON.parse(message.toString());
      if (payload.type !== 'snapshot') return;
      clearTimeout(timer);
      ws.close();
      resolve(payload.data);
    });
    ws.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function request (server, pathname, options = {}) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: address.port,
      path: pathname,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => { chunks.push(chunk); });
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        const body = raw.toString('utf8');
        let json = null;
        try {
          json = body ? JSON.parse(body) : null;
        } catch {}
        resolve({ status: res.statusCode, body, json, raw });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function parseTarFileNames (buffer) {
  const names = [];
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const sizeText = header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim();
    const size = parseInt(sizeText, 8) || 0;
    if (name) names.push(name);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return names;
}

async function main () {
  const { buildMarkdownReport } = require('../src/server/reports');
  const partialReport = await buildMarkdownReport({
    buildMetrics: async () => { throw new Error('metrics unavailable'); },
    buildDiagnostics: async () => ({ recommendations: [{ level: 'info', title: 'partial-ok', detail: 'diagnostics survived' }] }),
    buildHealthSummary: async () => { throw new Error('health unavailable'); },
    readRecentErrorEntriesWithMeta: async () => ({ errors: [] })
  });
  assert.match(partialReport, /健康概览收集失败/);
  assert.match(partialReport, /Gateway 指标收集失败/);
  assert.match(partialReport, /partial-ok/);

  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-dash-test-'));
  process.env.HOME = tempHome;
  process.env.DASHBOARD_HOST = '127.0.0.1';
  process.env.DASHBOARD_PORT = '0';
  process.env.DASHBOARD_TOKEN = 'endpoint-mock-token';

  const openclawBin = path.join(tempHome, '.npm-global/bin/openclaw');
  writeFile(openclawBin, `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "OpenClaw 2026.5.3 (mock)"
  exit 0
fi
if [ "$1" = "channels" ] && [ "$2" = "status" ]; then
  echo '{"channels":{"feishu":{"probe":{"ok":true}},"telegram":{"probe":{"ok":true}},"email":{"probe":{"ok":true},"running":true}}}'
  exit 0
fi
if [ "$1" = "daemon" ]; then
  echo "daemon $2 ok"
  exit 0
fi
if [ "$1" = "update" ] && [ "$2" = "--help" ]; then
  echo "update help"
  exit 0
fi
if [ "$1" = "update" ]; then
  echo "update failed" >&2
  exit 1
fi
if [ "$1" = "doctor" ]; then
  echo "doctor ok"
  exit 0
fi
echo "{}"
`, 0o755);

  writeFile(path.join(tempHome, '.openclaw/openclaw.json'), JSON.stringify({
    channels: {
      lark: { enabled: true, allowFrom: ['ou_mock'], appId: 'cli_mock', token: 'gateway_mock_token' },
      telegram: { enabled: true, allowFrom: ['123456'], botToken: '123456:mockTelegramTokenValue' },
      email: { enabled: true, allowFrom: ['test@example.com'] }
    },
    plugins: { entries: {} },
    agents: {
      defaults: {
        model: {
          primary: 'easyrouter/deepseek-v4-flash',
          fallbacks: ['easyrouter/gemini-2.5-flash']
        },
        models: {
          'easyrouter/deepseek-v4-flash': { alias: 'ER Flash' }
        }
      }
    },
    models: {
      providers: {
        easyrouter: {
          models: [{
            id: 'deepseek/deepseek-v4-flash',
            name: 'DeepSeek V4 Flash',
            contextWindow: 128000,
            maxTokens: 8192,
            reasoning: true
          }]
        }
      }
    }
  }));
  writeFile(path.join(tempHome, '.openclaw/logs/gateway.log'), [
    '2026-05-05T10:00:00 [feishu] connected',
    '2026-05-05T10:00:01 [gateway] telegram polling logs are quiet in this fixture',
    '2026-05-05T10:00:02 agent model: easyrouter/deepseek-v4-flash',
    '2026-05-05T10:00:03 error token=abc123secret path=/Users/alice/.openclaw/openclaw.json open_id=ou_mocksecret ip=192.168.1.2 chat=123456789 url=https://api.telegram.org/bot123456789:ABCdefghijklmnopqrstuvwxyz/getMe runId=638d64ce-b68a-4157-bbe3-6e2829d0888b'
  ].join('\n'));

  const { getFeishuCredentials } = require('../src/server/diagnostics-service');
  const feishuCredentials = getFeishuCredentials();
  assert.strictEqual(feishuCredentials.appId, 'cli_mock');
  assert.strictEqual(feishuCredentials.appIdSource, 'openclaw-config:channels.lark.appId');

  const { createUpdateService } = require('../src/server/update-service');
  const { parseVersion, isVersionGreater } = require('../src/server/version-service');
  let gatewayRunning = true;
  const gatewayActions = [];
  const updateService = createUpdateService({
    appendAudit: () => {},
    buildCompatibilityReport: async () => ({ ok: true, passed: 1, required: 1, checks: [] }),
    buildDiagnostics: async () => ({ openclawProbe: { channels: {} }, recommendations: [] }),
    getGatewayProcesses: async () => gatewayRunning ? [{ pid: 123, command: 'openclaw gateway' }] : [],
    getLatestReleaseInfo: async () => ({ latestVersion: 'v2026.5.4' }),
    getLocalVersion: async () => 'OpenClaw 2026.5.3',
    isVersionGreater,
    parseVersion,
    runGatewayControl: async (action) => {
      gatewayActions.push(action);
      if (action === 'stop') gatewayRunning = false;
      if (action === 'start') gatewayRunning = true;
      return { success: true };
    }
  });
  updateService.resetUpdateJob();
  await updateService.runUpdateJob({ headers: {}, get: () => '', socket: {} }, true);
  assert.strictEqual(updateService.getUpdateJob().status, 'error');
  assert.deepStrictEqual(gatewayActions, ['stop', 'start']);
  assert.ok(updateService.getUpdateJob().steps.some((step) => step.name === '恢复 Gateway' && step.status === 'success'));

  const { startDashboard } = require('../server');
  const server = startDashboard();
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const authStatus = await request(server, '/api/auth/status');
    assert.strictEqual(authStatus.status, 200);
    assert.strictEqual(authStatus.json.local, true);

    const unauthorized = await request(server, '/api/metrics');
    assert.strictEqual(unauthorized.status, 401);

    const headers = { Authorization: 'Bearer endpoint-mock-token' };
    const version = await request(server, '/api/version', { headers });
    assert.strictEqual(version.status, 200);
    assert.strictEqual(version.json.installed, true);
    assert.match(version.json.version, /2026\.5\.3/);

    const channels = await request(server, '/api/channels', { headers });
    assert.strictEqual(channels.status, 200);
    assert.strictEqual(channels.json.feishu, 'online');
    assert.strictEqual(channels.json.telegram, 'online');
    assert.strictEqual(channels.json.detail.email.status, 'online');
    assert.ok(channels.json.items.some((channel) => channel.id === 'email'));

    const config = await request(server, '/api/config/health', { headers });
    assert.strictEqual(config.status, 200);
    assert.strictEqual(config.json.configExists, true);

    const coreFiles = await request(server, '/api/core-files/health', { headers });
    assert.strictEqual(coreFiles.status, 200);
    assert.ok(Number.isFinite(coreFiles.json.score));
    assert.ok(Array.isArray(coreFiles.json.checks));
    assert.ok(coreFiles.json.checks.some((check) => check.id === 'openclaw-config-json' && check.level === 'ok'));
    assert.ok(coreFiles.json.checks.some((check) => check.id === 'openclaw-config-inline-secrets' && check.level === 'ok'));
    assert.match(coreFiles.json.privacy, /不会读取或输出密钥内容/);

    const diagnostics = await request(server, '/api/diagnostics', { headers });
    assert.strictEqual(diagnostics.status, 200);
    assert.strictEqual(diagnostics.json.openclawProbe.ok, true);

    const model = await request(server, '/api/model', { headers });
    assert.strictEqual(model.status, 200);
    assert.strictEqual(model.json.alias, 'ER Flash');
    assert.strictEqual(model.json.contextWindow, 128000);
    assert.strictEqual(model.json.maxTokens, 8192);
    assert.strictEqual(model.json.reasoning, true);

    const setup = await request(server, '/api/setup/status', { headers });
    assert.strictEqual(setup.status, 200);
    assert.ok(Array.isArray(setup.json.checks));
    assert.strictEqual(setup.json.remoteMode, false);

    const health = await request(server, '/api/health/summary', { headers });
    assert.strictEqual(health.status, 200);
    assert.ok(Number.isFinite(health.json.score));
    assert.ok(Array.isArray(health.json.checks));

    const officialDashboard = await request(server, '/api/official-dashboard', { headers });
    assert.strictEqual(officialDashboard.status, 200);
    assert.match(officialDashboard.json.url, /127\.0\.0\.1/);

    const troubleshooting = await request(server, '/api/troubleshooting', { headers });
    assert.strictEqual(troubleshooting.status, 200);
    assert.ok(Array.isArray(troubleshooting.json.steps));

    const preflight = await request(server, '/api/update/preflight', { headers });
    assert.strictEqual(preflight.status, 200);
    assert.ok(Array.isArray(preflight.json.checks));

    const report = await request(server, '/api/report.md', { headers });
    assert.strictEqual(report.status, 200);
    assert.match(report.body, /OpenClaw Dash 诊断报告/);
    assert.match(report.body, /Gateway/);
    assert.match(report.body, /官方 Dashboard/);
    assert.match(report.body, /故障排查路径/);
    assert.match(report.body, /核心文件健康/);
    assert.match(report.body, /脱敏说明/);
    assert.match(report.body, /容错说明/);
    assert.doesNotMatch(report.body, /abc123secret|\/Users\/alice|ou_mocksecret|192\.168\.1\.2|ABCdefghijklmnopqrstuvwxyz|638d64ce/);
    assert.match(report.body, /\| Email \| online \|/);

    const bundle = await request(server, '/api/support-bundle.tgz', { headers });
    assert.strictEqual(bundle.status, 200);
    const bundleNames = parseTarFileNames(zlib.gunzipSync(bundle.raw));
    assert.deepStrictEqual(bundleNames.sort(), [
      'compatibility.json',
      'config-health.json',
      'core-files-health.json',
      'diagnostics.json',
      'environment.json',
      'errors.json',
      'health.json',
      'manifest.json',
      'metrics.json',
      'official-dashboard.json',
      'report.md',
      'troubleshooting.json'
    ].sort());

    const snapshot = await waitForRealtimeSnapshot(server, 'endpoint-mock-token');
    assert.strictEqual(snapshot.channels.feishu, 'online');
    assert.strictEqual(snapshot.channels.telegram, 'online');
    assert.ok(snapshot.channels.items.some((channel) => channel.id === 'email'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
}

main().then(() => {
  console.log('Endpoint mock tests passed.');
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
