// --- Auth helpers ---
function authFetch(url, options = {}) {
  options.credentials = 'same-origin';
  options.headers = { ...(options.headers || {}) };
  return fetch(url, options).then(async (res) => {
    if (res.status === 401 && url.startsWith('/api/')) {
      showLogin('Session expired. Please sign in again.');
      throw new Error('Unauthorized');
    }
    if (!res.ok && url.startsWith('/api/')) {
      res.clone().json()
        .then((data) => showApiError(data.message || data.error || 'API request failed', data.detail || data.reason || `HTTP ${res.status}`))
        .catch(() => showApiError('API request failed', `HTTP ${res.status}`));
    }
    return res;
  }).catch((error) => {
    if (error.message !== 'Unauthorized') showApiError('Network request failed', error.message);
    throw error;
  });
}

function showLogin(message) {
  loginScreenEl.classList.remove('hidden');
  if (message) loginMessageEl.textContent = message;
}

function hideLogin() {
  loginScreenEl.classList.add('hidden');
}

let apiErrorTimer = null;

function showApiError(title, detail) {
  apiErrorTitleEl.textContent = title || 'Request failed';
  apiErrorDetailEl.textContent = detail || 'Please retry later or check the dashboard backend logs.';
  apiErrorToastEl.classList.remove('hidden');
  clearTimeout(apiErrorTimer);
  apiErrorTimer = setTimeout(hideApiError, 7000);
}

function hideApiError() {
  apiErrorToastEl.classList.add('hidden');
}

async function localLogin() {
  localLoginBtn.disabled = true;
  tokenLoginBtn.disabled = true;
  loginMessageEl.textContent = 'Creating local session...';
  try {
    const response = await fetch('/api/auth/local-login', { method: 'POST', credentials: 'same-origin' });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || 'Local sign-in failed.');
    hideLogin();
    refreshRuntimeState();
    connectRealtime();
  } catch (error) {
    loginMessageEl.textContent = error.message || 'Local sign-in failed. Please use the access token.';
    loginScreenEl.classList.remove('hidden');
  } finally {
    localLoginBtn.disabled = false;
    tokenLoginBtn.disabled = false;
  }
}

async function tokenLogin() {
  const token = tokenInputEl.value.trim();
  if (!token) {
    loginMessageEl.textContent = 'Please enter the access token.';
    return;
  }

  localLoginBtn.disabled = true;
  tokenLoginBtn.disabled = true;
  loginMessageEl.textContent = 'Verifying token...';
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || 'Sign-in failed.');
    tokenInputEl.value = '';
    hideLogin();
    refreshRuntimeState();
    connectRealtime();
  } catch (error) {
    loginMessageEl.textContent = error.message || 'Sign-in failed.';
  } finally {
    localLoginBtn.disabled = false;
    tokenLoginBtn.disabled = false;
  }
}

async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } catch {}
  closeRealtime();
  showLogin('Signed out.');
}

// --- DOM elements ---
const loginScreenEl = document.getElementById('login-screen');
const loginMessageEl = document.getElementById('login-message');
const apiErrorToastEl = document.getElementById('api-error-toast');
const apiErrorTitleEl = document.getElementById('api-error-title');
const apiErrorDetailEl = document.getElementById('api-error-detail');
const localLoginBtn = document.getElementById('local-login-btn');
const tokenLoginBtn = document.getElementById('token-login-btn');
const tokenInputEl = document.getElementById('token-input');
const localVersionEl = document.getElementById('local-version');
const localMessageEl = document.getElementById('local-message');
const latestVersionEl = document.getElementById('latest-version');
const latestMessageEl = document.getElementById('latest-message');
const versionUpdateBar = document.getElementById('version-update-bar');
const versionReleaseLink = document.getElementById('version-release-link');
const updateProgressPanel = document.getElementById('update-progress-panel');
const updateProgressMessage = document.getElementById('update-progress-message');
const updateProgressList = document.getElementById('update-progress-list');
const updateStatusPill = document.getElementById('update-status-pill');
const postUpdateProbeBtn = document.getElementById('post-update-probe-btn');
const updateProgressDetails = document.getElementById('update-progress-details');
const updateDetailsToggle = document.getElementById('update-details-toggle');
const exportScreenshotBtn = document.getElementById('export-screenshot-btn');
const exportReportBtn = document.getElementById('export-report-btn');
const exportBundleBtn = document.getElementById('export-bundle-btn');
const healthScoreEl = document.getElementById('health-score');
const healthSummaryEl = document.getElementById('health-summary');
const healthLevelEl = document.getElementById('health-level');
const healthChecksEl = document.getElementById('health-checks');
const healthUpdatedEl = document.getElementById('health-updated');
const setupSummaryEl = document.getElementById('setup-summary');
const setupUpdatedEl = document.getElementById('setup-updated');
const setupListEl = document.getElementById('setup-list');
const assuranceSummaryEl = document.getElementById('assurance-summary');
const assuranceUpdatedEl = document.getElementById('assurance-updated');
const compatibilityPillEl = document.getElementById('compatibility-pill');
const compatibilityListEl = document.getElementById('compatibility-list');
const preflightPillEl = document.getElementById('preflight-pill');
const preflightListEl = document.getElementById('preflight-list');
const versionSourcesListEl = document.getElementById('version-sources-list');
const configHealthListEl = document.getElementById('config-health-list');
const logRulesPillEl = document.getElementById('log-rules-pill');
const logRulesListEl = document.getElementById('log-rules-list');
const officialDashboardSummaryEl = document.getElementById('official-dashboard-summary');
const officialDashboardDetailEl = document.getElementById('official-dashboard-detail');
const officialDashboardFactsEl = document.getElementById('official-dashboard-facts');
const officialDashboardLinkEl = document.getElementById('official-dashboard-link');
const troubleshootingSummaryEl = document.getElementById('troubleshooting-summary');
const troubleshootingListEl = document.getElementById('troubleshooting-list');
const channelsGridEl = document.getElementById('channels-grid');
const modelCurrentEl = document.getElementById('model-current');
const modelSourceEl = document.getElementById('model-source');
const modelProviderEl = document.getElementById('model-provider');
const modelContextEl = document.getElementById('model-context');
const modelMaxTokensEl = document.getElementById('model-max-tokens');
const modelReasoningEl = document.getElementById('model-reasoning');
const modelFallbacksEl = document.getElementById('model-fallbacks');
const channelsUpdatedAtEl = document.getElementById('channels-updated-at');
const gatewayStatusEl = document.getElementById('gateway-status');
const gatewayDotEl = document.getElementById('gateway-dot');
const gatewayMetricsEl = document.getElementById('gateway-metrics');
const gwPidEl = document.getElementById('gw-pid');
const gwUptimeEl = document.getElementById('gw-uptime');
const gwMemoryEl = document.getElementById('gw-memory');
const controlMessageEl = document.getElementById('control-message');
const diagnosticsSummaryEl = document.getElementById('diagnostics-summary');
const diagnosticsUpdatedEl = document.getElementById('diagnostics-updated');
const diagnosticsCardsEl = document.getElementById('diagnostics-cards');
const diagnosticsRecommendationsEl = document.getElementById('diagnostics-recommendations');
const diagnosticsProbeBtn = document.getElementById('diagnostics-probe-btn');
const channelVerifyMessageEl = document.getElementById('channel-verify-message');
const channelVerifyButtons = Array.from(document.querySelectorAll('.channel-verify-button'));
const timelineListEl = document.getElementById('timeline-list');
const timelineUpdatedEl = document.getElementById('timeline-updated');
const diskFreeEl = document.getElementById('disk-free');
const diskPercentEl = document.getElementById('disk-percent');
const diskBarEl = document.getElementById('disk-bar');
const diskUpdatedAtEl = document.getElementById('disk-updated-at');
const memoryFreeEl = document.getElementById('memory-free');
const memoryPercentEl = document.getElementById('memory-percent');
const memoryBarEl = document.getElementById('memory-bar');
const memoryUpdatedAtEl = document.getElementById('memory-updated-at');
const memoryTotalEl = document.getElementById('memory-total');
const memoryUsedEl = document.getElementById('memory-used');
const memoryFree2El = document.getElementById('memory-free2');
const updateBtnEl = document.getElementById('update-btn');
const errorsEmptyEl = document.getElementById('errors-empty');
const errorsListEl = document.getElementById('errors-list');
const errorsUpdatedEl = document.getElementById('errors-updated');
const auditListEl = document.getElementById('audit-list');
const auditUpdatedEl = document.getElementById('audit-updated');
const controlButtons = Array.from(document.querySelectorAll('.control-button'));
let isControlRequestActive = false;
let updatePollTimer = null;
let isUpdateDetailsExpanded = false;
let lastUpdateJobStatus = null;

