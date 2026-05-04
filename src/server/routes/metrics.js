function registerMetricsRoutes (app, deps) {
  app.get('/api/metrics', async (req, res) => {
    try {
      res.json(await deps.buildMetrics());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
}

module.exports = { registerMetricsRoutes };
