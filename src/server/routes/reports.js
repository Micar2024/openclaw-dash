function registerReportRoutes (app, deps) {
  app.get('/api/report.md', async (req, res) => {
    try {
      res.type('text/markdown').send(await deps.buildMarkdownReport());
    } catch (error) {
      res.status(500).type('text/markdown').send(`# OpenClaw Dash Report Export Failed\n\n${error.message}\n`);
    }
  });

  app.get('/api/support-bundle.tgz', async (req, res) => {
    try {
      const bundle = await deps.buildSupportBundle();
      res.setHeader('Content-Type', 'application/gzip');
      res.setHeader('Content-Disposition', `attachment; filename="openclaw-support-bundle-${new Date().toISOString().replace(/[:.]/g, '-')}.tar.gz"`);
      res.send(bundle);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
}

module.exports = { registerReportRoutes };
