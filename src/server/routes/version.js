function registerVersionRoutes (app, deps) {
  app.get('/api/version', async (req, res) => {
    try {
      res.json(await deps.getLocalVersionStatus());
    } catch (error) {
      res.status(500).json({ installed: false, version: null, message: '本地版本检查失败。', detail: error.message });
    }
  });

  app.get('/api/check-update', async (req, res) => {
    try {
      const latestRelease = await deps.getLatestReleaseInfo();
      if (!latestRelease.latestVersion) {
        return res.status(502).json({ success: false, latestVersion: null, message: '无法获取最新版本信息，请稍后重试。' });
      }
      res.json({
        success: true,
        latestVersion: latestRelease.latestVersion,
        releaseName: '',
        releaseUrl: latestRelease.releaseUrl || '',
        publishedAt: latestRelease.publishedAt || '',
        source: latestRelease.source
      });
    } catch (error) {
      res.status(502).json({
        success: false,
        latestVersion: null,
        message: '无法获取 GitHub 最新 Release 信息，请稍后重试。',
        detail: error.response?.data?.message || error.message
      });
    }
  });

  app.get('/api/version/sources', async (req, res) => {
    try {
      res.json(await deps.buildVersionSourcesHealth());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
}

module.exports = { registerVersionRoutes };
