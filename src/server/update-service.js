const fs = require('fs');
const { execFile } = require('child_process');
const {
  DASHBOARD_PATH,
  OPENCLAW_BIN,
  UPDATE_JOB_PATH,
  UPDATE_OUTPUT_TAIL_CHARS
} = require('./config');
const { ensureParentDir, getDiskInfo, parseDateMs, readJsonFile } = require('./runtime');

function createDefaultUpdateJob () {
  return {
    id: null,
    running: false,
    status: 'idle',
    startedAt: null,
    finishedAt: null,
    steps: [],
    message: '暂无更新任务。',
    error: null,
    postUpdateDiagnostics: null
  };
}

function loadPersistedUpdateJob () {
  const saved = readJsonFile(UPDATE_JOB_PATH);
  if (!saved || typeof saved !== 'object') return createDefaultUpdateJob();

  const job = { ...createDefaultUpdateJob(), ...saved, steps: Array.isArray(saved.steps) ? saved.steps : [] };
  if (job.running) {
    job.running = false;
    job.status = 'error';
    job.finishedAt = new Date().toISOString();
    job.message = '看板服务重启，上一轮更新状态未能确认。';
    job.postUpdateDiagnostics = null;
    job.steps = [...job.steps, {
      name: '看板服务重启',
      status: 'warning',
      detail: '更新任务运行期间 dashboard 进程重启，无法确认该任务是否完整结束。请手动运行升级后复检。',
      timestamp: job.finishedAt
    }];
  }

  const diagnosticsAt = parseDateMs(job.postUpdateDiagnostics?.collectedAt);
  const finishedAt = parseDateMs(job.finishedAt);
  if (job.postUpdateDiagnostics && (!diagnosticsAt || (finishedAt && diagnosticsAt < finishedAt))) {
    job.postUpdateDiagnostics = null;
    job.steps = [...job.steps, {
      name: '复检结果已失效',
      status: 'warning',
      detail: '持久化的升级后复检时间早于任务结束时间，已忽略旧结果。请重新运行升级后复检。',
      timestamp: new Date().toISOString()
    }];
  }
  return job;
}

function sanitizeOutput (text) {
  return String(text || '').slice(-UPDATE_OUTPUT_TAIL_CHARS);
}

function execOpenClawUpdate () {
  return new Promise((resolve, reject) => {
    execFile(OPENCLAW_BIN, ['update', '--yes', '--json', '--no-restart'], {
      env: { ...process.env, PATH: DASHBOARD_PATH },
      timeout: 300000
    }, (error, stdout, stderr) => {
      const output = `${stdout || ''}${stderr || ''}`;
      if (error && !stdout.trim()) {
        reject(new Error((stderr || error.message).trim()));
        return;
      }

      try {
        resolve({ success: true, output, data: JSON.parse(stdout.trim()) });
      } catch {
        resolve({ success: true, output, data: { message: output.trim() || 'openclaw update 已执行。' } });
      }
    });
  });
}

function runDoctor () {
  return new Promise((resolve) => {
    execFile(OPENCLAW_BIN, ['doctor'], { env: { ...process.env, PATH: DASHBOARD_PATH }, timeout: 60000 }, (error, stdout, stderr) => {
      resolve({ ok: !error, output: `${stdout || ''}${stderr || error?.message || ''}` });
    });
  });
}

