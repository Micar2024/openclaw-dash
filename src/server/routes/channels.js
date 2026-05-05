function registerChannelRoutes (app, deps) {
  app.get('/api/channels', async (req, res) => {
    res.json(await deps.checkChannelsStatus());
  });

  app.post('/api/channels/verify', async (req, res) => {
    const channel = String(req.body?.channel || '').toLowerCase();
    if (!['feishu', 'telegram'].includes(channel)) {
      return res.status(400).json({ success: false, message: 'Only feishu or telegram is supported.' });
    }
    if (req.body?.confirm !== true) {
      return res.status(400).json({ success: false, message: 'Direct channel verification sends a test message and requires explicit confirmation.' });
    }

    try {
      const result = await deps.verifyChannel(channel);
      deps.appendAudit(req, `channel.${channel}.verify`, true, {
        sent: result.sent,
        received: result.received,
        messageId: result.messageId
      });
      res.json({ success: true, ...result });
    } catch (error) {
      deps.appendAudit(req, `channel.${channel}.verify`, false, { error: error.message });
      res.status(500).json({ success: false, channel, message: error.message });
    }
  });
}

module.exports = { registerChannelRoutes };
