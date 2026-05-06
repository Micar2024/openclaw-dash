function registerAuthRoutes (app, deps) {
  app.get('/api/auth/status', (req, res) => {
    res.json({
      authenticated: deps.isValidSessionToken(deps.parseCookies(req)[deps.sessionCookie]),
      local: deps.isLocalRequest(req)
    });
  });

  app.post('/api/auth/local-login', (req, res) => {
    if (!deps.isLocalRequest(req)) {
      return res.status(403).json({ success: false, message: '本地一键登录仅允许从本机浏览器使用。' });
    }

    deps.setSessionCookie(res);
    deps.appendAudit(req, 'auth.localLogin', true);
    res.json({ success: true, message: '本地登录成功。' });
  });

  app.post('/api/auth/login', (req, res) => {
    if (!deps.isValidDashboardToken(req.body?.token)) {
      deps.appendAudit(req, 'auth.login', false);
      return res.status(401).json({ success: false, message: '访问令牌无效。' });
    }

    deps.setSessionCookie(res);
    deps.appendAudit(req, 'auth.login', true);
    res.json({ success: true, message: '登录成功。' });
  });

  app.post('/api/auth/logout', (req, res) => {
    deps.clearSessionCookie(res);
    deps.appendAudit(req, 'auth.logout', true);
    res.json({ success: true });
  });
}

module.exports = { registerAuthRoutes };
