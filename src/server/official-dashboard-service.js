const axios = require('axios');
const {
  GATEWAY_HOST,
  GATEWAY_PORT,
  OPENCLAW_CONFIG_PATH
} = require('./config');
const { readJsonFile } = require('./runtime');

function normalizeBasePath (value) {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : '/';
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  return withSlash.endsWith('/') ? withSlash : `${withSlash}/`;
}

function createOfficialDashboardService () {
  function getControlUiConfig () {
    const config = readJsonFile(OPENCLAW_CONFIG_PATH) || {};
    const gateway = config.gateway || {};
    const auth = gateway.auth || {};
    const basePath = normalizeBasePath(gateway.controlUi?.basePath);
    const url = `http://${GATEWAY_HOST}:${GATEWAY_PORT}${basePath}`;
    return {
      url,
      basePath,
      auth: {
        mode: auth.mode || null,
        tokenPresent: Boolean(auth.token),
        passwordPresent: Boolean(auth.password),
        allowTailscale: Boolean(auth.allowTailscale),
        trustedProxy: auth.mode === 'trusted-proxy'
      }
    };
  }

  async function getOfficialDashboardStatus () {
    const config = getControlUiConfig();
    try {
      const response = await axios.get(config.url, {
        timeout: 3000,
        validateStatus: () => true
      });
      const body = typeof response.data === 'string' ? response.data.slice(0, 1000) : '';
      const contentType = String(response.headers?.['content-type'] || '');
      const reachable = response.status >= 200 && response.status < 500;
      const looksLikeControlUi = /html/i.test(contentType) || /openclaw|control ui|dashboard/i.test(body);
      const authConfigured = Boolean(
        config.auth.tokenPresent ||
        config.auth.passwordPresent ||
        config.auth.allowTailscale ||
        config.auth.trustedProxy ||
        config.auth.mode === 'none'
      );

      return {
        ok: reachable,
        reachable,
        url: config.url,
        basePath: config.basePath,
        httpStatus: response.status,
        contentType,
        looksLikeControlUi,
        auth: {
          ...config.auth,
          configured: authConfigured
        },
        recommendation: reachable
          ? (authConfigured ? 'Official Control UI is reachable. If you still cannot enter, first check the Gateway token/password in the browser.' : 'Official Control UI is reachable, but no explicit auth config was found. If you see 1008/unauthorized, run `openclaw doctor --generate-gateway-token`.')
          : 'Official Control UI is not responding. If Gateway is running, check port, basePath, or official Dashboard auth config.',
        collectedAt: new Date().toISOString()
      };
    } catch (error) {
      return {
        ok: false,
        reachable: false,
        url: config.url,
        basePath: config.basePath,
        httpStatus: null,
        contentType: null,
        looksLikeControlUi: false,
        auth: {
          ...config.auth,
          configured: Boolean(config.auth.tokenPresent || config.auth.passwordPresent || config.auth.allowTailscale || config.auth.trustedProxy || config.auth.mode === 'none')
        },
        error: error.code || error.message,
        recommendation: 'Official Control UI is not responding. First confirm Gateway is running, then check port 18789 or custom OPENCLAW_GATEWAY_PORT.',
        collectedAt: new Date().toISOString()
      };
    }
  }

  return {
    getOfficialDashboardStatus
  };
}

module.exports = { createOfficialDashboardService };
