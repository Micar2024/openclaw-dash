function registerDiagnosticsRoutes (app, deps) {
  app.get('/api/model', async (req, res) => {
    try {
      res.json(await deps.getCurrentModelInfo());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/diagnostics', async (req, res) => {
    try {
      res.json(await deps.buildDiagnostics());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/diagnostics/probe', async (req, res) => {
    try {
      const diagnostics = await deps.buildDiagnostics();
      deps.appendAudit(req, 'diagnostics.probe', true, {
        gatewayRunning: diagnostics.gateway.isRunning,
        feishuDirectOk: diagnostics.feishuDirect?.ok,
        feishuProbeOk: diagnostics.openclawProbe?.channels?.feishu?.probe?.ok,
        telegramProbeOk: diagnostics.openclawProbe?.channels?.telegram?.probe?.ok
      });
      res.json(diagnostics);
    } catch (error) {
      deps.appendAudit(req, 'diagnostics.probe', false, { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/compatibility', async (req, res) => {
    try {
      res.json(await deps.buildCompatibilityReport());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/config/health', (req, res) => {
    try {
      res.json(deps.buildConfigHealth());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/core-files/health', (req, res) => {
    try {
      res.json(deps.buildCoreFilesHealth());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
}

module.exports = { registerDiagnosticsRoutes };