const actionLabels = {
  start: 'Start',
  restart: 'Restart',
  stop: 'Stop',
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderStatusPill(el, ok, label) {
  el.textContent = label || (ok ? 'OK' : 'Attention');
  el.className = 'rounded-md border px-2 py-1 text-xs ' + (
    ok
      ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
      : 'border-amber-400/20 bg-amber-400/10 text-amber-200'
  );
}

function renderMiniRows(items) {
  if (!items || !items.length) return '<p class="text-zinc-600">No data.</p>';
  return items.map((item) => {
    const ok = item.ok !== false;
    const dot = ok ? 'bg-emerald-500' : 'bg-amber-500';
    return `<div class="flex gap-3 rounded-md border border-white/5 bg-white/[0.025] px-3 py-2">
      <span class="mt-1 h-2 w-2 shrink-0 rounded-full ${dot}"></span>
      <div class="min-w-0">
        <p class="font-medium text-zinc-300">${escapeHtml(item.name || item.title || '-')}</p>
        <p class="mt-1 break-words text-zinc-500">${escapeHtml(item.detail || item.error || item.status || '')}</p>
      </div>
    </div>`;
  }).join('');
}

function maskSensitiveText(text) {
  return String(text || '')
    .replace(/ou_[a-z0-9_]+/gi, 'ou_••••••')
    .replace(/cli_[a-z0-9_]+/gi, 'cli_••••••')
    .replace(/\b\d{8,}\b/g, '••••••')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, 'IP••••')
    .replace(/PID:\s*\d+/gi, 'PID: ••••')
    .replace(/\/Users\/[^\s<"]+/g, '/Users/••••');
}

function compactVersionSource(source) {
  const text = String(source || '');
  if (text.includes('github-releases')) return 'GitHub Releases';
  if (text.includes('npm-registry')) return 'npm registry';
  if (text.includes('dash-version-cache')) return 'Dash cache';
  if (text.includes('update-check-cache')) return 'OpenClaw cache';
  return text || 'unknown';
}

function buildExportTarget() {
  const shell = document.createElement('div');
  shell.className = 'bg-zinc-950 text-zinc-100 antialiased';
  shell.style.width = '1152px';
  shell.style.minHeight = '100px';
  shell.style.position = 'fixed';
  shell.style.left = '-10000px';
  shell.style.top = '0';
  shell.style.zIndex = '-1';
  shell.style.overflow = 'hidden';

  const headerClone = document.querySelector('header').cloneNode(true);
  const contentClone = document.querySelector('main > section').cloneNode(true);

  headerClone.querySelector('#export-screenshot-btn')?.remove();
  headerClone.querySelector('#export-report-btn')?.remove();
  headerClone.querySelector('#export-bundle-btn')?.remove();
  headerClone.querySelector('button[onclick="logout()"]')?.remove();

  for (const button of contentClone.querySelectorAll('button')) {
    if (button.closest('#update-progress-panel') || button.closest('#diagnostics-probe-btn')) continue;
    if (button.textContent.includes('Refresh') || button.textContent.includes('Copy')) button.remove();
  }

  const gatewayPanel = contentClone.querySelector('#gateway-control-panel');
  const gatewayLayout = gatewayPanel?.querySelector('.gateway-control-layout');
  const gatewayButtons = gatewayPanel?.querySelector('.grid');
  if (gatewayLayout) {
    gatewayLayout.className = 'gateway-control-layout';
    gatewayLayout.style.display = 'grid';
    gatewayLayout.style.gridTemplateColumns = '1fr 360px';
    gatewayLayout.style.alignItems = 'center';
    gatewayLayout.style.columnGap = '32px';
  }
  if (gatewayButtons) {
    gatewayButtons.className = '';
    gatewayButtons.style.display = 'grid';
    gatewayButtons.style.gridTemplateColumns = 'repeat(3, 1fr)';
    gatewayButtons.style.gap = '12px';
    gatewayButtons.style.minWidth = '360px';
  }
  for (const button of gatewayPanel?.querySelectorAll('.control-button') || []) {
    button.style.height = '44px';
    button.style.display = 'flex';
    button.style.alignItems = 'center';
    button.style.justifyContent = 'center';
    button.style.lineHeight = '1';
    button.style.padding = '0 16px';
  }

  shell.appendChild(headerClone);
  shell.appendChild(contentClone);
  document.body.appendChild(shell);

  const walker = document.createTreeWalker(shell, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((node) => {
    node.nodeValue = maskSensitiveText(node.nodeValue);
  });

  return shell;
}

async function exportDashboardImage() {
  if (!window.html2canvas) {
    alert('Screenshot component failed to load. Please check the network and refresh.');
    return;
  }

  exportScreenshotBtn.disabled = true;
  const oldText = exportScreenshotBtn.textContent;
  exportScreenshotBtn.textContent = 'Exporting...';
  let exportTarget = null;
  try {
    exportTarget = buildExportTarget();
    const canvas = await html2canvas(exportTarget, {
      backgroundColor: '#09090b',
      scale: 2,
      useCORS: true,
      width: exportTarget.scrollWidth,
      height: exportTarget.scrollHeight,
      windowWidth: exportTarget.scrollWidth,
      windowHeight: exportTarget.scrollHeight,
    });
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 1));
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `openclaw-dash-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    alert('Image export failed: ' + error.message);
  } finally {
    if (exportTarget) exportTarget.remove();
    exportScreenshotBtn.disabled = false;
    exportScreenshotBtn.textContent = oldText;
  }
}

async function exportMarkdownReport() {
  exportReportBtn.disabled = true;
  const oldText = exportReportBtn.textContent;
  exportReportBtn.textContent = 'Exporting...';
  try {
    const response = await authFetch('/api/report.md');
    if (!response.ok) throw new Error('Report API returned an error.');
    const markdown = await response.text();
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `openclaw-report-${new Date().toISOString().replace(/[:.]/g, '-')}.md`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    showApiError('Report export failed', error.message);
  } finally {
    exportReportBtn.disabled = false;
    exportReportBtn.textContent = oldText;
  }
}

async function exportSupportBundle() {
  exportBundleBtn.disabled = true;
  const oldText = exportBundleBtn.textContent;
  exportBundleBtn.textContent = 'Exporting...';
  try {
    const response = await authFetch('/api/support-bundle.tgz');
    if (!response.ok) throw new Error('Support bundle API returned an error.');
    const bundle = await response.blob();
    const url = URL.createObjectURL(bundle);
    const link = document.createElement('a');
    link.href = url;
    link.download = `openclaw-support-bundle-${new Date().toISOString().replace(/[:.]/g, '-')}.tar.gz`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    showApiError('Support bundle export failed', error.message);
  } finally {
    exportBundleBtn.disabled = false;
    exportBundleBtn.textContent = oldText;
  }
}

// --- API calls ---
async function loadLocalVersion() {
  try {
    const response = await authFetch('/api/version');
    const data = await response.json();

    localVersionEl.textContent = data.version || 'Not installed';
    localMessageEl.textContent = data.message || 'Local version check completed.';
  } catch (error) {
    localVersionEl.textContent = 'Read failed';
    localMessageEl.textContent = 'Cannot reach the backend service. Please confirm the Node.js service is running.';
  }
}

async function loadLatestVersion() {
  try {
    const response = await authFetch('/api/check-update');
    const data = await response.json();

    if (!response.ok || !data.success) {
      latestVersionEl.textContent = 'Fetch failed';
      latestMessageEl.textContent = data.message || 'Could not fetch the latest official version.';
      return;
    }

    latestVersionEl.textContent = data.latestVersion || 'Unknown version';
    latestMessageEl.textContent = data.publishedAt
      ? `Published at: ${new Date(data.publishedAt).toLocaleString()}`
      : `Version source: ${compactVersionSource(data.source)}`;
  } catch (error) {
    latestVersionEl.textContent = 'Fetch failed';
    latestMessageEl.textContent = 'Cannot reach the backend service. Please confirm the Node.js service is running.';
  }
}

function normalizeChannelItems(source) {
  if (!source) return [];
  if (Array.isArray(source.channelItems)) return source.channelItems;
  if (Array.isArray(source.items)) return source.items;
  if (source.detail) return Object.entries(source.detail).map(([id, value]) => ({ id, ...value }));
  return [];
}

function renderChannels(channels) {
  const items = normalizeChannelItems(channels);
  if (!items.length) {
    channelsGridEl.innerHTML = '<article class="rounded-lg border border-white/10 bg-white/[0.04] p-6 text-sm text-zinc-500">No configured channels found.</article>';
    return;
  }

  channelsGridEl.innerHTML = items.map((channel) => {
    const isOnline = channel.status === 'online';
    const statusText = isOnline ? 'Online' : 'Offline';
    const statusClass = isOnline ? 'text-emerald-500' : 'text-rose-500';
    const dotClass = isOnline ? 'bg-emerald-500' : 'bg-rose-500';
    const stats = channel.stats || {};
    const lastSeen = channel.lastSeenAt ? 'Last activity: ' + new Date(channel.lastSeenAt).toLocaleString() : 'No activity timestamp';
    const verification = channel.verification || {};
    const confidenceClass = verification.confidence === 'high'
      ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
      : verification.confidence === 'medium'
        ? 'border-sky-400/20 bg-sky-400/10 text-sky-300'
        : 'border-amber-400/20 bg-amber-400/10 text-amber-200';
    const verifyBadge = channel.supportsVerify
      ? '<span class="rounded-md border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[11px] text-emerald-300">Direct verification supported</span>'
      : '<span class="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-zinc-500">Log/probe monitored</span>';
    const trustBadge = `<span class="rounded-md border px-2 py-1 text-[11px] ${confidenceClass}">${escapeHtml(verification.label || 'Unknown confidence')}</span>`;
    return `<article class="flex h-full min-h-[330px] flex-col rounded-lg border border-white/10 bg-white/[0.04] p-6">
      <div class="flex items-center justify-between gap-4">
        <p class="min-w-0 truncate text-sm font-medium text-zinc-400">${escapeHtml(channel.label || channel.id || 'Unknown channel')}</p>
        <span class="h-3 w-3 shrink-0 rounded-full ${dotClass}"></span>
      </div>
      <div class="mt-4 flex min-h-8 flex-wrap items-start gap-2">
        ${verifyBadge}
        ${trustBadge}
      </div>
      <div class="mt-5">
        <p class="text-2xl font-semibold ${statusClass}">${statusText}</p>
        <p class="mt-4 text-xs text-zinc-500">${escapeHtml(lastSeen)}</p>
        <div class="mt-3 min-h-16">
          <p class="break-words text-xs leading-5 text-zinc-600">${escapeHtml(channel.reason || '')}${verification.detail ? ' · ' + escapeHtml(verification.detail) : ''}</p>
        </div>
      </div>
      <div class="mt-auto grid grid-cols-3 gap-3 pt-6 text-xs">
        <div class="min-h-[70px] rounded-md bg-zinc-950/40 px-3 py-3">
          <p class="text-zinc-600">Today</p>
          <p class="mt-1 font-semibold text-zinc-200">${escapeHtml(stats.todayMessages ?? '-')}</p>
        </div>
        <div class="min-h-[70px] rounded-md bg-zinc-950/40 px-3 py-3">
          <p class="text-zinc-600">1 hour</p>
          <p class="mt-1 font-semibold text-zinc-200">${escapeHtml(stats.lastHourMessages ?? '-')}</p>
        </div>
        <div class="min-h-[70px] rounded-md bg-zinc-950/40 px-3 py-3">
          <p class="text-zinc-600">Errors</p>
          <p class="mt-1 font-semibold text-rose-300">${escapeHtml(stats.errorCount ?? '-')}</p>
        </div>
      </div>
    </article>`;
  }).join('');
}

function renderGatewayRunning(isRunning, updateMessage = true) {
  gatewayStatusEl.textContent = isRunning ? 'Running' : 'Stopped';
  gatewayStatusEl.className = `text-2xl font-semibold ${
    isRunning ? 'text-emerald-500' : 'text-rose-500'
  }`;
  gatewayDotEl.className = `h-3 w-3 rounded-full ${
    isRunning ? 'bg-emerald-500' : 'bg-rose-500'
  }`;
  if (updateMessage && !isControlRequestActive) {
    controlMessageEl.textContent = isRunning
      ? 'Gateway process is running.'
      : 'Gateway process is not running.';
  }
}

function renderUpdateJob(job) {
  job = job || { status: 'idle', running: false, message: 'No update job.', steps: [] };

  const isRunning = Boolean(job.running);
  const steps = job.steps || [];
  const lastStep = steps[steps.length - 1];
  if (isRunning) isUpdateDetailsExpanded = true;
  if (!isRunning && lastUpdateJobStatus !== job.status) isUpdateDetailsExpanded = false;
  lastUpdateJobStatus = job.status;

  updateProgressPanel.classList.remove('hidden');
  updateProgressPanel.className = 'mt-6 rounded-lg border p-4 ' + (
    isRunning
      ? 'border-amber-400/20 bg-amber-400/[0.05]'
      : job.status === 'success'
        ? 'border-emerald-400/20 bg-emerald-400/[0.05]'
        : job.status === 'error'
          ? 'border-rose-400/20 bg-rose-400/[0.05]'
          : 'border-white/10 bg-white/[0.025]'
  );
  updateProgressMessage.textContent = isRunning
    ? (job.message || 'Update job is running.')
    : job.status === 'idle'
      ? 'No update job. Click “Update System” to show live steps here.'
      : `${job.message || 'Update job finished.'}${lastStep ? ` Last step: ${lastStep.name} · ${lastStep.status}` : ''}`;
  updateStatusPill.textContent = job.status || 'idle';
  updateStatusPill.className = 'rounded-md border px-3 py-1 text-xs ' + (
    job.status === 'success'
      ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
      : job.status === 'error'
        ? 'border-rose-400/20 bg-rose-400/10 text-rose-300'
        : job.status === 'running'
          ? 'border-amber-400/20 bg-amber-400/10 text-amber-200'
          : 'border-white/10 bg-white/[0.04] text-zinc-500'
  );

  updateProgressList.innerHTML = (job.steps || []).map((step) => {
    const color = step.status === 'success'
      ? 'bg-emerald-500'
      : step.status === 'error'
        ? 'bg-rose-500'
        : step.status === 'warning'
          ? 'bg-amber-500'
          : step.status === 'skipped'
            ? 'bg-zinc-600'
            : 'bg-sky-500';
    const time = step.timestamp ? new Date(step.timestamp).toLocaleTimeString() : '';
    return `<div class="rounded-md border border-white/10 bg-zinc-950/35 px-4 py-3">
      <div class="flex items-center justify-between gap-4">
        <div class="flex min-w-0 items-center gap-3">
          <span class="h-2.5 w-2.5 shrink-0 rounded-full ${color}"></span>
          <span class="font-medium text-zinc-200">${escapeHtml(step.name)}</span>
          <span class="text-zinc-600">${escapeHtml(step.status)}</span>
        </div>
        <span class="shrink-0 text-zinc-600">${time}</span>
      </div>
      ${step.detail ? `<pre class="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-zinc-500">${escapeHtml(step.detail)}</pre>` : ''}
    </div>`;
  }).join('');

  updateProgressDetails.classList.toggle('hidden', !isUpdateDetailsExpanded);
  updateDetailsToggle.classList.toggle('hidden', isRunning || steps.length === 0);
  updateDetailsToggle.textContent = isUpdateDetailsExpanded ? 'Hide Details' : 'Show Details';

  updateBtnEl.disabled = isRunning;
  updateBtnEl.textContent = isRunning ? 'Updating...' : 'Update System';
  if (job.status === 'success' || job.postUpdateDiagnostics) {
    postUpdateProbeBtn.classList.remove('hidden');
  } else {
    postUpdateProbeBtn.classList.add('hidden');
  }
}

function toggleUpdateDetails() {
  isUpdateDetailsExpanded = !isUpdateDetailsExpanded;
  updateProgressDetails.classList.toggle('hidden', !isUpdateDetailsExpanded);
  updateDetailsToggle.textContent = isUpdateDetailsExpanded ? 'Hide Details' : 'Show Details';
}

async function loadHealthSummary() {
  try {
    const response = await authFetch('/api/health/summary');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to read health summary.');

    const score = Number(data.score || 0);
    const tone = score >= 90
      ? { text: 'Excellent', score: 'text-emerald-300', pill: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300' }
      : score >= 75
        ? { text: 'Good', score: 'text-sky-300', pill: 'border-sky-400/20 bg-sky-400/10 text-sky-300' }
        : score >= 60
          ? { text: 'Attention', score: 'text-amber-300', pill: 'border-amber-400/20 bg-amber-400/10 text-amber-200' }
          : { text: 'Critical', score: 'text-rose-300', pill: 'border-rose-400/20 bg-rose-400/10 text-rose-300' };

    healthScoreEl.textContent = `${score}`;
    healthScoreEl.className = `mt-3 text-5xl font-semibold ${tone.score}`;
    healthSummaryEl.textContent = data.summary || 'Health summary refreshed.';
    healthLevelEl.textContent = tone.text;
    healthLevelEl.className = `rounded-md border px-3 py-1 text-xs ${tone.pill}`;
    healthChecksEl.innerHTML = renderMiniRows((data.checks || []).map((check) => ({
      name: `${check.name}${check.penalty ? ' · -' + check.penalty : ''}`,
      ok: check.ok,
      detail: check.detail,
    })));
    healthUpdatedEl.textContent = data.collectedAt ? 'Updated at ' + new Date(data.collectedAt).toLocaleString() : 'Refreshed';
  } catch (error) {
    healthScoreEl.textContent = '--';
    healthScoreEl.className = 'mt-3 text-5xl font-semibold text-rose-300';
    healthSummaryEl.textContent = error.message;
    healthLevelEl.textContent = 'Error';
    healthLevelEl.className = 'rounded-md border border-rose-400/20 bg-rose-400/10 px-3 py-1 text-xs text-rose-300';
  }
}

async function loadSetupStatus() {
  setupSummaryEl.textContent = 'Checking environment...';
  try {
    const response = await authFetch('/api/setup/status');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to read first-run wizard status.');

    setupSummaryEl.textContent = data.ok ? 'Startup environment is ready' : `${data.passed}/${data.required} checks passed`;
    setupSummaryEl.className = `mt-3 text-2xl font-semibold ${data.ok ? 'text-emerald-300' : 'text-amber-300'}`;
    setupUpdatedEl.textContent = data.remoteMode
      ? `Listening on LAN at ${data.host}:${data.port}; use only on trusted networks.`
      : `Local-only safe mode ${data.host}:${data.port} · ${new Date(data.collectedAt).toLocaleString()}`;
    setupListEl.innerHTML = renderMiniRows(data.checks || []);
  } catch (error) {
    setupSummaryEl.textContent = 'Environment check failed';
    setupSummaryEl.className = 'mt-3 text-2xl font-semibold text-rose-300';
    setupUpdatedEl.textContent = error.message;
  }
}

async function loadAssurance() {
  assuranceSummaryEl.textContent = 'Checking...';
  try {
    const [compatibility, preflight, versionSources, configHealth, logRules] = await Promise.all([
      authFetch('/api/compatibility').then((res) => res.json()),
      authFetch('/api/update/preflight').then((res) => res.json()),
      authFetch('/api/version/sources').then((res) => res.json()),
      authFetch('/api/config/health').then((res) => res.json()),
      authFetch('/api/log-rules').then((res) => res.json()),
    ]);

    const attention = [
      !compatibility.ok,
      !preflight.ok && preflight.updateAvailable,
      (versionSources.sources || []).every((source) => !source.ok),
    ].filter(Boolean).length;
    assuranceSummaryEl.textContent = attention ? `Found ${attention} items needing attention` : 'Assurance checks are healthy';
    assuranceSummaryEl.className = `mt-3 text-2xl font-semibold ${attention ? 'text-amber-300' : 'text-emerald-300'}`;
    assuranceUpdatedEl.textContent = 'Checked at ' + new Date().toLocaleString();

    renderStatusPill(compatibilityPillEl, compatibility.ok, `${compatibility.passed}/${compatibility.required}`);
    compatibilityListEl.innerHTML = renderMiniRows((compatibility.checks || []).slice(0, 6).map((check) => ({
      name: check.name,
      ok: check.ok,
      detail: check.ok ? check.command : (check.error || check.command),
    })));

    renderStatusPill(preflightPillEl, preflight.ok, preflight.updateAvailable ? 'Update available' : 'No update');
    preflightListEl.innerHTML = renderMiniRows(preflight.checks || []);

    versionSourcesListEl.innerHTML = renderMiniRows((versionSources.sources || []).map((source) => ({
      name: `${source.name}${source.latestVersion ? ' · ' + source.latestVersion : ''}`,
      ok: source.ok,
      detail: source.ok ? source.status : source.detail,
    })));

          configHealthListEl.innerHTML = renderMiniRows((configHealth.channels || []).map((channel) => ({
            name: `${channel.channel} · ${channel.enabled ? 'enabled' : 'disabled'}`,
            ok: channel.enabled,
            detail: `allowFrom ${channel.allowFromCount}, group ${channel.groupAllowFromCount}, blockStreaming ${channel.blockStreamingConfigured ? channel.blockStreaming : 'Not configured'}`,
          })));

    logRulesPillEl.textContent = `${logRules.activeCount || 0} enabled`;
    logRulesListEl.innerHTML = (logRules.rules || []).map((rule) => `
      <label class="flex items-start gap-3 rounded-md border border-white/5 bg-white/[0.025] px-3 py-2">
        <input type="checkbox" class="mt-0.5 accent-emerald-500" ${rule.enabled ? 'checked' : ''} onchange="toggleLogRule('${escapeHtml(rule.id)}', this.checked)" />
        <span class="min-w-0">
          <span class="block font-medium text-zinc-300">${escapeHtml(rule.label)}</span>
          <span class="mt-1 block text-zinc-500">${escapeHtml(rule.description)}</span>
        </span>
      </label>
    `).join('');
  } catch (error) {
    assuranceSummaryEl.textContent = 'Assurance check failed';
    assuranceSummaryEl.className = 'mt-3 text-2xl font-semibold text-rose-300';
    assuranceUpdatedEl.textContent = error.message;
  }
}

function renderOfficialDashboard(data) {
  const reachable = Boolean(data.reachable);
  officialDashboardSummaryEl.textContent = reachable ? 'Official Dashboard reachable' : 'Official Dashboard not responding';
  officialDashboardSummaryEl.className = `mt-3 text-2xl font-semibold ${reachable ? 'text-emerald-300' : 'text-amber-300'}`;
  officialDashboardDetailEl.textContent = data.recommendation || 'Official Control UI status refreshed.';
  officialDashboardLinkEl.href = data.url || 'http://127.0.0.1:18789/';
  officialDashboardLinkEl.className = 'self-start rounded-md px-4 py-2 text-sm font-semibold text-white transition ' + (
    reachable ? 'bg-emerald-500 hover:bg-emerald-400' : 'bg-zinc-700 hover:bg-zinc-600'
  );

  const authText = data.auth?.configured
    ? `Configured${data.auth.mode ? ' · ' + data.auth.mode : ''}`
    : 'No explicit config found';
  officialDashboardFactsEl.innerHTML = [
    { name: 'URL', ok: reachable, detail: data.url || '-' },
    { name: 'HTTP status', ok: reachable, detail: data.httpStatus || data.error || '-' },
    { name: 'Gateway Auth', ok: data.auth?.configured, detail: authText },
  ].map((item) => `<div class="rounded-md border border-white/10 bg-zinc-950/40 px-4 py-3">
    <p class="text-zinc-600">${escapeHtml(item.name)}</p>
    <p class="mt-1 break-all font-semibold ${item.ok ? 'text-emerald-300' : 'text-amber-300'}">${escapeHtml(item.detail)}</p>
  </div>`).join('');
}

function renderTroubleshooting(data) {
  const steps = data.steps || [];
  const warningCount = steps.filter((step) => ['critical', 'warning'].includes(step.level)).length;
  troubleshootingSummaryEl.textContent = warningCount ? `${warningCount} priority checks` : 'Troubleshooting path is clear';
  troubleshootingSummaryEl.className = `mt-3 text-2xl font-semibold ${warningCount ? 'text-amber-300' : 'text-emerald-300'}`;
  const tone = {
    ok: 'border-emerald-400/15 bg-emerald-400/[0.06] text-emerald-200',
    info: 'border-sky-400/15 bg-sky-400/[0.06] text-sky-200',
    warning: 'border-amber-400/15 bg-amber-400/[0.06] text-amber-200',
    critical: 'border-rose-400/15 bg-rose-400/[0.06] text-rose-200',
  };
  troubleshootingListEl.innerHTML = steps.map((step) => `
    <div class="rounded-md border px-4 py-3 ${tone[step.level] || tone.info}">
      <p class="font-semibold">${escapeHtml(step.title)}</p>
      <p class="mt-1 leading-5 text-zinc-400">${escapeHtml(step.detail)}</p>
    </div>
  `).join('');
}

async function loadOfficialDashboard() {
  try {
    const response = await authFetch('/api/official-dashboard');
    const data = await response.json();
    renderOfficialDashboard(data);
  } catch (error) {
    officialDashboardSummaryEl.textContent = 'Check failed';
    officialDashboardSummaryEl.className = 'mt-3 text-2xl font-semibold text-rose-300';
    officialDashboardDetailEl.textContent = error.message;
  }
}

async function loadTroubleshooting() {
  troubleshootingSummaryEl.textContent = 'Analyzing...';
  try {
    const response = await authFetch('/api/troubleshooting');
    const data = await response.json();
    renderTroubleshooting(data);
    if (data.officialDashboard) renderOfficialDashboard(data.officialDashboard);
  } catch (error) {
    troubleshootingSummaryEl.textContent = 'Analysis failed';
    troubleshootingSummaryEl.className = 'mt-3 text-2xl font-semibold text-rose-300';
    troubleshootingListEl.innerHTML = `<p class="text-zinc-500">${escapeHtml(error.message)}</p>`;
  }
}

async function toggleLogRule(id, enabled) {
  try {
    await authFetch('/api/log-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, enabled }),
    });
    loadErrors();
    loadAssurance();
  } catch (error) {
    alert('Failed to update log muting rule: ' + error.message);
  }
}

async function pollUpdateStatus() {
  try {
    const response = await authFetch('/api/update/status');
    const job = await response.json();
    renderUpdateJob(job);

    if (!job.running && updatePollTimer) {
        clearInterval(updatePollTimer);
        updatePollTimer = null;
        refreshRuntimeState();
        loadDiagnostics();
        loadTimeline();
      }
  } catch (error) {
    // keep current UI state
  }
}

function startUpdatePolling() {
  pollUpdateStatus();
  if (!updatePollTimer) {
    updatePollTimer = setInterval(pollUpdateStatus, 1500);
  }
}

async function loadChannels() {
  try {
    const response = await authFetch('/api/channels');
    const data = await response.json();

    renderChannels(data);
    channelsUpdatedAtEl.textContent = `Updated at ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    renderChannels([]);
    channelsUpdatedAtEl.textContent = 'Refresh failed';
  }
}

async function loadGatewayStatus(options = {}) {
  const { updateMessage = true } = options;

  try {
    const response = await authFetch('/api/status');
    const data = await response.json();
    const isRunning = Boolean(data.isRunning);

    renderGatewayRunning(isRunning, updateMessage);
  } catch (error) {
    gatewayStatusEl.textContent = 'Unknown';
    gatewayStatusEl.className = 'text-2xl font-semibold text-zinc-300';
    gatewayDotEl.className = 'h-3 w-3 rounded-full bg-zinc-600';
    if (updateMessage && !isControlRequestActive) {
      controlMessageEl.textContent = 'Unable to read Gateway status.';
    }
  }
}

function setControlButtonsDisabled(disabled, activeAction) {
  controlButtons.forEach((button) => {
    const action = button.dataset.action;
    button.disabled = disabled;
    button.textContent = disabled && action === activeAction ? 'Loading...' : actionLabels[action];
  });
}

function formatNumber(value) {
  if (value == null) return '-';
  return Number(value).toLocaleString();
}

function renderModel(model) {
  if (!model || !model.current) {
    modelCurrentEl.textContent = 'No model detected';
    modelSourceEl.textContent = 'Could not read model data from OpenClaw config or logs.';
    modelProviderEl.textContent = '-';
    modelContextEl.textContent = '-';
    modelMaxTokensEl.textContent = '-';
    modelReasoningEl.textContent = '-';
    modelFallbacksEl.textContent = '';
    return;
  }

  modelCurrentEl.textContent = model.alias ? `${model.alias} · ${model.current}` : model.current;
  modelProviderEl.textContent = model.provider || '-';
  modelContextEl.textContent = formatNumber(model.contextWindow);
  modelMaxTokensEl.textContent = formatNumber(model.maxTokens);
  modelReasoningEl.textContent = model.reasoning == null ? '-' : model.reasoning ? 'Supported' : 'Unsupported';

  const sourceText = model.source === 'gateway.log' ? 'Gateway log confirmed' : 'Config file';
  modelSourceEl.textContent = model.lastSeenAt
    ? `${sourceText} · ${new Date(model.lastSeenAt).toLocaleString()}`
    : `${sourceText} · Current default model`;
  modelFallbacksEl.textContent = Array.isArray(model.fallbacks) && model.fallbacks.length
    ? `Fallbacks: ${model.fallbacks.join(' / ')}`
    : '';
}

function diagnosticTone(ok, warning) {
  if (ok) return { text: 'OK', dot: 'bg-emerald-500', textClass: 'text-emerald-300', border: 'border-emerald-400/15' };
  if (warning) return { text: 'Issue', dot: 'bg-amber-500', textClass: 'text-amber-300', border: 'border-amber-400/15' };
  return { text: 'Issue', dot: 'bg-rose-500', textClass: 'text-rose-300', border: 'border-rose-400/15' };
}

function renderDiagnosticCard(title, statusText, detail, tone) {
  return `<div class="rounded-md border ${tone.border} bg-zinc-950/35 px-4 py-3">
    <div class="flex items-center justify-between gap-3">
      <p class="text-xs text-zinc-500">${escapeHtml(title)}</p>
      <span class="h-2.5 w-2.5 shrink-0 rounded-full ${tone.dot}"></span>
    </div>
    <p class="mt-2 text-sm font-semibold ${tone.textClass}">${escapeHtml(statusText)}</p>
    <p class="mt-2 min-h-8 text-xs leading-5 text-zinc-500 break-all">${escapeHtml(detail || '-')}</p>
  </div>`;
}

function renderDiagnostics(data) {
  const feishuProbe = data.openclawProbe?.channels?.feishu?.probe || {};
  const telegramProbe = data.openclawProbe?.channels?.telegram?.probe || {};
  const gatewayOk = Boolean(data.gateway?.isRunning);
  const feishuDirectOk = Boolean(data.feishuDirect?.ok);
  const feishuGatewayOk = Boolean(feishuProbe.ok);
  const telegramOk = Boolean(telegramProbe.ok || data.channels?.telegram === 'online');
  const criticalCount = [gatewayOk, feishuDirectOk, telegramOk].filter(Boolean).length;

  diagnosticsSummaryEl.textContent = gatewayOk && feishuDirectOk && telegramOk
    ? 'Core path is mostly healthy'
    : `Found ${3 - criticalCount} items needing attention`;
  diagnosticsSummaryEl.className = `mt-3 text-2xl font-semibold ${gatewayOk && feishuDirectOk && telegramOk ? 'text-emerald-300' : 'text-amber-300'}`;
  diagnosticsUpdatedEl.textContent = data.collectedAt
    ? 'Diagnosed at ' + new Date(data.collectedAt).toLocaleString()
    : 'Diagnostics completed';

  diagnosticsCardsEl.innerHTML = [
    renderDiagnosticCard('Gateway', gatewayOk ? 'Running' : 'Stopped', gatewayOk ? `${(data.gateway.processes || []).length} processes` : 'Gateway process not detected', diagnosticTone(gatewayOk)),
    renderDiagnosticCard('Feishu API Direct', feishuDirectOk ? 'OK' : 'Failed', feishuDirectOk ? `Bot ${data.feishuDirect?.botName || data.feishuDirect?.botOpenId || 'Verified'}` : (data.feishuDirect?.error || 'Direct check failed'), diagnosticTone(feishuDirectOk)),
    renderDiagnosticCard('Feishu Gateway Probe', feishuGatewayOk ? 'OK' : 'Failed', feishuGatewayOk ? 'OpenClaw channel probe passed' : (feishuProbe.error || data.channels?.detail?.feishu?.reason || 'Probe failed'), diagnosticTone(feishuGatewayOk, feishuDirectOk && !feishuGatewayOk)),
    renderDiagnosticCard('Telegram Probe', telegramOk ? 'OK' : 'Failed', telegramOk ? 'Telegram bot probe passed' : (telegramProbe.error || data.channels?.detail?.telegram?.reason || 'Probe failed'), diagnosticTone(telegramOk)),
  ].join('');

  const levels = {
    ok: 'border-emerald-400/15 bg-emerald-400/[0.06] text-emerald-200',
    info: 'border-sky-400/15 bg-sky-400/[0.06] text-sky-200',
    warning: 'border-amber-400/15 bg-amber-400/[0.06] text-amber-200',
    critical: 'border-rose-400/15 bg-rose-400/[0.06] text-rose-200',
  };
  diagnosticsRecommendationsEl.innerHTML = (data.recommendations || []).map((item) => `
    <div class="rounded-md border px-4 py-3 ${levels[item.level] || levels.info}">
      <p class="text-sm font-semibold">${escapeHtml(item.title)}</p>
      <p class="mt-1 text-xs leading-5 text-zinc-400">${escapeHtml(item.detail)}</p>
    </div>
  `).join('');
}

async function loadDiagnostics() {
  try {
    const response = await authFetch('/api/diagnostics');
    const data = await response.json();
    renderDiagnostics(data);
  } catch (error) {
    diagnosticsSummaryEl.textContent = 'Diagnostics read failed';
    diagnosticsSummaryEl.className = 'mt-3 text-2xl font-semibold text-rose-300';
    diagnosticsUpdatedEl.textContent = 'Cannot reach backend diagnostics API.';
  }
}

async function runDiagnosticsProbe() {
  diagnosticsProbeBtn.disabled = true;
  postUpdateProbeBtn.disabled = true;
  diagnosticsProbeBtn.textContent = 'Diagnosing...';
  try {
    const response = await authFetch('/api/diagnostics/probe', { method: 'POST' });
    const data = await response.json();
    renderDiagnostics(data);
    loadAudit();
    loadTimeline();
  } catch (error) {
    diagnosticsSummaryEl.textContent = 'Diagnostics failed';
    diagnosticsSummaryEl.className = 'mt-3 text-2xl font-semibold text-rose-300';
    diagnosticsUpdatedEl.textContent = 'Diagnostics API execution failed.';
  } finally {
    diagnosticsProbeBtn.disabled = false;
    postUpdateProbeBtn.disabled = false;
    diagnosticsProbeBtn.textContent = 'Run Diagnostics';
  }
}

async function verifyChannel(channel) {
  const label = channel === 'feishu' ? 'Feishu' : 'Telegram';
  if (!window.confirm(`Confirm sending a test message to ${label}?`)) return;

  channelVerifyButtons.forEach((button) => { button.disabled = true; });
  channelVerifyMessageEl.textContent = `Running ${label} real verification...`;
  try {
    const response = await authFetch('/api/channels/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, confirm: true }),
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || 'Verification failed.');
      channelVerifyMessageEl.textContent = `${label} test message sent. ${data.received ? 'Gateway recent activity looks healthy.' : 'Gateway recent activity is still unconfirmed; please check whether the reply arrives.'}`;
      loadChannels();
      loadDiagnostics();
    loadTimeline();
    loadAudit();
  } catch (error) {
    channelVerifyMessageEl.textContent = `${label} real verification failed: ${error.message}`;
  } finally {
    channelVerifyButtons.forEach((button) => { button.disabled = false; });
  }
}

async function loadTimeline() {
  try {
    const response = await authFetch('/api/timeline');
    const data = await response.json();
    const events = data.events || [];
    if (!events.length) {
      timelineListEl.innerHTML = '<p class="text-sm text-zinc-500">No events.</p>';
    } else {
      const tone = {
        ok: 'bg-emerald-500',
        info: 'bg-sky-500',
        warning: 'bg-amber-500',
        critical: 'bg-rose-500',
      };
      timelineListEl.innerHTML = events.slice(0, 12).map((event) => {
        const time = event.timestamp ? new Date(event.timestamp).toLocaleString() : '-';
        const detail = event.detail && event.detail.length > 180 ? event.detail.slice(0, 180) + '…' : event.detail;
        return `<div class="grid gap-3 rounded-md border border-white/10 bg-zinc-950/35 px-4 py-3 sm:grid-cols-[150px_1fr]">
          <div class="flex items-center gap-3 text-xs text-zinc-500">
            <span class="h-2.5 w-2.5 rounded-full ${tone[event.level] || tone.info}"></span>
            <span>${time}</span>
          </div>
          <div class="min-w-0">
            <p class="text-sm font-semibold text-zinc-200">${escapeHtml(event.title || event.type || '-')}</p>
            <p class="mt-1 break-words text-xs leading-5 text-zinc-500">${escapeHtml(detail || '')}</p>
          </div>
        </div>`;
      }).join('');
    }
    timelineUpdatedEl.textContent = 'Updated at ' + new Date().toLocaleTimeString();
  } catch (error) {
    timelineListEl.innerHTML = '<p class="text-sm text-zinc-500">Failed to read timeline.</p>';
  }
}

async function loadErrors() {
  try {
    const response = await authFetch('/api/errors');
    const data = await response.json();

    if (!data.errors || data.errors.length === 0) {
      errorsEmptyEl.classList.remove('hidden');
      errorsListEl.innerHTML = '';
      lastErrorsData = [];
    } else {
      errorsEmptyEl.classList.add('hidden');
      lastErrorsData = data.errors;
      errorsListEl.innerHTML = data.errors.map((err) => {
        const ts = err.timestamp ? new Date(err.timestamp).toLocaleString() : '-';
        const source = err.source || '?';
        const msg = err.message.length > 200 ? err.message.slice(0, 200) + '…' : err.message;
        return `<div class="flex gap-3 text-xs border-b border-white/5 pb-2 last:border-0">` +
          `<span class="shrink-0 text-zinc-500 w-36">${ts}</span>` +
          `<span class="shrink-0 text-zinc-600 w-20">${source}</span>` +
          `<span class="text-rose-400/80 break-all">${escapeHtml(msg)}</span>` +
          `</div>`;
      }).join('');
    }
    errorsUpdatedEl.textContent = 'Updated at ' + new Date().toLocaleTimeString();
  } catch (error) {
    errorsEmptyEl.classList.add('hidden');
    errorsListEl.innerHTML = '<p class="text-sm text-zinc-500">Failed to read error logs.</p>';
  }
}

let lastErrorsData = [];
function copyErrors() {
  if (!lastErrorsData || lastErrorsData.length === 0) { alert('No error logs to copy'); return; }
  const text = lastErrorsData.map(err => {
    const ts = err.timestamp ? new Date(err.timestamp).toLocaleString() : '-';
    return `[${ts}] [${err.source || '?'}] ${err.message}`;
  }).join('\n');
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.querySelector('button[onclick="copyErrors()"]');
    if (btn) { const orig = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => btn.textContent = orig, 1500); }
  }).catch(() => alert('Copy failed'));
}

