// --- Auth helpers ---
function authFetch(url, options = {}) {
  options.credentials = 'same-origin';
  options.headers = { ...(options.headers || {}) };
  return fetch(url, options).then(async (res) => {
    if (res.status === 401 && url.startsWith('/api/')) {
      showLogin('登录已失效，请重新登录。');
      throw new Error('Unauthorized');
    }
    if (!res.ok && url.startsWith('/api/')) {
      res.clone().json()
        .then((data) => showApiError(data.message || data.error || '接口请求失败', data.detail || data.reason || `HTTP ${res.status}`))
        .catch(() => showApiError('接口请求失败', `HTTP ${res.status}`));
    }
    return res;
  }).catch((error) => {
    if (error.message !== 'Unauthorized') showApiError('网络请求失败', error.message);
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
  apiErrorTitleEl.textContent = title || '请求失败';
  apiErrorDetailEl.textContent = detail || '请稍后重试，或检查 dashboard 后端日志。';
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
  loginMessageEl.textContent = '正在建立本机会话...';
  try {
    const response = await fetch('/api/auth/local-login', { method: 'POST', credentials: 'same-origin' });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || '本机登录失败。');
    hideLogin();
    refreshRuntimeState();
    connectRealtime();
  } catch (error) {
    loginMessageEl.textContent = error.message || '本机登录失败，请使用访问口令登录。';
    loginScreenEl.classList.remove('hidden');
  } finally {
    localLoginBtn.disabled = false;
    tokenLoginBtn.disabled = false;
  }
}

async function tokenLogin() {
  const token = tokenInputEl.value.trim();
  if (!token) {
    loginMessageEl.textContent = '请输入访问口令。';
    return;
  }

  localLoginBtn.disabled = true;
  tokenLoginBtn.disabled = true;
  loginMessageEl.textContent = '正在验证口令...';
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || '登录失败。');
    tokenInputEl.value = '';
    hideLogin();
    refreshRuntimeState();
    connectRealtime();
  } catch (error) {
    loginMessageEl.textContent = error.message || '登录失败。';
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
  showLogin('已退出登录。');
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
  start: '启动',
  restart: '重启',
  stop: '停止',
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
  if (!items || !items.length) return '<p class="text-zinc-600">暂无数据。</p>';
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
    if (button.textContent.includes('刷新') || button.textContent.includes('复制')) button.remove();
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
    alert('截图组件加载失败，请检查网络后刷新页面。');
    return;
  }

  exportScreenshotBtn.disabled = true;
  const oldText = exportScreenshotBtn.textContent;
  exportScreenshotBtn.textContent = '导出中...';
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
    alert('导出长图失败：' + error.message);
  } finally {
    if (exportTarget) exportTarget.remove();
    exportScreenshotBtn.disabled = false;
    exportScreenshotBtn.textContent = oldText;
  }
}

async function exportMarkdownReport() {
  exportReportBtn.disabled = true;
  const oldText = exportReportBtn.textContent;
  exportReportBtn.textContent = '导出中...';
  try {
    const response = await authFetch('/api/report.md');
    if (!response.ok) throw new Error('报告接口返回异常。');
    const markdown = await response.text();
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `openclaw-report-${new Date().toISOString().replace(/[:.]/g, '-')}.md`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    showApiError('报告导出失败', error.message);
  } finally {
    exportReportBtn.disabled = false;
    exportReportBtn.textContent = oldText;
  }
}

async function exportSupportBundle() {
  exportBundleBtn.disabled = true;
  const oldText = exportBundleBtn.textContent;
  exportBundleBtn.textContent = '导出中...';
  try {
    const response = await authFetch('/api/support-bundle.tgz');
    if (!response.ok) throw new Error('求助包接口返回异常。');
    const bundle = await response.blob();
    const url = URL.createObjectURL(bundle);
    const link = document.createElement('a');
    link.href = url;
    link.download = `openclaw-support-bundle-${new Date().toISOString().replace(/[:.]/g, '-')}.tar.gz`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    showApiError('求助包导出失败', error.message);
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

    localVersionEl.textContent = data.version || '未安装';
    localMessageEl.textContent = data.message || '本地版本检查完成。';
  } catch (error) {
    localVersionEl.textContent = '读取失败';
    localMessageEl.textContent = '无法连接后端服务，请确认 Node.js 服务正在运行。';
  }
}

