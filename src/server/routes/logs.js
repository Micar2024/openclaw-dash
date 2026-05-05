function registerLogRoutes (app, deps) {
  app.get('/api/audit', async (req, res) => {
    try {
      const entries = await deps.readAuditEntries(30);
      res.json({ entries, count: entries.length });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/timeline', async (req, res) => {
    try {
      res.json(await deps.buildTimeline());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/errors', async (req, res) => {
    try {
      const result = await deps.readRecentErrorEntriesWithMeta(1000, 10);
      res.json({
        count: result.errors.length,
        mutedCount: result.mutedCount,
        activeMuteRules: result.activeRules,
        errors: result.errors,
        collectedAt: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/log-rules', (req, res) => {
    const rules = deps.loadLogMuteRules();
    res.json({ rules, activeCount: rules.filter((rule) => rule.enabled).length });
  });

  app.post('/api/log-rules', (req, res) => {
    const { id, enabled } = req.body || {};
    const rules = deps.loadLogMuteRules();
    const target = rules.find((rule) => rule.id === id);
    if (!target) return res.status(404).json({ success: false, message: 'Unknown log muting rule.' });

    target.enabled = Boolean(enabled);
    deps.persistLogMuteRules(rules);
    deps.appendAudit(req, 'log-rule.update', true, { id, enabled: target.enabled });
    res.json({ success: true, rules });
  });
}

module.exports = { registerLogRoutes };