async function loadAudit() {
  try {
    const response = await authFetch('/api/audit');
    const data = await response.json();
    const entries = data.entries || [];

    if (!entries.length) {
      auditListEl.innerHTML = '<p class="text-zinc-500">No operation records.</p>';
    } else {
      auditListEl.innerHTML = entries.slice(0, 8).map((entry) => {
        const ts = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '-';
        const okClass = entry.success ? 'text-emerald-300' : 'text-rose-300';
        const action = escapeHtml(entry.action || '-');
        const ip = escapeHtml(String(entry.ip || 'unknown').replace(/^::ffff:/, ''));
        return `<div class="grid gap-2 rounded-md border border-white/10 bg-zinc-950/35 px-4 py-3 sm:grid-cols-[160px_1fr_120px_80px] sm:items-center">
          <span class="text-zinc-500">${ts}</span>
          <span class="font-medium text-zinc-200">${action}</span>
          <span class="text-zinc-500">${ip}</span>
          <span class="${okClass}">${entry.success ? 'Success' : 'Failed'}</span>
        </div>`;
      }).join('');
    }

    auditUpdatedEl.textContent = 'Updated at ' + new Date().toLocaleTimeString();
  } catch (error) {
    auditListEl.innerHTML = '<p class="text-zinc-500">Failed to read operation audit.</p>';
  }
}

