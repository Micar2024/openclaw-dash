function registerGatewayRoutes (app, deps) {
  app.get('/api/status', async (req, res) => {
    const isRunning = await deps.checkGatewayStatus();
    res.json({ isRunning });
  });

  app.post('/api/control', async (req, res) => {
    const { action } = req.body || {};
    if (!deps.controlActions.has(action)) {
      return res.status(400).json({ success: false, message: '无效操作，仅支持 start、stop、restart。' });
    }

    try {
      const result = await deps.runGatewayControl(action);
      deps.appendAudit(req, `gateway.${action}`, true, { pids: result.pids, isRunning: result.isRunning });
      res.json({ success: true, action, ...result });
    } catch (error) {
      deps.appendAudit(req, `gateway.${action}`, false, { error: error.message });
      res.status(500).json({ success: false, action, message: `执行 gateway ${action} 指令失败。`, detail: error.message });
    }
  });
}

module.exports = { registerGatewayRoutes };
