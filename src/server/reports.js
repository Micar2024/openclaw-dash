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
  lines.push('# OpenClaw Dash 诊断报告');
  lines.push('');
  lines.push(`生成时间：${new Date().toLocaleString()}`);
  lines.push('脱敏状态：已自动遮蔽常见 token、open_id、IP、邮箱、长数字标识和本机路径。');
  lines.push('容错策略：单个数据源采集失败不会阻止报告生成，失败项会在对应章节标注。');
  lines.push('');
  lines.push('## 今日摘要');
  lines.push('');
  if (healthResult.ok) {
    lines.push(`- 健康分：${health.score}/100`);
    lines.push(`- 结论：${markdownEscape(health.summary)}`);
  } else {
    lines.push(`- 健康摘要采集失败：${markdownEscape(healthResult.error)}`);
  }
  lines.push('');
  lines.push('## Gateway');
  lines.push('');
  if (metricsResult.ok) {
    lines.push(`- 状态：${markdownEscape(metrics.gateway?.isRunning ? 'Running' : 'Stopped')}`);
    lines.push(`- ${markdownEscape(`PID: ${metrics.gateway?.pid || '-'}`)}`);
    lines.push(`- 运行时长：${markdownEscape(metrics.gateway?.uptime || '-')}`);
    lines.push(`- 内存：${markdownEscape(metrics.gateway?.memoryRssMb || '-')} MB`);
  } else {
    lines.push(`- Gateway 指标采集失败：${markdownEscape(metricsResult.error)}`);
  }
  lines.push('');
  lines.push('## 官方 Control UI');
  lines.push('');
  if (officialResult.ok) {
    lines.push(`- URL：${markdownEscape(official.url || '-')}`);
    lines.push(`- 可达：${official.reachable ? '是' : '否'}`);
    lines.push(`- HTTP：${markdownEscape(official.httpStatus || '-')}`);
    lines.push(`- Auth：${official.auth?.configured ? '已配置' : '未检测到显式配置'}（mode: ${markdownEscape(official.auth?.mode || '-')}）`);
    lines.push(`- 建议：${markdownEscape(official.recommendation || '-')}`);
  } else {
    lines.push(`- 官方 Control UI 状态采集失败：${markdownEscape(officialResult.error)}`);
  }
  lines.push('');
  lines.push('## 排障路径');
  lines.push('');
  if (troubleshootingResult.ok) {
    for (const step of troubleshooting.steps || []) {
      lines.push(`- ${markdownEscape(step.title)}：${markdownEscape(step.detail)}`);
    }
  } else {
    lines.push(`- 排障路径采集失败：${markdownEscape(troubleshootingResult.error)}`);
  }
  lines.push('');
  lines.push('## 版本');
  lines.push('');
  if (metricsResult.ok) {
    lines.push(`- 本地版本：${markdownEscape(metrics.version?.local || '-')}`);
    lines.push(`- 最新版本：${markdownEscape(metrics.version?.latest || '-')}`);
    lines.push(`- 有可用更新：${metrics.version?.updateAvailable ? '是' : '否'}`);
    lines.push(`- 来源：${markdownEscape(metrics.version?.source || '-')}`);
  } else {
    lines.push(`- 版本信息采集失败：${markdownEscape(metricsResult.error)}`);
  }
  lines.push('');
  lines.push('## 通道');
  lines.push('');
  if (metricsResult.ok) {
    lines.push('| 通道 | 状态 | 可信度 | 最近活动 | 今日消息 | 最近 1 小时 | 错误 |');
    lines.push('| --- | --- | --- | --- | ---: | ---: | ---: |');
    const channelItems = Array.isArray(metrics.channelItems) && metrics.channelItems.length ? metrics.channelItems : Object.entries(metrics.channels || {}).map(([id, value]) => ({ id, ...value }));
    for (const channel of channelItems) {
      lines.push(`| ${markdownEscape(channel.label || channel.id)} | ${markdownEscape(channel.status)} | ${markdownEscape(channel.verification?.label || '-')} | ${markdownEscape(channel.lastSeenAt || '-')} | ${channel.stats?.todayMessages ?? '-'} | ${channel.stats?.lastHourMessages ?? '-'} | ${channel.stats?.errorCount ?? '-'} |`);
    }
  } else {
    lines.push(`- 通道信息采集失败：${markdownEscape(metricsResult.error)}`);
  }
  lines.push('');
  lines.push('## 系统资源');
  lines.push('');
  if (metricsResult.ok) {
    lines.push(`- 磁盘：可用 ${markdownEscape(metrics.disk?.freeGb ?? '-')} GB，已用 ${markdownEscape(metrics.disk?.usedPercent ?? '-')}%`);
    lines.push(`- 内存：已用 ${markdownEscape(metrics.memory?.usedGb ?? '-')} GB / ${markdownEscape(metrics.memory?.totalGb ?? '-')} GB（${markdownEscape(metrics.memory?.usedPercent ?? '-')}%）`);
  } else {
    lines.push(`- 系统资源采集失败：${markdownEscape(metricsResult.error)}`);
  }
  lines.push('');
  lines.push('## 诊断建议');
  lines.push('');
  if (diagnosticsResult.ok) {
    for (const item of diagnostics.recommendations || []) {
      lines.push(`- ${markdownEscape(item.title)}：${markdownEscape(item.detail)}`);
    }
  } else {
    lines.push(`- 诊断建议采集失败：${markdownEscape(diagnosticsResult.error)}`);
  }
  lines.push('');
  lines.push('## 近期错误');
  lines.push('');
  if (!errorsResult.ok) {
    lines.push(`- 错误日志采集失败：${markdownEscape(errorsResult.error)}`);
  } else if (!errors.errors.length) {
    lines.push('- 暂无未静音错误。');
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
      files.push({ name: result.name, content: result.ok ? result.data : `# OpenClaw Dash 诊断报告\n\n报告生成失败：${markdownEscape(result.error)}\n` });
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
