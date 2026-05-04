const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

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
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = body ? JSON.parse(body) : null;
        } catch {}
        resolve({ status: res.statusCode, body, json });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function main () {
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
  echo '{"channels":{"feishu":{"probe":{"ok":true}},"telegram":{"probe":{"ok":true}}}}'
  exit 0
fi
if [ "$1" = "daemon" ]; then
  echo "daemon $2 ok"
  exit 0
fi
if [ "$1" = "doctor" ]; then
  echo "doctor ok"
  exit 0
fi
echo "{}"
`, 0o755);

  writeFile(path.join(tempHome, '.openclaw/openclaw.json'), JSON.stringify({
    channels: {
      feishu: { enabled: false, allowFrom: ['ou_mock'], appId: 'cli_mock' },
      telegram: { enabled: false, allowFrom: ['123456'] }
    },
    plugins: { entries: {} }
  }));
  writeFile(path.join(tempHome, '.openclaw/logs/gateway.log'), [
    '2026-05-05T10:00:00 [feishu] connected',
    '2026-05-05T10:00:01 [telegram] connected',
    '2026-05-05T10:00:02 agent model: mock/provider'
  ].join('\n'));

  const { startDashboard } = require('../server');
  const server = startDashboard();
  await new Promise((resolve) => server.once('listening', resolve));

  try {
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

    const config = await request(server, '/api/config/health', { headers });
    assert.strictEqual(config.status, 200);
    assert.strictEqual(config.json.configExists, true);

    const diagnostics = await request(server, '/api/diagnostics', { headers });
    assert.strictEqual(diagnostics.status, 200);
    assert.strictEqual(diagnostics.json.openclawProbe.ok, true);

    const snapshot = await waitForRealtimeSnapshot(server, 'endpoint-mock-token');
    assert.strictEqual(snapshot.channels.feishu, 'online');
    assert.strictEqual(snapshot.channels.telegram, 'online');
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
