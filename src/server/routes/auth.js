function registerAuthRoutes (app, deps) {
  app.get('/api/auth/status', (req, res) => {
    res.json({
      authenticated: deps.isValidSessionToken(deps.parseCookies(req)[deps.sessionCookie]),
      local: deps.isLocalRequest(req)
    });
  });

  app.post('/api/auth/local-login', (req, res) => {
    if (!deps.isLocalRequest(req)) {
      return res.status(403).json({ success: false, message: 'Local one-click sign-in is only allowed from the local browser.' });
    }

    deps.setSessionCookie(res);
    deps.appendAudit(req, 'auth.localLogin', true);
    res.json({ success: true, message: 'Local sign-in succeeded.' });
  });

  app.post('/api/auth/login', (req, res) => {
    if (!deps.isValidDashboardToken(req.body?.token)) {
      deps.appendAudit(req, 'auth.login', false);
      return res.status(401).json({ success: false, message: 'Invalid access token.' });
    }

    deps.setSessionCookie(res);
    deps.appendAudit(req, 'auth.login', true);
    res.json({ success: true, message: 'Sign-in succeeded.' });
  });

  app.post('/api/auth/logout', (req, res) => {
    deps.clearSessionCookie(res);
    deps.appendAudit(req, 'auth.logout', true);
    res.json({ success: true });
  });
}

module.exports = { registerAuthRoutes };
