const axios = require('axios');
const fs = require('fs');
const { execFile } = require('child_process');
const {
  DASH_VERSION_CACHE_MAX_AGE_MS,
  DASH_VERSION_CACHE_PATH,
  DASHBOARD_PATH,
  OPENCLAW_BIN,
  UPDATE_CHECK_PATH
} = require('./config');
const {
  ensureParentDir,
  isFreshTimestamp,
  readJsonFile
} = require('./runtime');

function normalizeVersion (value) {
  if (!value) return null;
  const match = String(value).match(/v?(\d{4}\.\d{1,2}\.\d{1,2})/i);
  return match ? match[1] : String(value).replace(/^v/i, '').trim();
}

function parseVersion (value) {
  const text = String(value || '');
  const match = text.match(/v?(\d{4})\.(\d{1,2})\.(\d{1,2})(?:-([0-9a-z.-]+))?/i);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || '',
    raw: match[0]
  };
}

function compareVersions (a, b) {
  const av = parseVersion(a);
  const bv = parseVersion(b);
  if (!av && !bv) return 0;
  if (!av) return -1;
  if (!bv) return 1;
  for (const key of ['major', 'minor', 'patch']) {
    if (av[key] !== bv[key]) return av[key] - bv[key];
  }

  function suffixRank (suffix) {
    if (!suffix) return { type: 0, value: 0, text: '' };
    if (/^\d+$/.test(suffix)) return { type: 1, value: Number(suffix), text: suffix };
    return { type: -1, value: 0, text: suffix };
  }

  const as = suffixRank(av.prerelease);
  const bs = suffixRank(bv.prerelease);
  if (as.type !== bs.type) return as.type - bs.type;
  if (as.value !== bs.value) return as.value - bs.value;
  return as.text.localeCompare(bs.text, undefined, { numeric: true });
}

function isVersionGreater (latest, local) {
  return compareVersions(latest, local) > 0;
}

function buildReleaseUrl (version) {
  return version ? `https://github.com/openclaw/openclaw/releases/tag/v${normalizeVersion(version)}` : null;
}

