function registerChannelRoutes (app, deps) {
  app.get('/api/channels', async (req, res) => {
    res.json(await deps.checkChannelsStatus());
  });

  app.post('/api/channels/verify', async (req, res) => {
    const channel = String(req.body?.channel || '').toLowerCase();
    if (!['feishu', 'telegram'].includes(channel)) {
      return res.status(400).json({ success: false, message: '目前仅支持 feishu 或 telegram。' });
    }
    if (req.body?.confirm !== true) {
      return res.status(400).json({ success: false, message: '直连验证会发送测试消息，需要明确确认。' });
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
