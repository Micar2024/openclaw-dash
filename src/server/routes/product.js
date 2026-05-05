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

  app.get('/api/official-dashboard', async (req, res) => {
    try {
      res.json(await deps.getOfficialDashboardStatus());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/troubleshooting', async (req, res) => {
    try {
      res.json(await deps.buildTroubleshootingGuide());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
}

module.exports = { registerProductRoutes };
