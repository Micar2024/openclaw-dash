function registerUpdateRoutes (app, deps) {
  app.post('/api/update', async (req, res) => {
    try {
      if (req.body?.dryRun) {
        deps.appendAudit(req, 'update.dryRun', true);
        return res.json({ success: true, dryRun: true, message: 'dryRun 已确认，未执行真实更新。' });
      }

      if (req.body?.confirm !== true) {
        return res.status(400).json({ success: false, message: '更新需要明确确认。' });
      }

      const updateJob = deps.getUpdateJob();
      if (updateJob.running) {
        return res.status(409).json({ success: false, message: '已有更新任务正在运行。', job: updateJob });
      }

      await deps.assertOpenClawAvailable();
      const preflight = await deps.buildUpdatePreflight();
      if (!preflight.updateAvailable) {
        deps.appendAudit(req, 'update.preflight', false, { reason: 'no-update', latestVersion: preflight.latestVersion });
        return res.status(409).json({ success: false, message: '更新预检未检测到可用更新。', preflight });
      }

      const blockingFailures = preflight.checks.filter((check) => !check.ok && ['disk-space', 'cli-compatibility'].includes(check.id));
      if (blockingFailures.length) {
        deps.appendAudit(req, 'update.preflight', false, { failures: blockingFailures });
        return res.status(409).json({ success: false, message: '更新预检失败，请先处理阻断项。', preflight });
      }

      deps.appendAudit(req, 'update.preflight', true, { latestVersion: preflight.latestVersion });
      const shouldRestartGateway = await deps.checkGatewayStatus();
      const job = deps.resetUpdateJob();
      res.json({ success: true, accepted: true, message: '更新任务已接受，正在后台运行。', job, preflight });
      deps.runUpdateJob(req, shouldRestartGateway);
    } catch (error) {
      deps.appendAudit(req, 'update', false, { error: error.message });
      res.status(500).json({ success: false, message: '更新失败：' + error.message });
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
