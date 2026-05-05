const { redactSensitiveText } = require('./redaction');

function markdownEscape (value) {
  return redactSensitiveText(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

async function buildMarkdownReport (deps) {
  const [metrics, diagnostics, health, errors] = await Promise.all([
    deps.buildMetrics(),
    deps.buildDiagnostics(),
    deps.buildHealthSummary(),
    deps.readRecentErrorEntriesWithMeta(1000, 8)
  ]);
  const lines = [];
  lines.push('# OpenClaw Dash 诊断报告');
  lines.push('');
  lines.push(`生成时间：${new Date().toLocaleString()}`);
  lines.push('脱敏状态：已自动遮蔽常见 token、open_id、IP、邮箱、长数字标识和本机路径。');
  lines.push('');
  lines.push('## 今日摘要');
  lines.push('');
  lines.push(`- 健康分：${health.score}/100`);
  lines.push(`- 结论：${health.summary}`);
  lines.push('');
  lines.push('## Gateway');
  lines.push('');
  lines.push(`- 状态：${markdownEscape(metrics.gateway.isRunning ? 'Running' : 'Stopped')}`);
  lines.push(`- ${markdownEscape(`PID: ${metrics.gateway.pid || '-'}`)}`);
  lines.push(`- 运行时长：${markdownEscape(metrics.gateway.uptime || '-')}`);
  lines.push(`- 内存：${markdownEscape(metrics.gateway.memoryRssMb || '-')} MB`);
  lines.push('');
  lines.push('## 版本');
  lines.push('');
  lines.push(`- 本地版本：${markdownEscape(metrics.version.local || '-')}`);
  lines.push(`- 最新版本：${markdownEscape(metrics.version.latest || '-')}`);
  lines.push(`- 有可用更新：${metrics.version.updateAvailable ? '是' : '否'}`);
  lines.push(`- 来源：${markdownEscape(metrics.version.source || '-')}`);
  lines.push('');
  lines.push('## 通道');
  lines.push('');
  lines.push('| 通道 | 状态 | 最近活动 | 今日消息 | 最近 1 小时 | 错误 |');
  lines.push('| --- | --- | --- | ---: | ---: | ---: |');
  for (const [name, channel] of Object.entries(metrics.channels)) {
    lines.push(`| ${markdownEscape(name)} | ${markdownEscape(channel.status)} | ${markdownEscape(channel.lastSeenAt || '-')} | ${channel.stats?.todayMessages ?? '-'} | ${channel.stats?.lastHourMessages ?? '-'} | ${channel.stats?.errorCount ?? '-'} |`);
  }
  lines.push('');
  lines.push('## 系统资源');
  lines.push('');
  lines.push(`- 磁盘：可用 ${markdownEscape(metrics.disk.freeGb ?? '-')} GB，已用 ${markdownEscape(metrics.disk.usedPercent ?? '-')}%`);
  lines.push(`- 内存：已用 ${markdownEscape(metrics.memory.usedGb ?? '-')} GB / ${markdownEscape(metrics.memory.totalGb ?? '-')} GB（${markdownEscape(metrics.memory.usedPercent ?? '-')}%）`);
  lines.push('');
  lines.push('## 诊断建议');
  lines.push('');
  for (const item of diagnostics.recommendations || []) {
    lines.push(`- ${markdownEscape(item.title)}：${markdownEscape(item.detail)}`);
  }
  lines.push('');
  lines.push('## 近期错误');
  lines.push('');
  if (!errors.errors.length) {
    lines.push('- 暂无未静音错误。');
  } else {
    for (const entry of errors.errors) {
      lines.push(`- ${markdownEscape(entry.timestamp || '-')} · ${markdownEscape(entry.source)}: ${markdownEscape(entry.message)}`);
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

module.exports = { buildMarkdownReport };
