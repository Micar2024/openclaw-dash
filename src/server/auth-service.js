const crypto = require('crypto');
const fs = require('fs');
const {
  AUDIT_LOG_PATH,
  SESSION_COOKIE,
  SESSION_MAX_AGE_MS,
  TOKEN_PATH
} = require('./config');
const { ensureParentDir, readTail } = require('./runtime');

function createAuthService () {
  const dashboardToken = resolveDashboardToken();

  function resolveDashboardToken () {
    const envToken = (process.env.DASHBOARD_TOKEN || '').trim();
    if (envToken) return envToken;

    try {
      if (fs.existsSync(TOKEN_PATH)) {
        const fileToken = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
        if (fileToken) return fileToken;
      }

      ensureParentDir(TOKEN_PATH);
      const generatedToken = crypto.randomBytes(24).toString('base64url');
      fs.writeFileSync(TOKEN_PATH, `${generatedToken}\n`, { mode: 0o600 });
      console.log(`[Auth] First run: access token generated and written to ${TOKEN_PATH}`);
      return generatedToken;
    } catch (error) {
      console.error('[Auth] Access token file initialization failed:', error.message);
      throw new Error(`Unable to write or read access token file ${TOKEN_PATH}: ${error.message}. Please check file permissions.`);
    }
  }

  function isValidDashboardToken (token) {
    if (!token) return false;

    try {
      const expected = Buffer.from(dashboardToken);
      const actual = Buffer.from(String(token).trim());
      return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }

  function parseCookies (req) {
    const header = req.headers.cookie || '';
    return header.split(';').reduce((cookies, item) => {
      const index = item.indexOf('=');
      if (index === -1) return cookies;
      const key = item.slice(0, index).trim();
      const value = item.slice(index + 1).trim();
      cookies[key] = decodeURIComponent(value);
      return cookies;
    }, {});
  }

  function signSession (issuedAt) {
    return crypto.createHmac('sha256', dashboardToken).update(String(issuedAt)).digest('hex');
  }

  function createSessionToken () {
    const issuedAt = Date.now();
    return `${issuedAt}.${signSession(issuedAt)}`;
  }

  function isValidSessionToken (sessionToken) {
    if (!sessionToken || !sessionToken.includes('.')) return false;

    const [issuedAtText, signature] = sessionToken.split('.');
    const issuedAt = Number(issuedAtText);
    if (!issuedAt || Date.now() - issuedAt > SESSION_MAX_AGE_MS) return false;

    const expected = signSession(issuedAt);
    try {
      const actual = Buffer.from(signature || '');
      const wanted = Buffer.from(expected);
      return actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted);
    } catch {
      return false;
    }
  }

  function setSessionCookie (res) {
    const token = createSessionToken();
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}; HttpOnly; SameSite=Lax`);
  }

  function clearSessionCookie (res) {
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
  }

  function isLocalRequest (req) {
    const address = req.socket?.remoteAddress || req.ip || '';
    return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
  }

  function requireApiAuth (req, res, next) {
    if (!req.path.startsWith('/api/')) {
      next();
      return;
    }
    if (req.path.startsWith('/api/auth/')) {
      next();
      return;
    }

    const header = req.get('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

    if (isValidDashboardToken(token) || isValidSessionToken(parseCookies(req)[SESSION_COOKIE])) {
      next();
      return;
    }

    res.status(401).json({ error: 'Unauthorized' });
  }

  function appendAudit (req, action, success, detail = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      action,
      success: Boolean(success),
      ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip || 'unknown',
      userAgent: req.get('User-Agent') || '',
      detail
    };

    try {
      ensureParentDir(AUDIT_LOG_PATH);
      fs.appendFile(AUDIT_LOG_PATH, `${JSON.stringify(entry)}\n`, () => {});
    } catch (error) {
      console.error('[Audit] Write failed:', error.message);
    }
  }

  async function readAuditEntries (limit = 30) {
    const text = await readTail(AUDIT_LOG_PATH, Math.max(limit * 3, 50));
    return text.split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean)
      .slice(-limit)
      .reverse();
  }

  return {
    appendAudit,
    clearSessionCookie,
    isLocalRequest,
    isValidDashboardToken,
    isValidSessionToken,
    parseCookies,
    readAuditEntries,
    requireApiAuth,
    sessionCookie: SESSION_COOKIE,
    setSessionCookie
  };
}

module.exports = { createAuthService };
