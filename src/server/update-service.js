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
    message: 'No update job.',
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
    job.message = 'Dashboard restarted; the previous update status could not be confirmed.';
    job.postUpdateDiagnostics = null;
    job.steps = [...job.steps, {
      name: 'Dashboard Restarted',
      status: 'warning',
      detail: 'The dashboard process restarted during the update job, so completion cannot be confirmed. Please run the post-update check manually.',
      timestamp: job.finishedAt
    }];
  }

  const diagnosticsAt = parseDateMs(job.postUpdateDiagnostics?.collectedAt);
  const finishedAt = parseDateMs(job.finishedAt);
  if (job.postUpdateDiagnostics && (!diagnosticsAt || (finishedAt && diagnosticsAt < finishedAt))) {
    job.postUpdateDiagnostics = null;
    job.steps = [...job.steps, {
      name: 'Post-check Result Expired',
      status: 'warning',
      detail: 'The persisted post-update check is older than the job finish time and was ignored. Please rerun the post-update check.',
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
        resolve({ success: true, output, data: { message: output.trim() || 'openclaw update completed.' } });
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
      console.error('[UpdateJob] Failed to persist status:', error.message);
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
      message: 'Update job started.',
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
      addUpdateStep('Stop Gateway', 'running');
      if (shouldRestartGateway) {
        await deps.runGatewayControl('stop');
        addUpdateStep('Stop Gateway', 'success', 'Gateway stopped.');
      } else {
        addUpdateStep('Stop Gateway', 'skipped', 'Gateway was already stopped; stop step skipped.');
      }

      addUpdateStep('Update OpenClaw', 'running');
      const updateResult = await execOpenClawUpdate();
      addUpdateStep('Update OpenClaw', 'success', updateResult.output || updateResult.data?.message || 'Update command completed.');

      addUpdateStep('Run doctor', 'running');
      try {
        const doctorResult = await runDoctor();
        addUpdateStep('Run doctor', doctorResult.ok ? 'success' : 'warning', doctorResult.output);
      } catch (error) {
        addUpdateStep('Run doctor', 'warning', error.message);
      }

      addUpdateStep('Restart Gateway', 'running');
      if (shouldRestartGateway) {
        await deps.runGatewayControl('start');
        addUpdateStep('Restart Gateway', 'success', 'Gateway is running again.');
      } else {
        addUpdateStep('Restart Gateway', 'skipped', 'Gateway was not running before the update and remains stopped.');
      }

      addUpdateStep('Post-update Check', 'running');
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
        addUpdateStep('Post-update Check', hasWarning ? 'warning' : 'success', diagnostics.recommendations?.map((item) => `${item.title}: ${item.detail}`).join('\n') || 'Post-update check completed.');
      } catch (error) {
        addUpdateStep('Post-update Check', 'warning', error.message);
      }

      finishUpdateJob('success', 'OpenClaw update workflow completed.');
      deps.appendAudit(req, 'update', true, { jobId: updateJob.id, restartedGateway: shouldRestartGateway });
    } catch (error) {
      addUpdateStep('Update Failed', 'error', error.message);
      finishUpdateJob('error', 'OpenClaw update workflow failed.', error.message);
      deps.appendAudit(req, 'update', false, { jobId: updateJob.id, error: error.message });
    }
  }

  async function buildUpdatePreflight () {
    const [gatewayProcesses, disk, localVersion, latestRelease, compatibility, diagnostics] = await Promise.all([
      deps.getGatewayProcesses().catch(() => []),
      getDiskInfo().catch(() => ({ freeGb: null, usedPercent: null })),
      deps.getLocalVersion().catch(() => null),
      deps.getLatestReleaseInfo().catch(() => ({ latestVersion: null, releaseUrl: null, source: null })),
      deps.buildCompatibilityReport().catch(() => ({ ok: false, passed: 0, required: 1, checks: [] })),
      deps.buildDiagnostics().catch(() => ({ openclawProbe: {}, recommendations: [] }))
    ]);
    disk.ok = disk.freeGb == null ? false : disk.freeGb >= 2;
    const updateAvailable = Boolean(deps.parseVersion(localVersion) && deps.parseVersion(latestRelease.latestVersion) && deps.isVersionGreater(latestRelease.latestVersion, localVersion));
    const probeChannels = Object.entries(diagnostics.openclawProbe?.channels || {}).map(([name, channel]) => ({
      name: `${name} Probe`,
      ok: Boolean(channel?.probe?.ok || channel?.connected || channel?.running),
      detail: channel?.probe?.error || channel?.lastError || 'OK'
    }));
    const checks = [
      { name: 'Version Diff', ok: updateAvailable, detail: updateAvailable ? `${localVersion} → ${latestRelease.latestVersion}` : 'No available update detected.' },
      { name: 'Disk Space', ok: disk.ok, detail: disk.freeGb == null ? 'Unable to read disk space.' : `Free ${disk.freeGb} GB, used ${disk.usedPercent}%` },
      { name: 'Gateway State', ok: true, detail: gatewayProcesses.length ? `Currently running; update will stop and restore it. PID ${gatewayProcesses[0].pid}` : 'Currently stopped; it will remain stopped after updating.' },
      { name: 'CLI Compatibility', ok: compatibility.ok, detail: `${compatibility.passed}/${compatibility.required} checks passed` },
      ...(probeChannels.length ? probeChannels : [{ name: 'Channel Probe', ok: false, detail: diagnostics.openclawProbe?.error || 'No channel probe result detected.' }])
    ];
    return {
      ok: checks.every((check) => check.ok || check.name === 'Gateway State'),
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
