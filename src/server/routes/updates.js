function registerUpdateRoutes (app, deps) {
  app.post('/api/update', async (req, res) => {
    try {
      if (req.body?.dryRun) {
        deps.appendAudit(req, 'update.dryRun', true);
        return res.json({ success: true, dryRun: true, message: 'dryRun confirmed. No real update was executed.' });
      }

      if (req.body?.confirm !== true) {
        return res.status(400).json({ success: false, message: 'Update requires explicit confirmation.' });
      }

      const updateJob = deps.getUpdateJob();
      if (updateJob.running) {
        return res.status(409).json({ success: false, message: 'An update job is already running.', job: updateJob });
      }

      await deps.assertOpenClawAvailable();
      const preflight = await deps.buildUpdatePreflight();
      if (!preflight.updateAvailable) {
        deps.appendAudit(req, 'update.preflight', false, { reason: 'no-update', latestVersion: preflight.latestVersion });
        return res.status(409).json({ success: false, message: 'Update preflight did not detect an available update.', preflight });
      }

      const blockingFailures = preflight.checks.filter((check) => !check.ok && ['Disk Space', 'CLI Compatibility'].includes(check.name));
      if (blockingFailures.length) {
        deps.appendAudit(req, 'update.preflight', false, { failures: blockingFailures });
        return res.status(409).json({ success: false, message: 'Update preflight failed. Please resolve blocking items first.', preflight });
      }

      deps.appendAudit(req, 'update.preflight', true, { latestVersion: preflight.latestVersion });
      const shouldRestartGateway = await deps.checkGatewayStatus();
      const job = deps.resetUpdateJob();
      res.json({ success: true, accepted: true, message: 'Update job accepted and running in the background.', job, preflight });
      deps.runUpdateJob(req, shouldRestartGateway);
    } catch (error) {
      deps.appendAudit(req, 'update', false, { error: error.message });
      res.status(500).json({ success: false, message: 'Update failed: ' + error.message });
    }
  });

  app.get('/api/update/status', (req, res) => {
    res.json(deps.getUpdateJob());
  });

  app.get('/api/update/preflight', async (req, res) => {
    try {
      res.json(await deps.buildUpdatePreflight());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
}

module.exports = { registerUpdateRoutes };
