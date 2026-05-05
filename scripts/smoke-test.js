const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const serverPath = path.join(root, 'server.js');
const configPath = path.join(root, 'src', 'server', 'config.js');
const routeDir = path.join(root, 'src', 'server', 'routes');
const htmlPath = path.join(root, 'public', 'index.html');
const appJsPath = path.join(root, 'public', 'assets', 'app.js');
const cssPath = path.join(root, 'public', 'assets', 'app.css');
const html2canvasPath = path.join(root, 'public', 'vendor', 'html2canvas.min.js');

function fail (message) {
  console.error(`Smoke test failed: ${message}`);
  process.exit(1);
}

function run (command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')}\n${result.stderr || result.stdout}`);
  }
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
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function runEndpointSmokeTests () {
  process.env.DASHBOARD_TOKEN = 'smoke-test-token';
  process.env.DASHBOARD_HOST = '127.0.0.1';
  process.env.DASHBOARD_PORT = '0';
  const { app } = require(serverPath);
  const serverInstance = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => serverInstance.once('listening', resolve));

  try {
    const publicAuthStatus = await request(serverInstance, '/api/auth/status');
    if (publicAuthStatus !== 200) fail(`/api/auth/status should be public, got ${publicAuthStatus}.`);

    for (const route of ['/api/status', '/api/metrics', '/api/update/preflight']) {
      const status = await request(serverInstance, route);
      if (status !== 401) fail(`${route} should require authentication, got ${status}.`);
    }

    const authedStatus = await request(serverInstance, '/api/status', {
      headers: { Authorization: 'Bearer smoke-test-token' }
    });
    if (authedStatus >= 500) fail(`/api/status should not 5xx with a valid token, got ${authedStatus}.`);
  } finally {
    await new Promise((resolve) => serverInstance.close(resolve));
  }
}

async function main () {
  run(process.execPath, ['--check', serverPath]);

  const server = fs.readFileSync(serverPath, 'utf8');
  const installer = fs.readFileSync(path.join(root, 'install.sh'), 'utf8');
  const channelService = fs.readFileSync(path.join(root, 'src', 'server', 'channel-service.js'), 'utf8');
  const routeSources = fs.readdirSync(routeDir)
    .filter((file) => file.endsWith('.js'))
    .map((file) => fs.readFileSync(path.join(routeDir, file), 'utf8'))
    .join('\n');
  const apiSources = `${server}\n${routeSources}`;
  if (/(?<!\.)\bexec\s*\(/.test(server)) {
    fail('server.js should use execFile/spawn instead of shell-string exec().');
  }

  if (/const\s+\{[^}]*\bexec\b[^}]*\}\s*=\s*require\(['"]child_process['"]\)/.test(server)) {
    fail('server.js should not import child_process.exec.');
  }

  const inferFn = channelService.match(/function inferLatestChannelStatus\s*\(line\) \{[\s\S]*?\n\}/);
  if (!inferFn || !inferFn[0].includes("return 'unknown';")) {
    fail('inferLatestChannelStatus should return unknown when there is no positive or negative signal.');
  }

  if (/secrets\.(lark|feishu)\?\.appSecret|secrets\.appSecret/.test(server)) {
    fail('Feishu secret lookup should use explicit credential resolution rather than inline schema guesses.');
  }

  if (/(DASHBOARD_TOKEN|APP_SECRET|BOT_TOKEN|ACCESS_TOKEN)\s*=\s*['"][^'"]{12,}/i.test(server)) {
    fail('Potential hardcoded secret assignment found in server.js.');
  }

  if (/git reset --hard|git checkout -B/.test(installer) || /rm -rf\s+["']?\$DASH_DIR/.test(installer)) {
    fail('install.sh should not destructively reset or delete the dashboard directory.');
  }

  if (/cat\s+\$\{HOME\}\/\.openclaw\/dash-token|cat\s+~\/\.openclaw\/dash-token/.test(installer)) {
    fail('install.sh should not print the dashboard token value.');
  }

  for (const route of ['/api/status', '/api/metrics', '/api/diagnostics', '/api/update/preflight', '/api/config/health', '/api/setup/status', '/api/health/summary', '/api/official-dashboard', '/api/troubleshooting', '/api/report.md', '/api/support-bundle.tgz']) {
    if (!apiSources.includes(`'${route}'`) && !apiSources.includes(`"${route}"`)) fail(`Expected API route missing: ${route}`);
  }

  const config = fs.readFileSync(configPath, 'utf8');
  for (const constantName of ['TOKEN_PATH', 'OPENCLAW_CONFIG_PATH', 'LOG_PATH', 'DASH_VERSION_CACHE_PATH']) {
    if (!config.includes(`const ${constantName}`)) fail(`Expected config/path constant missing: ${constantName}`);
  }

  const html = fs.readFileSync(htmlPath, 'utf8');
  const appJs = fs.readFileSync(appJsPath, 'utf8');
  if (/https:\/\/cdn\.tailwindcss\.com|https:\/\/cdn\.jsdelivr\.net/i.test(html)) {
    fail('public/index.html should not depend on external CDN scripts.');
  }

  if (!fs.existsSync(cssPath) || fs.statSync(cssPath).size < 1000) {
    fail('public/assets/app.css is missing or unexpectedly small. Run npm run build:assets.');
  }

  if (!fs.existsSync(html2canvasPath) || fs.statSync(html2canvasPath).size < 1000) {
    fail('public/vendor/html2canvas.min.js is missing or unexpectedly small. Run npm run build:assets.');
  }

  const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  for (const [index, script] of inlineScripts.entries()) {
    try {
      const parsedScript = new vm.Script(script);
      if (!parsedScript) fail(`public/index.html inline script #${index + 1} did not parse.`);
    } catch (error) {
      fail(`public/index.html inline script #${index + 1} does not parse: ${error.message}`);
    }
  }

  try {
    const parsedAppJs = new vm.Script(appJs);
    if (!parsedAppJs) fail('public/assets/app.js did not parse.');
  } catch (error) {
    fail(`public/assets/app.js does not parse: ${error.message}`);
  }

  await runEndpointSmokeTests();
  console.log('Smoke tests passed.');
}

main().catch((error) => fail(error.stack || error.message));
