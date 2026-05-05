function registerGatewayRoutes (app, deps) {
  app.get('/api/status', async (req, res) => {
    const isRunning = await deps.checkGatewayStatus();
    res.json({ isRunning });
  });

  app.post('/api/control', async (req, res) => {
    const { action } = req.body || {};
    if (!deps.controlActions.has(action)) {
      return res.status(400).json({ success: false, message: 'Invalid action. Only start, stop, and restart are supported.' });
    }

    try {
      const result = await deps.runGatewayControl(action);
      deps.appendAudit(req, `gateway.${action}`, true, { pids: result.pids, isRunning: result.isRunning });
      res.json({ success: true, action, ...result });
    } catch (error) {
      deps.appendAudit(req, `gateway.${action}`, false, { error: error.message });
      res.status(500).json({ success: false, action, message: `Failed to run gateway ${action} command.`, detail: error.message });
    }
  });
}

module.exports = { registerGatewayRoutes };