function persistLatestReleaseInfo (info) {
  if (!info?.latestVersion || info.source?.includes('cache')) return info;
  try {
    ensureParentDir(DASH_VERSION_CACHE_PATH);
    fs.writeFileSync(DASH_VERSION_CACHE_PATH, `${JSON.stringify({ ...info, cachedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  } catch (error) {
    console.error('[Version] 版本缓存写入失败:', error.message);
  }
  return info;
}

function getLocalVersionStatus () {
  return new Promise((resolve) => {
    execFile(OPENCLAW_BIN, ['--version'], { env: { ...process.env, PATH: DASHBOARD_PATH }, timeout: 5000 }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          installed: false,
          version: null,
          message: '未检测到 openclaw，或执行 openclaw --version 时发生错误。',
          detail: stderr ? stderr.trim() : error.message
        });
        return;
      }
      resolve({ installed: true, version: stdout.trim() || '未知版本', message: '已检测到本地 openclaw。' });
    });
  });
}

function getLocalVersion () {
  return new Promise((resolve) => {
    execFile(OPENCLAW_BIN, ['--version'], { env: { ...process.env, PATH: DASHBOARD_PATH }, timeout: 5000 }, (error, stdout) => {
      resolve(error ? null : (stdout.trim() || null));
    });
  });
}

async function getLatestReleaseInfo () {
  let githubError = null;
  try {
    const response = await axios.get('https://api.github.com/repos/openclaw/openclaw/releases', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'openclaw-dash' },
      params: { per_page: 20 },
      timeout: 8000
    });

    const releases = Array.isArray(response.data) ? response.data.filter((release) => !release.draft) : [];
    const stable = releases.filter((release) => !release.prerelease);
    const candidates = stable.length ? stable : releases;
    const latest = candidates
      .filter((release) => parseVersion(release.tag_name))
      .sort((a, b) => compareVersions(b.tag_name, a.tag_name))[0];

    if (latest?.tag_name) {
      return persistLatestReleaseInfo({
        latestVersion: latest.tag_name,
        releaseUrl: latest.html_url || buildReleaseUrl(latest.tag_name),
        publishedAt: latest.published_at || null,
        source: stable.length ? 'github-releases' : 'github-releases-prerelease'
      });
    }
  } catch (error) {
    githubError = error.response?.data?.message || error.message;
  }

  try {
    const response = await axios.get('https://registry.npmjs.org/openclaw/latest', {
      headers: { Accept: 'application/json', 'User-Agent': 'openclaw-dash' },
      timeout: 8000
    });
    const npmVersion = response.data?.version || null;
    if (npmVersion) {
      return persistLatestReleaseInfo({
        latestVersion: `v${npmVersion}`,
        releaseUrl: buildReleaseUrl(npmVersion),
        publishedAt: response.data?.time || null,
        source: githubError ? `npm-registry (github: ${githubError})` : 'npm-registry'
      });
    }
  } catch (error) {
    // Keep falling through to OpenClaw's local cache.
  }

  const dashCached = readJsonFile(DASH_VERSION_CACHE_PATH);
  if (dashCached?.latestVersion && isFreshTimestamp(dashCached.cachedAt, DASH_VERSION_CACHE_MAX_AGE_MS)) {
    return {
      latestVersion: dashCached.latestVersion,
      releaseUrl: dashCached.releaseUrl || buildReleaseUrl(dashCached.latestVersion),
      publishedAt: dashCached.publishedAt || dashCached.cachedAt || null,
      source: 'dash-version-cache'
    };
  }

  const cached = readJsonFile(UPDATE_CHECK_PATH);
  const cachedVersion = cached?.lastAvailableVersion || cached?.lastNotifiedVersion || null;
  return {
    latestVersion: cachedVersion ? `v${normalizeVersion(cachedVersion)}` : null,
    releaseUrl: cachedVersion ? buildReleaseUrl(cachedVersion) : null,
    publishedAt: cached?.lastCheckedAt || null,
    source: cachedVersion ? 'update-check-cache' : 'unavailable'
  };
}

async function fetchGithubVersionSource () {
  try {
    const response = await axios.get('https://api.github.com/repos/openclaw/openclaw/releases', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'openclaw-dash' },
      params: { per_page: 20 },
      timeout: 8000
    });
    const releases = Array.isArray(response.data) ? response.data.filter((release) => !release.draft) : [];
    const latest = releases
      .filter((release) => !release.prerelease && parseVersion(release.tag_name))
      .sort((a, b) => compareVersions(b.tag_name, a.tag_name))[0];
    return { name: 'GitHub Releases', ok: Boolean(latest), latestVersion: latest?.tag_name || null, status: latest ? 'ok' : 'empty', detail: latest ? latest.html_url : '未找到稳定 release。' };
  } catch (error) {
    return { name: 'GitHub Releases', ok: false, latestVersion: null, status: 'error', detail: error.response?.data?.message || error.message };
  }
}

async function fetchNpmVersionSource () {
  try {
    const response = await axios.get('https://registry.npmjs.org/openclaw/latest', {
      headers: { Accept: 'application/json', 'User-Agent': 'openclaw-dash' },
      timeout: 8000
    });
    return { name: 'npm registry', ok: Boolean(response.data?.version), latestVersion: response.data?.version ? `v${response.data.version}` : null, status: 'ok', detail: 'registry.npmjs.org/openclaw/latest' };
  } catch (error) {
    return { name: 'npm registry', ok: false, latestVersion: null, status: 'error', detail: error.response?.data?.error || error.message };
  }
}

function fetchDashCacheVersionSource () {
  const cached = readJsonFile(DASH_VERSION_CACHE_PATH);
  const fresh = Boolean(cached?.latestVersion && isFreshTimestamp(cached.cachedAt, DASH_VERSION_CACHE_MAX_AGE_MS));
  return {
    name: 'Dash cache',
    ok: fresh,
    latestVersion: cached?.latestVersion || null,
    status: cached?.latestVersion ? (fresh ? 'ok' : 'stale') : 'empty',
    detail: cached?.cachedAt
      ? `缓存于 ${cached.cachedAt}${fresh ? '' : '，已超过 7 天，不再作为版本依据。'}`
      : '暂无 dashboard 版本缓存。'
  };
}

async function buildVersionSourcesHealth () {
  const [github, npmSource] = await Promise.all([fetchGithubVersionSource(), fetchNpmVersionSource()]);
  const cache = fetchDashCacheVersionSource();
  return { sources: [github, npmSource, cache], collectedAt: new Date().toISOString() };
}

module.exports = {
  buildReleaseUrl,
  buildVersionSourcesHealth,
  compareVersions,
  getLatestReleaseInfo,
  getLocalVersion,
  getLocalVersionStatus,
  isVersionGreater,
  normalizeVersion,
  parseVersion
};