async function loadLatestVersion() {
  try {
    const response = await authFetch('/api/check-update');
    const data = await response.json();

    if (!response.ok || !data.success) {
      latestVersionEl.textContent = '获取失败';
      latestMessageEl.textContent = data.message || '无法获取官方最新版本。';
      return;
    }

    latestVersionEl.textContent = data.latestVersion || '未知版本';
    latestMessageEl.textContent = data.publishedAt
      ? `发布时间：${new Date(data.publishedAt).toLocaleString()}`
      : `版本源：${compactVersionSource(data.source)}`;
  } catch (error) {
    latestVersionEl.textContent = '获取失败';
    latestMessageEl.textContent = '无法连接后端服务，请确认 Node.js 服务正在运行。';
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
    channelsGridEl.innerHTML = '<article class="rounded-lg border border-white/10 bg-white/[0.04] p-6 text-sm text-zinc-500">未发现已配置通道。</article>';
    return;
  }

  channelsGridEl.innerHTML = items.map((channel) => {
    const isOnline = channel.status === 'online';
    const statusText = isOnline ? 'Online' : 'Offline';
    const statusClass = isOnline ? 'text-emerald-500' : 'text-rose-500';
    const dotClass = isOnline ? 'bg-emerald-500' : 'bg-rose-500';
    const stats = channel.stats || {};
    const lastSeen = channel.lastSeenAt ? '最后活动: ' + new Date(channel.lastSeenAt).toLocaleString() : '暂无活动时间';
    const verification = channel.verification || {};
    const confidenceClass = verification.confidence === 'high'
      ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
      : verification.confidence === 'medium'
        ? 'border-sky-400/20 bg-sky-400/10 text-sky-300'
        : 'border-amber-400/20 bg-amber-400/10 text-amber-200';
    const verifyBadge = channel.supportsVerify
      ? '<span class="rounded-md border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[11px] text-emerald-300">支持真实验证</span>'
      : '<span class="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-zinc-500">日志/探针监测</span>';
    const trustBadge = `<span class="rounded-md border px-2 py-1 text-[11px] ${confidenceClass}">${escapeHtml(verification.label || '可信度未知')}</span>`;
    return `<article class="rounded-lg border border-white/10 bg-white/[0.04] p-6">
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <p class="text-sm font-medium text-zinc-400">${escapeHtml(channel.label || channel.id || '未知通道')}</p>
            ${verifyBadge}
            ${trustBadge}
          </div>
          <p class="mt-3 text-2xl font-semibold ${statusClass}">${statusText}</p>
        </div>
        <span class="mt-1 h-3 w-3 shrink-0 rounded-full ${dotClass}"></span>
      </div>
      <p class="mt-3 text-xs text-zinc-500">${escapeHtml(lastSeen)}</p>
      <p class="mt-2 min-h-10 break-words text-xs leading-5 text-zinc-600">${escapeHtml(channel.reason || '')}${verification.detail ? ' · ' + escapeHtml(verification.detail) : ''}</p>
      <div class="mt-5 grid grid-cols-3 gap-3 text-xs">
        <div class="rounded-md bg-zinc-950/40 px-3 py-2">
          <p class="text-zinc-600">今日</p>
          <p class="mt-1 font-semibold text-zinc-200">${escapeHtml(stats.todayMessages ?? '-')}</p>
        </div>
        <div class="rounded-md bg-zinc-950/40 px-3 py-2">
          <p class="text-zinc-600">1 小时</p>
          <p class="mt-1 font-semibold text-zinc-200">${escapeHtml(stats.lastHourMessages ?? '-')}</p>
        </div>
        <div class="rounded-md bg-zinc-950/40 px-3 py-2">
          <p class="text-zinc-600">错误</p>
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
      ? 'Gateway 进程正在运行。'
      : 'Gateway 进程当前未运行。';
  }
}

function renderUpdateJob(job) {
  job = job || { status: 'idle', running: false, message: '暂无更新任务。', steps: [] };

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
    ? (job.message || '更新任务处理中。')
    : job.status === 'idle'
      ? '暂无更新任务。点击“更新系统”后，这里会显示实时步骤。'
      : `${job.message || '更新任务已结束。'}${lastStep ? ` 最后步骤：${lastStep.name} · ${lastStep.status}` : ''}`;
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
  updateDetailsToggle.textContent = isUpdateDetailsExpanded ? '收起详情' : '展开详情';

  updateBtnEl.disabled = isRunning;
  updateBtnEl.textContent = isRunning ? '更新中...' : '更新系统';
  if (job.status === 'success' || job.postUpdateDiagnostics) {
    postUpdateProbeBtn.classList.remove('hidden');
  } else {
    postUpdateProbeBtn.classList.add('hidden');
  }
}

function toggleUpdateDetails() {
  isUpdateDetailsExpanded = !isUpdateDetailsExpanded;
  updateProgressDetails.classList.toggle('hidden', !isUpdateDetailsExpanded);
  updateDetailsToggle.textContent = isUpdateDetailsExpanded ? '收起详情' : '展开详情';
}

async function loadHealthSummary() {
  try {
    const response = await authFetch('/api/health/summary');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '健康摘要读取失败。');

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
    healthSummaryEl.textContent = data.summary || '健康摘要已刷新。';
    healthLevelEl.textContent = tone.text;
    healthLevelEl.className = `rounded-md border px-3 py-1 text-xs ${tone.pill}`;
    healthChecksEl.innerHTML = renderMiniRows((data.checks || []).map((check) => ({
      name: `${check.name}${check.penalty ? ' · -' + check.penalty : ''}`,
      ok: check.ok,
      detail: check.detail,
    })));
    healthUpdatedEl.textContent = data.collectedAt ? '更新于 ' + new Date(data.collectedAt).toLocaleString() : '已刷新';
  } catch (error) {
    healthScoreEl.textContent = '--';
    healthScoreEl.className = 'mt-3 text-5xl font-semibold text-rose-300';
    healthSummaryEl.textContent = error.message;
    healthLevelEl.textContent = 'Error';
    healthLevelEl.className = 'rounded-md border border-rose-400/20 bg-rose-400/10 px-3 py-1 text-xs text-rose-300';
  }
}

async function loadSetupStatus() {
  setupSummaryEl.textContent = '正在检查环境...';
  try {
    const response = await authFetch('/api/setup/status');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '首次启动向导读取失败。');

    setupSummaryEl.textContent = data.ok ? '启动环境已就绪' : `${data.passed}/${data.required} 项通过`;
    setupSummaryEl.className = `mt-3 text-2xl font-semibold ${data.ok ? 'text-emerald-300' : 'text-amber-300'}`;
    setupUpdatedEl.textContent = data.remoteMode
      ? `当前为局域网监听 ${data.host}:${data.port}，请只在可信网络使用。`
      : `本机安全模式 ${data.host}:${data.port} · ${new Date(data.collectedAt).toLocaleString()}`;
    setupListEl.innerHTML = renderMiniRows(data.checks || []);
  } catch (error) {
    setupSummaryEl.textContent = '环境检查失败';
    setupSummaryEl.className = 'mt-3 text-2xl font-semibold text-rose-300';
    setupUpdatedEl.textContent = error.message;
  }
}

async function loadAssurance() {
  assuranceSummaryEl.textContent = '正在体检...';
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
    assuranceSummaryEl.textContent = attention ? `发现 ${attention} 项需要关注` : '系统保障项正常';
    assuranceSummaryEl.className = `mt-3 text-2xl font-semibold ${attention ? 'text-amber-300' : 'text-emerald-300'}`;
    assuranceUpdatedEl.textContent = '体检于 ' + new Date().toLocaleString();

    renderStatusPill(compatibilityPillEl, compatibility.ok, `${compatibility.passed}/${compatibility.required}`);
    compatibilityListEl.innerHTML = renderMiniRows((compatibility.checks || []).slice(0, 6).map((check) => ({
      name: check.name,
      ok: check.ok,
      detail: check.ok ? check.command : (check.error || check.command),
    })));

    renderStatusPill(preflightPillEl, preflight.ok, preflight.updateAvailable ? '可升级' : '无更新');
    preflightListEl.innerHTML = renderMiniRows(preflight.checks || []);

    versionSourcesListEl.innerHTML = renderMiniRows((versionSources.sources || []).map((source) => ({
      name: `${source.name}${source.latestVersion ? ' · ' + source.latestVersion : ''}`,
      ok: source.ok,
      detail: source.ok ? source.status : source.detail,
    })));

          configHealthListEl.innerHTML = renderMiniRows((configHealth.channels || []).map((channel) => ({
            name: `${channel.channel} · ${channel.enabled ? 'enabled' : 'disabled'}`,
            ok: channel.enabled,
            detail: `allowFrom ${channel.allowFromCount}, group ${channel.groupAllowFromCount}, blockStreaming ${channel.blockStreamingConfigured ? channel.blockStreaming : '未配置'}`,
          })));

    logRulesPillEl.textContent = `${logRules.activeCount || 0} 条启用`;
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
    assuranceSummaryEl.textContent = '体检失败';
    assuranceSummaryEl.className = 'mt-3 text-2xl font-semibold text-rose-300';
    assuranceUpdatedEl.textContent = error.message;
  }
}

function renderOfficialDashboard(data) {
  const reachable = Boolean(data.reachable);
  officialDashboardSummaryEl.textContent = reachable ? '官方 Dashboard 可达' : '官方 Dashboard 未响应';
  officialDashboardSummaryEl.className = `mt-3 text-2xl font-semibold ${reachable ? 'text-emerald-300' : 'text-amber-300'}`;
  officialDashboardDetailEl.textContent = data.recommendation || '官方 Control UI 状态已刷新。';
  officialDashboardLinkEl.href = data.url || 'http://127.0.0.1:18789/';
  officialDashboardLinkEl.className = 'self-start rounded-md px-4 py-2 text-sm font-semibold text-white transition ' + (
    reachable ? 'bg-emerald-500 hover:bg-emerald-400' : 'bg-zinc-700 hover:bg-zinc-600'
  );

  const authText = data.auth?.configured
    ? `已配置${data.auth.mode ? ' · ' + data.auth.mode : ''}`
    : '未检测到显式配置';
  officialDashboardFactsEl.innerHTML = [
    { name: '访问地址', ok: reachable, detail: data.url || '-' },
    { name: 'HTTP 状态', ok: reachable, detail: data.httpStatus || data.error || '-' },
    { name: 'Gateway Auth', ok: data.auth?.configured, detail: authText },
  ].map((item) => `<div class="rounded-md border border-white/10 bg-zinc-950/40 px-4 py-3">
    <p class="text-zinc-600">${escapeHtml(item.name)}</p>
    <p class="mt-1 break-all font-semibold ${item.ok ? 'text-emerald-300' : 'text-amber-300'}">${escapeHtml(item.detail)}</p>
  </div>`).join('');
}

function renderTroubleshooting(data) {
  const steps = data.steps || [];
  const warningCount = steps.filter((step) => ['critical', 'warning'].includes(step.level)).length;
  troubleshootingSummaryEl.textContent = warningCount ? `${warningCount} 条优先排查` : '排障路径清晰';
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
    officialDashboardSummaryEl.textContent = '检测失败';
    officialDashboardSummaryEl.className = 'mt-3 text-2xl font-semibold text-rose-300';
    officialDashboardDetailEl.textContent = error.message;
  }
}

async function loadTroubleshooting() {
  troubleshootingSummaryEl.textContent = '正在分析...';
  try {
    const response = await authFetch('/api/troubleshooting');
    const data = await response.json();
    renderTroubleshooting(data);
    if (data.officialDashboard) renderOfficialDashboard(data.officialDashboard);
  } catch (error) {
    troubleshootingSummaryEl.textContent = '分析失败';
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
    alert('日志降噪规则更新失败：' + error.message);
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
    channelsUpdatedAtEl.textContent = `更新于 ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    renderChannels([]);
    channelsUpdatedAtEl.textContent = '刷新失败';
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
      controlMessageEl.textContent = '无法读取 Gateway 运行状态。';
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
    modelCurrentEl.textContent = '未检测到模型';
    modelSourceEl.textContent = '未能从 OpenClaw 配置或日志中读取模型。';
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
  modelReasoningEl.textContent = model.reasoning == null ? '-' : model.reasoning ? '支持' : '不支持';

  const sourceText = model.source === 'gateway.log' ? '网关日志确认' : '配置文件';
  modelSourceEl.textContent = model.lastSeenAt
    ? `${sourceText} · ${new Date(model.lastSeenAt).toLocaleString()}`
    : `${sourceText} · 当前默认模型`;
  modelFallbacksEl.textContent = Array.isArray(model.fallbacks) && model.fallbacks.length
    ? `Fallbacks: ${model.fallbacks.join(' / ')}`
    : '';
}

function diagnosticTone(ok, warning) {
  if (ok) return { text: '正常', dot: 'bg-emerald-500', textClass: 'text-emerald-300', border: 'border-emerald-400/15' };
  if (warning) return { text: '异常', dot: 'bg-amber-500', textClass: 'text-amber-300', border: 'border-amber-400/15' };
  return { text: '异常', dot: 'bg-rose-500', textClass: 'text-rose-300', border: 'border-rose-400/15' };
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
    ? '核心链路基本正常'
    : `发现 ${3 - criticalCount} 项需要关注`;
  diagnosticsSummaryEl.className = `mt-3 text-2xl font-semibold ${gatewayOk && feishuDirectOk && telegramOk ? 'text-emerald-300' : 'text-amber-300'}`;
  diagnosticsUpdatedEl.textContent = data.collectedAt
    ? '自检于 ' + new Date(data.collectedAt).toLocaleString()
    : '自检完成';

  diagnosticsCardsEl.innerHTML = [
    renderDiagnosticCard('Gateway', gatewayOk ? 'Running' : 'Stopped', gatewayOk ? `${(data.gateway.processes || []).length} 个进程` : '未检测到 Gateway 进程', diagnosticTone(gatewayOk)),
    renderDiagnosticCard('飞书 API 直连', feishuDirectOk ? 'OK' : 'Failed', feishuDirectOk ? `Bot ${data.feishuDirect?.botName || data.feishuDirect?.botOpenId || '已验证'}` : (data.feishuDirect?.error || '直连失败'), diagnosticTone(feishuDirectOk)),
    renderDiagnosticCard('飞书 Gateway 探针', feishuGatewayOk ? 'OK' : 'Failed', feishuGatewayOk ? 'OpenClaw 通道探针通过' : (feishuProbe.error || data.channels?.detail?.feishu?.reason || '探针失败'), diagnosticTone(feishuGatewayOk, feishuDirectOk && !feishuGatewayOk)),
    renderDiagnosticCard('Telegram 探针', telegramOk ? 'OK' : 'Failed', telegramOk ? 'Telegram bot 探针通过' : (telegramProbe.error || data.channels?.detail?.telegram?.reason || '探针失败'), diagnosticTone(telegramOk)),
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
    diagnosticsSummaryEl.textContent = '诊断读取失败';
    diagnosticsSummaryEl.className = 'mt-3 text-2xl font-semibold text-rose-300';
    diagnosticsUpdatedEl.textContent = '无法连接后端诊断接口。';
  }
}

async function runDiagnosticsProbe() {
  diagnosticsProbeBtn.disabled = true;
  postUpdateProbeBtn.disabled = true;
  diagnosticsProbeBtn.textContent = '自检中...';
  try {
    const response = await authFetch('/api/diagnostics/probe', { method: 'POST' });
    const data = await response.json();
    renderDiagnostics(data);
    loadAudit();
    loadTimeline();
  } catch (error) {
    diagnosticsSummaryEl.textContent = '自检失败';
    diagnosticsSummaryEl.className = 'mt-3 text-2xl font-semibold text-rose-300';
    diagnosticsUpdatedEl.textContent = '诊断接口执行失败。';
  } finally {
    diagnosticsProbeBtn.disabled = false;
    postUpdateProbeBtn.disabled = false;
    diagnosticsProbeBtn.textContent = '立即自检';
  }
}

async function verifyChannel(channel) {
  const label = channel === 'feishu' ? '飞书' : 'Telegram';
  if (!window.confirm(`确认向${label}发送一条测试消息？`)) return;

  channelVerifyButtons.forEach((button) => { button.disabled = true; });
  channelVerifyMessageEl.textContent = `正在执行${label}真实验证...`;
  try {
    const response = await authFetch('/api/channels/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, confirm: true }),
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || '验证失败。');
      channelVerifyMessageEl.textContent = `${label}测试消息已发送。${data.received ? 'Gateway 最近活动正常。' : '但 Gateway 最近活动仍未确认，请观察回复是否到达。'}`;
      loadChannels();
      loadDiagnostics();
    loadTimeline();
    loadAudit();
  } catch (error) {
    channelVerifyMessageEl.textContent = `${label}真实验证失败：${error.message}`;
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
      timelineListEl.innerHTML = '<p class="text-sm text-zinc-500">暂无事件。</p>';
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
    timelineUpdatedEl.textContent = '更新于 ' + new Date().toLocaleTimeString();
  } catch (error) {
    timelineListEl.innerHTML = '<p class="text-sm text-zinc-500">读取时间线失败。</p>';
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
    errorsUpdatedEl.textContent = '更新于 ' + new Date().toLocaleTimeString();
  } catch (error) {
    errorsEmptyEl.classList.add('hidden');
    errorsListEl.innerHTML = '<p class="text-sm text-zinc-500">读取错误日志失败。</p>';
  }
}

let lastErrorsData = [];
function copyErrors() {
  if (!lastErrorsData || lastErrorsData.length === 0) { alert('暂无错误日志可复制'); return; }
  const text = lastErrorsData.map(err => {
    const ts = err.timestamp ? new Date(err.timestamp).toLocaleString() : '-';
    return `[${ts}] [${err.source || '?'}] ${err.message}`;
  }).join('\n');
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.querySelector('button[onclick="copyErrors()"]');
    if (btn) { const orig = btn.textContent; btn.textContent = '已复制'; setTimeout(() => btn.textContent = orig, 1500); }
  }).catch(() => alert('复制失败'));
}