async function handleControlClick(event) {
  const action = event.currentTarget.dataset.action;

  isControlRequestActive = true;
  setControlButtonsDisabled(true, action);
  controlMessageEl.textContent = `Running  ${actionLabels[action]}; please wait.`;

  try {
    const response = await authFetch('/api/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const data = await response.json();

    controlMessageEl.textContent = data.message || `${actionLabels[action]} command sent.`;

    if (!response.ok || !data.success) {
      controlMessageEl.textContent = data.detail || data.message || `${actionLabels[action]} command failed.`;
    }
  } catch (error) {
    controlMessageEl.textContent = 'Cannot reach backend service; control command failed.';
  } finally {
    await loadGatewayStatus({ updateMessage: false });
    await loadChannels();
    setControlButtonsDisabled(false);

    setTimeout(() => {
      isControlRequestActive = false;
      loadGatewayStatus({ updateMessage: false });
      loadChannels();
      loadDiagnostics();
      loadTroubleshooting();
    }, 1200);
  }
}

async function loadMetrics() {
  try {
    const response = await authFetch('/api/metrics');
    const data = await response.json();

    // Gateway metrics
    if (data.gateway && data.gateway.isRunning) {
      gatewayMetricsEl.classList.remove('hidden');
      gwPidEl.textContent = data.gateway.pid || '-';
      gwUptimeEl.textContent = data.gateway.uptime || '-';
      gwMemoryEl.textContent = data.gateway.memoryRssMb ? data.gateway.memoryRssMb + ' MB' : '-';
    } else {
      gatewayMetricsEl.classList.add('hidden');
    }

    renderChannels(data);

    // Version update bar
    if (data.version) {
      if (data.version.local) {
        localVersionEl.textContent = data.version.local;
        localMessageEl.textContent = 'Local version check completed.';
      }
      if (data.version.latest) {
        latestVersionEl.textContent = data.version.latest;
        latestMessageEl.textContent = data.version.publishedAt
          ? 'Published at: ' + new Date(data.version.publishedAt).toLocaleString()
          : `Version source: ${compactVersionSource(data.version.source)}`;
      }
      if (data.version.updateAvailable && data.version.releaseUrl) {
        versionUpdateBar.classList.remove('hidden');
        versionReleaseLink.href = data.version.releaseUrl;
      } else {
        versionUpdateBar.classList.add('hidden');
      }
    }

    // Version update button
    if (data.version && data.version.updateAvailable) {
      updateBtnEl.classList.remove('hidden');
    } else {
      updateBtnEl.classList.add('hidden');
    }

    renderModel(data.model);

    // Disk
    if (data.disk) {
      diskFreeEl.textContent = data.disk.freeGb ? data.disk.freeGb + ' GB' : '-';
      diskPercentEl.textContent = data.disk.usedPercent != null ? data.disk.usedPercent + '%' : '-';
      const pct = data.disk.usedPercent || 0;
      diskBarEl.style.width = pct + '%';
      diskBarEl.className = 'h-full rounded-full transition-all ' +
        (pct > 90 ? 'bg-rose-500' : pct > 75 ? 'bg-amber-500' : 'bg-emerald-500');
      diskUpdatedAtEl.textContent = 'Updated at ' + new Date().toLocaleTimeString();
    }

    // Memory
    if (data.memory) {
      memoryFreeEl.textContent = data.memory.freeGb + ' GB';
      memoryPercentEl.textContent = data.memory.usedPercent + '%';
      memoryTotalEl.textContent = data.memory.totalGb + ' GB';
      memoryUsedEl.textContent = data.memory.usedGb + ' GB';
      memoryFree2El.textContent = data.memory.freeGb + ' GB';
      const reclaimableEl = document.getElementById('memory-reclaimable');
      if (reclaimableEl && data.memory.reclaimableGb) {
        reclaimableEl.textContent = data.memory.reclaimableGb + ' GB';
      }
      const wiredEl = document.getElementById('memory-wired');
      if (wiredEl && data.memory.wiredGb) {
        wiredEl.textContent = data.memory.wiredGb + ' GB';
      }
      const compressedEl = document.getElementById('memory-compressed');
      if (compressedEl && data.memory.compressedGb) {
        compressedEl.textContent = data.memory.compressedGb + ' GB';
      }
      memoryBarEl.style.width = data.memory.usedPercent + '%';
      memoryBarEl.className = 'h-full rounded-full transition-all ' +
        (data.memory.usedPercent > 90 ? 'bg-rose-500' : data.memory.usedPercent > 75 ? 'bg-amber-500' : 'bg-sky-500');
      memoryUpdatedAtEl.textContent = 'Updated at ' + new Date().toLocaleTimeString();

      // Process list
      const procListEl = document.getElementById('memory-processes-list');
      if (data.memoryProcesses && data.memoryProcesses.length > 0) {
        procListEl.innerHTML = data.memoryProcesses.map((p) => {
          const name = escapeHtml(p.name);
          const user = escapeHtml(p.user);
          const memMb = escapeHtml(p.memMb);

          return `<div class="grid gap-3 rounded-md border border-white/5 bg-white/[0.025] px-4 py-3 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-center">
            <div class="min-w-0">
              <p class="truncate font-medium text-zinc-300" title="${name}">${name}${p.count > 1 ? ' <span class="text-xs font-normal text-zinc-500">×' + p.count + '</span>' : ''}</p>
            </div>
            <div class="grid grid-cols-[minmax(0,1fr)_88px] items-center gap-3">
              <span class="truncate rounded-md bg-white/[0.04] px-2.5 py-1 text-center text-xs text-zinc-500">${user}</span>
              <span class="text-right font-mono text-sm font-semibold tabular-nums text-amber-300">${memMb} MB</span>
            </div>
          </div>`
        }).join('');
      } else {
        procListEl.innerHTML = '<div class="px-4 py-3 text-zinc-600">No data available</div>';
      }
    }
  } catch (error) {
    // silent fail
  }
}

async function doUpdate() {
  if (!window.confirm('Update OpenClaw now? Gateway will stop briefly and restart automatically.')) {
    return;
  }

  updateBtnEl.disabled = true;
  updateBtnEl.textContent = 'Updating...';
  isUpdateDetailsExpanded = true;
  try {
    const response = await authFetch('/api/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    });
    const data = await response.json();

    if (!response.ok || !data.success) {
      updateBtnEl.disabled = false;
      updateBtnEl.textContent = 'Update System';
      alert(data.message || 'Failed to start update job.');
      return;
    }

    renderUpdateJob(data.job);
    startUpdatePolling();
  } catch (error) {
    alert('Update request failed: ' + error.message);
    updateBtnEl.disabled = false;
    updateBtnEl.textContent = 'Update System';
  }
}

function refreshRuntimeState() {
  loadGatewayStatus();
  loadChannels();
  loadMetrics();
  loadErrors();
  loadAudit();
}

let realtimeSocket = null;
let realtimeReconnectTimer = null;
let realtimeConnected = false;
let realtimeShouldReconnect = true;

function renderRealtimeSnapshot(snapshot) {
  if (!snapshot) return;
  if (snapshot.gateway) {
    renderGatewayRunning(Boolean(snapshot.gateway.isRunning), false);
  }
  if (snapshot.channels) {
    renderChannels(snapshot.channels);
    channelsUpdatedAtEl.textContent = snapshot.collectedAt
      ? `Realtime updated at ${new Date(snapshot.collectedAt).toLocaleTimeString()}`
      : `Realtime updated at ${new Date().toLocaleTimeString()}`;
  }
  if (snapshot.update && snapshot.update.running) {
    startUpdatePolling();
  }
}

function connectRealtime() {
  if (!window.WebSocket || realtimeSocket) return;
  realtimeShouldReconnect = true;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  realtimeSocket = new WebSocket(`${protocol}//${window.location.host}/ws/events`);

  realtimeSocket.addEventListener('open', () => {
    realtimeConnected = true;
    hideApiError();
  });

  realtimeSocket.addEventListener('message', (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === 'snapshot') renderRealtimeSnapshot(payload.data);
      if (payload.type === 'error') showApiError('Realtime status push error', payload.message);
    } catch (error) {
      showApiError('Realtime status parse failed', error.message);
    }
  });

  realtimeSocket.addEventListener('close', () => {
    realtimeConnected = false;
    realtimeSocket = null;
    clearTimeout(realtimeReconnectTimer);
    if (realtimeShouldReconnect) realtimeReconnectTimer = setTimeout(connectRealtime, 3000);
  });

  realtimeSocket.addEventListener('error', () => {
    realtimeConnected = false;
  });
}

