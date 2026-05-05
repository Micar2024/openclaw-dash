async function buildTimeline (deps) {
  const [auditEntries, errorEntries, channels, gatewayRunning] = await Promise.all([
    deps.readAuditEntries(20),
    deps.readRecentErrorEntries(1200, 12),
    deps.checkChannelsStatus(),
    deps.checkGatewayStatus()
  ]);

  const events = [];
  const now = new Date().toISOString();

  events.push({
    timestamp: now,
    type: gatewayRunning ? 'gateway.ok' : 'gateway.offline',
    level: gatewayRunning ? 'ok' : 'critical',
    title: gatewayRunning ? 'Gateway 正在运行' : 'Gateway 未运行',
    detail: gatewayRunning ? '当前进程检测正常。' : '未检测到 Gateway 进程。',
    source: 'runtime'
  });

  const channelItems = Array.isArray(channels.items) && channels.items.length
    ? channels.items
    : Object.entries(channels.detail || {}).map(([id, value]) => ({ id, ...value }));
  for (const detail of channelItems) {
    events.push({
      timestamp: detail.lastSeenAt || now,
      type: `channel.${detail.id}.${detail.status || 'unknown'}`,
      level: detail.status === 'online' ? 'ok' : 'warning',
      title: `${detail.label || detail.id}通道 ${detail.status === 'online' ? '在线' : '离线'}`,
      detail: detail.reason || detail.lastError || '无更多细节。',
      source: 'channel'
    });
  }

  for (const entry of auditEntries) {
    events.push({
      timestamp: entry.timestamp,
      type: entry.action,
      level: entry.success ? 'info' : 'warning',
      title: `操作：${entry.action}`,
      detail: `${entry.success ? '成功' : '失败'} · ${String(entry.ip || 'unknown').replace(/^::ffff:/, '')}`,
      source: 'audit'
    });
  }

  for (const error of errorEntries) {
    events.push({
      timestamp: error.timestamp || now,
      type: 'log.error',
      level: 'warning',
      title: `错误日志：${error.source}`,
      detail: error.message,
      source: 'logs'
    });
  }

  for (const step of deps.getUpdateSteps()) {
    events.push({
      timestamp: step.timestamp,
      type: `update.${step.status}`,
      level: step.status === 'error' ? 'critical' : step.status === 'warning' ? 'warning' : 'info',
      title: `更新步骤：${step.name}`,
      detail: step.detail || step.status,
      source: 'update'
    });
  }

  events.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
  return { events: events.slice(0, 40), collectedAt: now };
}

module.exports = { buildTimeline };
