function markdownEscape (value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
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
  lines.push('');
  lines.push('## 今日摘要');
  lines.push('');
  lines.push(`- 健康分：${health.score}/100`);
  lines.push(`- 结论：${health.summary}`);
  lines.push('');
  lines.push('## Gateway');
  lines.push('');
  lines.push(`- 状态：${metrics.gateway.isRunning ? 'Running' : 'Stopped'}`);
  lines.push(`- PID：${metrics.gateway.pid || '-'}`);
  lines.push(`- 运行时长：${metrics.gateway.uptime || '-'}`);
  lines.push(`- 内存：${metrics.gateway.memoryRssMb || '-'} MB`);
  lines.push('');
  lines.push('## 版本');
  lines.push('');
  lines.push(`- 本地版本：${metrics.version.local || '-'}`);
  lines.push(`- 最新版本：${metrics.version.latest || '-'}`);
  lines.push(`- 有可用更新：${metrics.version.updateAvailable ? '是' : '否'}`);
  lines.push(`- 来源：${metrics.version.source || '-'}`);
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
  lines.push(`- 磁盘：可用 ${metrics.disk.freeGb ?? '-'} GB，已用 ${metrics.disk.usedPercent ?? '-'}%`);
  lines.push(`- 内存：已用 ${metrics.memory.usedGb ?? '-'} GB / ${metrics.memory.totalGb ?? '-'} GB（${metrics.memory.usedPercent ?? '-'}%）`);
  lines.push('');
  lines.push('## 诊断建议');
  lines.push('');
  for (const item of diagnostics.recommendations || []) {
    lines.push(`- ${item.title}：${item.detail}`);
  }
  lines.push('');
  lines.push('## 近期错误');
  lines.push('');
  if (!errors.errors.length) {
    lines.push('- 暂无未静音错误。');
  } else {
    for (const entry of errors.errors) {
      lines.push(`- ${entry.timestamp || '-'} · ${entry.source}: ${entry.message}`);
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

module.exports = { buildMarkdownReport };