async function loadAudit() {
  try {
    const response = await authFetch('/api/audit');
    const data = await response.json();
    const entries = data.entries || [];

    if (!entries.length) {
      auditListEl.innerHTML = '<p class="text-zinc-500">暂无操作记录。</p>';
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
          <span class="${okClass}">${entry.success ? '成功' : '失败'}</span>
        </div>`;
      }).join('');
    }

    auditUpdatedEl.textContent = '更新于 ' + new Date().toLocaleTimeString();
  } catch (error) {
    auditListEl.innerHTML = '<p class="text-zinc-500">读取操作审计失败。</p>';
  }
}

async function handleControlClick(event) {
  const action = event.currentTarget.dataset.action;

  isControlRequestActive = true;
  setControlButtonsDisabled(true, action);
  controlMessageEl.textContent = `正在执行 ${actionLabels[action]} 操作，请稍候。`;

  try {
    const response = await authFetch('/api/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const data = await response.json();

    controlMessageEl.textContent = data.message || `${actionLabels[action]} 指令已发送。`;

    if (!response.ok || !data.success) {
      controlMessageEl.textContent = data.detail || data.message || `${actionLabels[action]} 指令执行失败。`;
    }
  } catch (error) {
    controlMessageEl.textContent = '无法连接后端服务，控制指令发送失败。';
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
        localMessageEl.textContent = '本地版本检查完成。';
      }
      if (data.version.latest) {
        latestVersionEl.textContent = data.version.latest;
        latestMessageEl.textContent = data.version.publishedAt
          ? '发布时间：' + new Date(data.version.publishedAt).toLocaleString()
          : `版本源：${compactVersionSource(data.version.source)}`;
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
      diskUpdatedAtEl.textContent = '更新于 ' + new Date().toLocaleTimeString();
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
      memoryUpdatedAtEl.textContent = '更新于 ' + new Date().toLocaleTimeString();

      // Process list
      const procListEl = document.getElementById('memory-processes-list');
      if (data.memoryProcesses && data.memoryProcesses.length > 0) {
        procListEl.innerHTML = data.memoryProcesses.map((p) => {
          const name = escapeHtml(p.name);
          const user = escapeHtml(p.user);
          const memMb = escapeHtml(p.memMb);

          return `<div class="grid gap-3 rounded-md border border-white/5 bg-white/[0.025] px-4 py-3 sm:grid-cols-[minmax(0,1fr)_180px] sm:items-center">
            <div class="min-w-0">
              <p class="truncate font-medium text-zinc-300" title="${name}">${name}${p.count > 1 ? ' <span class="text-xs font-normal text-zinc-500">×' + p.count + '</span>' : ''}</p>
            </div>
            <div class="flex items-center justify-between gap-3 sm:flex-col sm:items-end sm:gap-1">
              <span class="rounded-md bg-white/[0.04] px-2.5 py-1 text-xs text-zinc-500">${user}</span>
              <span class="font-mono text-sm font-semibold text-amber-300">${memMb} MB</span>
            </div>
          </div>`
        }).join('');
      } else {
        procListEl.innerHTML = '<div class="px-4 py-3 text-zinc-600">无可用数据</div>';
      }
    }
  } catch (error) {
    // silent fail
  }
}

async function doUpdate() {
  if (!window.confirm('确认现在更新 OpenClaw？更新期间 Gateway 会短暂停止并自动重启。')) {
    return;
  }

  updateBtnEl.disabled = true;
  updateBtnEl.textContent = '更新中...';
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
      updateBtnEl.textContent = '更新系统';
      alert(data.message || '更新任务启动失败。');
      return;
    }

    renderUpdateJob(data.job);
    startUpdatePolling();
  } catch (error) {
    alert('更新请求失败：' + error.message);
    updateBtnEl.disabled = false;
    updateBtnEl.textContent = '更新系统';
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
      ? `实时更新于 ${new Date(snapshot.collectedAt).toLocaleTimeString()}`
      : `实时更新于 ${new Date().toLocaleTimeString()}`;
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
      if (payload.type === 'error') showApiError('实时状态推送异常', payload.message);
    } catch (error) {
      showApiError('实时状态解析失败', error.message);
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
      showLogin('请使用访问口令登录管理看板。');
      return;
    }
  } catch {
    showLogin('无法连接后端服务。');
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