function createUpdateService (deps) {
  let updateJob = loadPersistedUpdateJob();

  function persistUpdateJob () {
    try {
      ensureParentDir(UPDATE_JOB_PATH);
      fs.writeFileSync(UPDATE_JOB_PATH, `${JSON.stringify(updateJob, null, 2)}\n`, { mode: 0o600 });
    } catch (error) {
      console.error('[UpdateJob] 状态持久化失败:', error.message);
    }
  }

  function resetUpdateJob () {
    updateJob = {
      id: `update-${Date.now()}`,
      running: true,
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      steps: [],
      message: '更新任务已开始。',
      error: null,
      postUpdateDiagnostics: null
    };
    persistUpdateJob();
    return updateJob;
  }

  function getUpdateJob () {
    return updateJob;
  }

  function addUpdateStep (name, status, detail = '') {
    updateJob.steps.push({
      name,
      status,
      detail: sanitizeOutput(detail),
      timestamp: new Date().toISOString()
    });
    persistUpdateJob();
  }

  function finishUpdateJob (status, message, error = null) {
    updateJob.running = false;
    updateJob.status = status;
    updateJob.message = message;
    updateJob.error = error ? String(error).slice(0, 1200) : null;
    updateJob.finishedAt = new Date().toISOString();
    persistUpdateJob();
  }

  async function runUpdateJob (req, shouldRestartGateway) {
    try {
      addUpdateStep('停止 Gateway', 'running');
      if (shouldRestartGateway) {
        await deps.runGatewayControl('stop');
        addUpdateStep('停止 Gateway', 'success', 'Gateway 已停止。');
      } else {
        addUpdateStep('停止 Gateway', 'skipped', 'Gateway 原本未运行，跳过停止步骤。');
      }

      addUpdateStep('更新 OpenClaw', 'running');
      const updateResult = await execOpenClawUpdate();
      addUpdateStep('更新 OpenClaw', 'success', updateResult.output || updateResult.data?.message || '更新命令执行完成。');

      addUpdateStep('运行 doctor', 'running');
      try {
        const doctorResult = await runDoctor();
        addUpdateStep('运行 doctor', doctorResult.ok ? 'success' : 'warning', doctorResult.output);
      } catch (error) {
        addUpdateStep('运行 doctor', 'warning', error.message);
      }

      addUpdateStep('重启 Gateway', 'running');
      if (shouldRestartGateway) {
        await deps.runGatewayControl('start');
        addUpdateStep('重启 Gateway', 'success', 'Gateway 已恢复运行。');
      } else {
        addUpdateStep('重启 Gateway', 'skipped', 'Gateway 更新前未运行，保持停止状态。');
      }

      addUpdateStep('升级后复检', 'running');
      try {
        const diagnostics = await deps.buildDiagnostics();
        updateJob.postUpdateDiagnostics = {
          collectedAt: diagnostics.collectedAt,
          gatewayRunning: diagnostics.gateway.isRunning,
          feishuDirectOk: diagnostics.feishuDirect?.ok,
          feishuProbeOk: diagnostics.openclawProbe?.channels?.feishu?.probe?.ok,
          telegramProbeOk: diagnostics.openclawProbe?.channels?.telegram?.probe?.ok,
          recommendations: diagnostics.recommendations
        };
        persistUpdateJob();
        const hasWarning = diagnostics.recommendations?.some((item) => item.level === 'warning' || item.level === 'critical');
        addUpdateStep('升级后复检', hasWarning ? 'warning' : 'success', diagnostics.recommendations?.map((item) => `${item.title}: ${item.detail}`).join('\n') || '复检完成。');
      } catch (error) {
        addUpdateStep('升级后复检', 'warning', error.message);
      }

      finishUpdateJob('success', 'OpenClaw 更新流程已完成。');
      deps.appendAudit(req, 'update', true, { jobId: updateJob.id, restartedGateway: shouldRestartGateway });
    } catch (error) {
      addUpdateStep('更新失败', 'error', error.message);
      finishUpdateJob('error', 'OpenClaw 更新流程失败。', error.message);
      deps.appendAudit(req, 'update', false, { jobId: updateJob.id, error: error.message });
    }
  }

  async function buildUpdatePreflight () {
    const [gatewayProcesses, disk, localVersion, latestRelease, compatibility, diagnostics] = await Promise.all([
      deps.getGatewayProcesses(),
      getDiskInfo(),
      deps.getLocalVersion(),
      deps.getLatestReleaseInfo(),
      deps.buildCompatibilityReport(),
      deps.buildDiagnostics()
    ]);
    disk.ok = disk.freeGb == null ? false : disk.freeGb >= 2;
    const updateAvailable = Boolean(deps.parseVersion(localVersion) && deps.parseVersion(latestRelease.latestVersion) && deps.isVersionGreater(latestRelease.latestVersion, localVersion));
    const probeChannels = Object.entries(diagnostics.openclawProbe?.channels || {}).map(([name, channel]) => ({
      name: `${name} 探针`,
      ok: Boolean(channel?.probe?.ok || channel?.connected || channel?.running),
      detail: channel?.probe?.error || channel?.lastError || 'OK'
    }));
    const checks = [
      { name: '版本差异', ok: updateAvailable, detail: updateAvailable ? `${localVersion} → ${latestRelease.latestVersion}` : '当前未检测到可用更新。' },
      { name: '磁盘空间', ok: disk.ok, detail: disk.freeGb == null ? '无法读取磁盘空间。' : `可用 ${disk.freeGb} GB，已用 ${disk.usedPercent}%` },
      { name: 'Gateway 状态', ok: true, detail: gatewayProcesses.length ? `当前运行中，升级会先停止再恢复。PID ${gatewayProcesses[0].pid}` : '当前未运行，升级后会保持停止状态。' },
      { name: 'CLI 兼容性', ok: compatibility.ok, detail: `${compatibility.passed}/${compatibility.required} 项通过` },
      ...(probeChannels.length ? probeChannels : [{ name: '通道探针', ok: false, detail: diagnostics.openclawProbe?.error || '未检测到通道探针结果。' }])
    ];
    return {
      ok: checks.every((check) => check.ok || check.name === 'Gateway 状态'),
      localVersion,
      latestVersion: latestRelease.latestVersion,
      updateAvailable,
      checks,
      collectedAt: new Date().toISOString()
    };
  }

  return {
    buildUpdatePreflight,
    getUpdateJob,
    resetUpdateJob,
    runUpdateJob
  };
}

module.exports = { createUpdateService };
