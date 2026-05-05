const os = require('os');
const { execFile } = require('child_process');
const { getDiskInfo, getProcessResourceInfo } = require('./runtime');
const { getTopMemoryProcesses } = require('./processes');

function parseElapsedSeconds (etime) {
  if (!etime) return null;
  const parts = etime.split('-');
  let timePart = etime;
  let days = 0;
  if (parts.length > 1) {
    days = parseInt(parts[0], 10) || 0;
    timePart = parts[1];
  }
  const tparts = timePart.split(':').map(Number);
  let secs = days * 86400;
  if (tparts.length === 3) secs += tparts[0] * 3600 + tparts[1] * 60 + tparts[2];
  else if (tparts.length === 2) secs += tparts[0] * 60 + tparts[1];
  return secs;
}

function getMemoryInfo () {
  return new Promise((resolve) => {
    execFile('vm_stat', [], { timeout: 5000 }, (err, stdout) => {
      if (err) {
        const totalBytes = os.totalmem();
        const freeBytes = os.freemem();
        resolve({
          totalGb: (totalBytes / 1024 / 1024 / 1024).toFixed(1),
          freeGb: (freeBytes / 1024 / 1024 / 1024).toFixed(1),
          usedGb: ((totalBytes - freeBytes) / 1024 / 1024 / 1024).toFixed(1),
          usedPercent: Math.round(((totalBytes - freeBytes) / totalBytes) * 100),
          reclaimableGb: '0.0',
          source: 'freemem'
        });
        return;
      }

      const stats = {};
      for (const line of stdout.split('\n')) {
        const match = line.match(/^\s*(.+?):\s*(\d+)\./);
        if (match) stats[match[1].trim()] = parseInt(match[2], 10) || 0;
      }

      const pagesize = 16384;
      const freePages = stats['Pages free'] || 0;
      const activePages = stats['Pages active'] || 0;
      const inactivePages = stats['Pages inactive'] || 0;
      const speculativePages = stats['Pages speculative'] || 0;
      const wiredPages = stats['Pages wired down'] || 0;
      const compressedPages = stats['Pages occupied by compressor'] || 0;
      const totalBytes = os.totalmem();
      const trulyFreeBytes = freePages * pagesize;
      const reclaimableBytes = (inactivePages + speculativePages) * pagesize;
      const appUsedBytes = activePages * pagesize;
      const compressedBytes = compressedPages * pagesize;

      resolve({
        totalGb: (totalBytes / 1024 / 1024 / 1024).toFixed(1),
        freeGb: (trulyFreeBytes / 1024 / 1024 / 1024).toFixed(1),
        reclaimableGb: (reclaimableBytes / 1024 / 1024 / 1024).toFixed(1),
        usedGb: (appUsedBytes / 1024 / 1024 / 1024).toFixed(1),
        usedPercent: Math.round((appUsedBytes / totalBytes) * 100),
        activeGb: (activePages * pagesize / 1024 / 1024 / 1024).toFixed(1),
        compressedGb: (compressedBytes / 1024 / 1024 / 1024).toFixed(1),
        wiredGb: (wiredPages * pagesize / 1024 / 1024 / 1024).toFixed(1),
        source: 'vm_stat'
      });
    });
  });
}

function createMetricsService (deps) {
  async function buildMetrics () {
    const processes = await deps.getGatewayProcesses();
    const gwProc = processes[0] || null;
    const gateway = { pid: null, isRunning: processes.length > 0, uptime: null, uptimeSeconds: null, memoryRssMb: null, command: null };

    if (gwProc) {
      gateway.pid = gwProc.pid;
      gateway.command = gwProc.command;
      try {
        const psInfo = await getProcessResourceInfo(gwProc.pid);
        if (psInfo) {
          gateway.uptime = psInfo.etime;
          gateway.memoryRssMb = psInfo.rssKb ? Math.round(psInfo.rssKb / 1024) : null;
          gateway.uptimeSeconds = parseElapsedSeconds(psInfo.etime);
        }
      } catch {}
    }

    const channelProbe = await deps.getCachedOpenClawChannelProbe();
    const [feishuHealth, telegramHealth, feishuStats, telegramStats] = await Promise.all([
      deps.getChannelHealth('feishu', channelProbe),
      deps.getChannelHealth('telegram', channelProbe),
      deps.getChannelMessageStats('feishu'),
      deps.getChannelMessageStats('telegram')
    ]);
    const channels = {
      feishu: { ...feishuHealth, stats: feishuStats },
      telegram: { ...telegramHealth, stats: telegramStats }
    };
    const disk = await getDiskInfo();
    const [localVersion, latestRelease, model, memory, memoryProcesses] = await Promise.all([
      deps.getLocalVersion(),
      deps.getLatestReleaseInfo(),
      deps.getCurrentModelInfo(),
      getMemoryInfo(),
      getTopMemoryProcesses()
    ]);
    const updateAvailable = Boolean(deps.parseVersion(localVersion) && deps.parseVersion(latestRelease.latestVersion) && deps.isVersionGreater(latestRelease.latestVersion, localVersion));

    return {
      gateway,
      channels,
      disk,
      memory,
      memoryProcesses,
      version: {
        local: localVersion,
        latest: latestRelease.latestVersion,
        updateAvailable,
        releaseUrl: latestRelease.releaseUrl,
        publishedAt: latestRelease.publishedAt,
        source: latestRelease.source
      },
      model,
      collectedAt: new Date().toISOString()
    };
  }

  return { buildMetrics };
}

module.exports = { createMetricsService };
