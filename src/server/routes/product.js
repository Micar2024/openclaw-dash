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

  app.post('/api/dashboard/restart', (req, res) => {
    try {
      deps.appendAudit(req, 'dashboard.restart', true, { method: 'launchctl kickstart' });
      res.json({ success: true, accepted: true, message: 'Dashboard restart accepted.' });
      setTimeout(() => {
        deps.restartDashboard().catch((error) => {
          console.error('[DashboardRestart] Failed:', error.message);
        });
      }, 250);
    } catch (error) {
      deps.appendAudit(req, 'dashboard.restart', false, { error: error.message });
      res.status(500).json({ success: false, message: 'Dashboard restart failed.', detail: error.message });
    }
  });
}

module.exports = { registerProductRoutes };
