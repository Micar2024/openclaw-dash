function registerProductRoutes (app, deps) {
  app.get('/api/setup/status', async (req, res) => {
    try {
      res.json(await deps.buildSetupStatus());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/health/summary', async (req, res) => {
    try {
      res.json(await deps.buildHealthSummary());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/report.md', async (req, res) => {
    try {
      res.type('text/markdown').send(await deps.buildMarkdownReport());
    } catch (error) {
      res.status(500).type('text/markdown').send(`# OpenClaw Dash 报告导出失败\n\n${error.message}\n`);
    }
  });
}

module.exports = { registerProductRoutes };
