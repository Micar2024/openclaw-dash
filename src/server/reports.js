const os = require('os');
const zlib = require('zlib');
const { redactForExport, redactSensitiveText } = require('./redaction');

async function collectSection (name, fn) {
  try {
    return { name, ok: true, data: await fn(), error: null };
  } catch (error) {
    return { name, ok: false, data: null, error: error.message || String(error) };
  }
}

function markdownEscape (value) {
  return redactSensitiveText(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

async function buildMarkdownReport (deps) {
  const [metricsResult, diagnosticsResult, healthResult, officialResult, troubleshootingResult, errorsResult] = await Promise.all([
    collectSection('metrics', deps.buildMetrics),
    collectSection('diagnostics', deps.buildDiagnostics),
    collectSection('health', deps.buildHealthSummary),
    collectSection('official-dashboard', deps.getOfficialDashboardStatus),
    collectSection('troubleshooting', deps.buildTroubleshootingGuide),
    collectSection('errors', () => deps.readRecentErrorEntriesWithMeta(1000, 8))
  ]);
  const metrics = metricsResult.data || {};
  const diagnostics = diagnosticsResult.data || {};
  const health = healthResult.data || {};
  const official = officialResult.data || {};
  const troubleshooting = troubleshootingResult.data || {};
  const errors = errorsResult.data || { errors: [] };
  const lines = [];
  lines.push('# OpenClaw Dash Diagnostic Report');
  lines.push('');
  lines.push(`Generated at: ${new Date().toLocaleString()}`);
  lines.push('Redaction: common tokens, open_id values, IPs, emails, very long numeric identifiers, and local paths are masked automatically.');
  lines.push('Fault tolerance: a failed data source does not block report generation; failures are marked in their sections.');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  if (healthResult.ok) {
    lines.push(`- Health score: ${health.score}/100`);
    lines.push(`- Conclusion: ${markdownEscape(health.summary)}`);
  } else {
    lines.push(`- Health summary collection failed: ${markdownEscape(healthResult.error)}`);
  }
  lines.push('');
  lines.push('## Gateway');
  lines.push('');
  if (metricsResult.ok) {
    lines.push(`- Status: ${markdownEscape(metrics.gateway?.isRunning ? 'Running' : 'Stopped')}`);
    lines.push(`- ${markdownEscape(`PID: ${metrics.gateway?.pid || '-'}`)}`);
    lines.push(`- Uptime: ${markdownEscape(metrics.gateway?.uptime || '-')}`);
    lines.push(`- Memory: ${markdownEscape(metrics.gateway?.memoryRssMb || '-')} MB`);
  } else {
    lines.push(`- Gateway metrics collection failed: ${markdownEscape(metricsResult.error)}`);
  }
  lines.push('');
  lines.push('## Official Control UI');
  lines.push('');
  if (officialResult.ok) {
    lines.push(`- URL: ${markdownEscape(official.url || '-')}`);
    lines.push(`- Reachable: ${official.reachable ? 'Yes' : 'No'}`);
    lines.push(`- HTTP: ${markdownEscape(official.httpStatus || '-')}`);
    lines.push(`- Auth: ${official.auth?.configured ? 'Configured' : 'No explicit config found'} (mode: ${markdownEscape(official.auth?.mode || '-')})`);
    lines.push(`- Recommendation: ${markdownEscape(official.recommendation || '-')}`);
  } else {
    lines.push(`- Official Control UI status collection failed: ${markdownEscape(officialResult.error)}`);
  }
  lines.push('');
  lines.push('## Troubleshooting Path');
  lines.push('');
  if (troubleshootingResult.ok) {
    for (const step of troubleshooting.steps || []) {
      lines.push(`- ${markdownEscape(step.title)}: ${markdownEscape(step.detail)}`);
    }
  } else {
    lines.push(`- Troubleshooting path collection failed: ${markdownEscape(troubleshootingResult.error)}`);
  }
  lines.push('');
  lines.push('## Version');
  lines.push('');
  if (metricsResult.ok) {
    lines.push(`- Local version: ${markdownEscape(metrics.version?.local || '-')}`);
    lines.push(`- Latest version: ${markdownEscape(metrics.version?.latest || '-')}`);
    lines.push(`- Update available: ${metrics.version?.updateAvailable ? 'Yes' : 'No'}`);
    lines.push(`- Source: ${markdownEscape(metrics.version?.source || '-')}`);
  } else {
    lines.push(`- Version collection failed: ${markdownEscape(metricsResult.error)}`);
  }
  lines.push('');
  lines.push('## Channels');
  lines.push('');
  if (metricsResult.ok) {
    lines.push('| Channel | Status | Confidence | Last Activity | Today | Last Hour | Errors |');
    lines.push('| --- | --- | --- | --- | ---: | ---: | ---: |');
    const channelItems = Array.isArray(metrics.channelItems) && metrics.channelItems.length ? metrics.channelItems : Object.entries(metrics.channels || {}).map(([id, value]) => ({ id, ...value }));
    for (const channel of channelItems) {
      lines.push(`| ${markdownEscape(channel.label || channel.id)} | ${markdownEscape(channel.status)} | ${markdownEscape(channel.verification?.label || '-')} | ${markdownEscape(channel.lastSeenAt || '-')} | ${channel.stats?.todayMessages ?? '-'} | ${channel.stats?.lastHourMessages ?? '-'} | ${channel.stats?.errorCount ?? '-'} |`);
    }
  } else {
    lines.push(`- Channel collection failed: ${markdownEscape(metricsResult.error)}`);
  }
  lines.push('');
  lines.push('## System Resources');
  lines.push('');
  if (metricsResult.ok) {
    lines.push(`- Disk: Free ${markdownEscape(metrics.disk?.freeGb ?? '-')} GB, Used ${markdownEscape(metrics.disk?.usedPercent ?? '-')}%`);
    lines.push(`- Memory: Used ${markdownEscape(metrics.memory?.usedGb ?? '-')} GB / ${markdownEscape(metrics.memory?.totalGb ?? '-')} GB (${markdownEscape(metrics.memory?.usedPercent ?? '-')}%)`);
  } else {
    lines.push(`- System resources collection failed: ${markdownEscape(metricsResult.error)}`);
  }
  lines.push('');
  lines.push('## Recommendations');
  lines.push('');
  if (diagnosticsResult.ok) {
    for (const item of diagnostics.recommendations || []) {
      lines.push(`- ${markdownEscape(item.title)}: ${markdownEscape(item.detail)}`);
    }
  } else {
    lines.push(`- Recommendation collection failed: ${markdownEscape(diagnosticsResult.error)}`);
  }
  lines.push('');
  lines.push('## Recent Errors');
  lines.push('');
  if (!errorsResult.ok) {
    lines.push(`- Error log collection failed: ${markdownEscape(errorsResult.error)}`);
  } else if (!errors.errors.length) {
    lines.push('- No unmuted errors.');
  } else {
    for (const entry of errors.errors) {
      lines.push(`- ${markdownEscape(entry.timestamp || '-')} · ${markdownEscape(entry.source)}: ${markdownEscape(entry.message)}`);
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function writeString (buffer, offset, length, value) {
  buffer.write(String(value || '').slice(0, length), offset, length, 'utf8');
}

function writeOctal (buffer, offset, length, value) {
  const text = Math.max(0, Number(value) || 0).toString(8).padStart(length - 1, '0');
  buffer.write(`${text}\0`.slice(-length), offset, length, 'ascii');
}

function createTarEntry (name, content) {
  const body = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
  const header = Buffer.alloc(512, 0);
  writeString(header, 0, 100, name);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, body.length);
  writeOctal(header, 136, 12, Math.floor(Date.now() / 1000));
  header.fill(' ', 148, 156);
  writeString(header, 156, 1, '0');
  writeString(header, 257, 6, 'ustar');
  writeString(header, 263, 2, '00');
  writeString(header, 265, 32, 'openclaw-dash');
  writeString(header, 297, 32, 'openclaw-dash');

  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeOctal(header, 148, 8, checksum);

  const paddingLength = (512 - (body.length % 512)) % 512;
  return Buffer.concat([header, body, Buffer.alloc(paddingLength, 0)]);
}

function createTarGz (files) {
  const entries = files.map((file) => createTarEntry(file.name, file.content));
  return zlib.gzipSync(Buffer.concat([...entries, Buffer.alloc(1024, 0)]));
}

function toRedactedJson (value) {
  return `${JSON.stringify(redactForExport(value), null, 2)}\n`;
}

async function buildSupportBundle (deps) {
  const generatedAt = new Date().toISOString();
  const results = await Promise.all([
    collectSection('report.md', () => buildMarkdownReport(deps)),
    collectSection('metrics.json', deps.buildMetrics),
    collectSection('diagnostics.json', deps.buildDiagnostics),
    collectSection('health.json', deps.buildHealthSummary),
    collectSection('official-dashboard.json', deps.getOfficialDashboardStatus),
    collectSection('troubleshooting.json', deps.buildTroubleshootingGuide),
    collectSection('compatibility.json', deps.buildCompatibilityReport),
    collectSection('config-health.json', deps.buildConfigHealth),
    collectSection('errors.json', () => deps.readRecentErrorEntriesWithMeta(1000, 20))
  ]);
  const files = [];
  const manifest = {
    generatedAt,
    format: 'openclaw-dash-support-bundle-v1',
    redacted: true,
    files: results.map((result) => ({ name: result.name, ok: result.ok, error: result.error }))
  };
  files.push({ name: 'manifest.json', content: toRedactedJson(manifest) });
  files.push({
    name: 'environment.json',
    content: toRedactedJson({
      generatedAt,
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      os: {
        type: os.type(),
        release: os.release(),
        version: os.version()
      }
    })
  });

  for (const result of results) {
    if (result.name === 'report.md') {
      files.push({ name: result.name, content: result.ok ? result.data : `# OpenClaw Dash Diagnostic Report\n\nReport generation failed: ${markdownEscape(result.error)}\n` });
      continue;
    }
    files.push({
      name: result.name,
      content: result.ok ? toRedactedJson(result.data) : toRedactedJson({ ok: false, error: result.error })
    });
  }

  return createTarGz(files);
}

module.exports = {
  buildMarkdownReport,
  buildSupportBundle
};
