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
          ? (authConfigured ? '官方 Control UI 可达；如仍无法进入，优先检查浏览器内的 Gateway token/password。' : '官方 Control UI 可达，但未检测到显式 auth 配置；如遇 1008/unauthorized，运行 openclaw doctor --generate-gateway-token。')
          : '官方 Control UI 未响应；如果 Gateway 正在运行，检查端口、basePath 或官方 Dashboard 鉴权配置。',
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
        recommendation: '官方 Control UI 未响应；先确认 Gateway 进程是否运行，再检查 18789 端口或自定义 OPENCLAW_GATEWAY_PORT。',
        collectedAt: new Date().toISOString()
      };
    }
  }

  return {
    getOfficialDashboardStatus
  };
}

module.exports = { createOfficialDashboardService };
