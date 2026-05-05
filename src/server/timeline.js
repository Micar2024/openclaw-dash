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
    title: gatewayRunning ? 'Gateway Running' : 'Gateway Stopped',
    detail: gatewayRunning ? 'Current process check is healthy.' : 'Gateway process was not detected.',
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
      title: `${detail.label || detail.id} Channel ${detail.status === 'online' ? 'Online' : 'Offline'}`,
      detail: detail.reason || detail.lastError || 'No more detail.',
      source: 'channel'
    });
  }

  for (const entry of auditEntries) {
    events.push({
      timestamp: entry.timestamp,
      type: entry.action,
      level: entry.success ? 'info' : 'warning',
      title: `Operation: ${entry.action}`,
      detail: `${entry.success ? 'success' : 'failed'} · ${String(entry.ip || 'unknown').replace(/^::ffff:/, '')}`,
      source: 'audit'
    });
  }

  for (const error of errorEntries) {
    events.push({
      timestamp: error.timestamp || now,
      type: 'log.error',
      level: 'warning',
      title: `Error log: ${error.source}`,
      detail: error.message,
      source: 'logs'
    });
  }

  for (const step of deps.getUpdateSteps()) {
    events.push({
      timestamp: step.timestamp,
      type: `update.${step.status}`,
      level: step.status === 'error' ? 'critical' : step.status === 'warning' ? 'warning' : 'info',
      title: `Update step: ${step.name}`,
      detail: step.detail || step.status,
      source: 'update'
    });
  }

  events.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
  return { events: events.slice(0, 40), collectedAt: now };
}

module.exports = { buildTimeline };