function closeRealtime() {
  realtimeShouldReconnect = false;
  clearTimeout(realtimeReconnectTimer);
  realtimeReconnectTimer = null;
  realtimeConnected = false;
  if (realtimeSocket) {
    realtimeSocket.close();
    realtimeSocket = null;
  }
}

async function boot() {
  try {
    const statusResponse = await fetch('/api/auth/status', { credentials: 'same-origin' });
    const status = await statusResponse.json();
    if (status.authenticated) {
      hideLogin();
    } else if (status.local) {
      await localLogin();
    } else {
      showLogin('Please sign in with the dashboard access token.');
      return;
    }
  } catch {
    showLogin('Cannot reach backend service.');
    return;
  }

  loadLocalVersion();
  loadLatestVersion();
  refreshRuntimeState();
  loadDiagnostics();
  loadTimeline();
  loadAssurance();
  loadHealthSummary();
  loadSetupStatus();
  loadOfficialDashboard();
  loadTroubleshooting();
  startUpdatePolling();
  connectRealtime();
}

document.addEventListener('DOMContentLoaded', () => {
  localLoginBtn.addEventListener('click', localLogin);
  tokenLoginBtn.addEventListener('click', tokenLogin);
  tokenInputEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') tokenLogin();
  });
  controlButtons.forEach((button) => {
    button.addEventListener('click', handleControlClick);
  });
  boot();
  setInterval(() => {
    if (realtimeConnected) {
      loadMetrics();
      loadErrors();
      loadAudit();
      return;
    }
    refreshRuntimeState();
  }, 5000);
  setInterval(loadDiagnostics, 60000);
  setInterval(loadTimeline, 60000);
  setInterval(loadHealthSummary, 60000);
  setInterval(loadTroubleshooting, 60000);
  setInterval(loadSetupStatus, 300000);
  setInterval(loadOfficialDashboard, 120000);
  setInterval(loadAssurance, 120000);
});
