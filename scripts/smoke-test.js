const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const serverPath = path.join(root, 'server.js');
const htmlPath = path.join(root, 'public', 'index.html');
const cssPath = path.join(root, 'public', 'assets', 'app.css');
const html2canvasPath = path.join(root, 'public', 'vendor', 'html2canvas.min.js');

function fail(message) {
  console.error(`Smoke test failed: ${message}`);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')}\n${result.stderr || result.stdout}`);
  }
}

run(process.execPath, ['--check', serverPath]);

const server = fs.readFileSync(serverPath, 'utf8');
if (/(?<!\.)\bexec\s*\(/.test(server)) {
  fail('server.js should use execFile/spawn instead of shell-string exec().');
}

if (/const\s+\{[^}]*\bexec\b[^}]*\}\s*=\s*require\(['"]child_process['"]\)/.test(server)) {
  fail('server.js should not import child_process.exec.');
}

const inferFn = server.match(/function inferLatestChannelStatus\(line\) \{[\s\S]*?\n\}/);
if (!inferFn || !inferFn[0].includes("return 'unknown';")) {
  fail('inferLatestChannelStatus should return unknown when there is no positive or negative signal.');
}

if (/secrets\.(lark|feishu)\?\.appSecret|secrets\.appSecret/.test(server)) {
  fail('Feishu secret lookup should use explicit credential resolution rather than inline schema guesses.');
}

const html = fs.readFileSync(htmlPath, 'utf8');
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
    new Function(script);
  } catch (error) {
    fail(`public/index.html inline script #${index + 1} does not parse: ${error.message}`);
  }
}

console.log('Smoke tests passed.');
