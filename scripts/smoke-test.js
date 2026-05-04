const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const serverPath = path.join(root, 'server.js');
const htmlPath = path.join(root, 'public', 'index.html');

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

const html = fs.readFileSync(htmlPath, 'utf8');
const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
for (const [index, script] of inlineScripts.entries()) {
  try {
    new Function(script);
  } catch (error) {
    fail(`public/index.html inline script #${index + 1} does not parse: ${error.message}`);
  }
}

console.log('Smoke tests passed.');
