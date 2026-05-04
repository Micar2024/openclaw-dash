const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

function ensureParentDir (filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readTail (filePath, lines = 200) {
  return new Promise((resolve) => {
    const safeLines = Math.max(1, Math.min(Number(lines) || 200, 20000));
    execFile('tail', ['-n', String(safeLines), filePath], { timeout: 5000 }, (err, stdout) => {
      resolve(err || !stdout ? '' : stdout);
    });
  });
}

function readJsonFile (filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function parseDateMs (value) {
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function isFreshTimestamp (value, maxAgeMs) {
  const ms = parseDateMs(value);
  return ms != null && Date.now() - ms <= maxAgeMs;
}

function getDiskInfo () {
  return new Promise((resolve) => {
    execFile('df', ['-k', os.homedir()], { timeout: 3000 }, (err, stdout) => {
      if (err || !stdout.trim()) {
        resolve({ freeGb: null, usedPercent: null });
        return;
      }

      const parts = stdout.trim().split('\n')[1]?.split(/\s+/) || [];
      const availKb = parseInt(parts[3], 10);
      const usedPct = parts[4] ? parseInt(parts[4], 10) : null;
      resolve({
        freeGb: Number.isFinite(availKb) ? Number((availKb / 1048576).toFixed(1)) : null,
        usedPercent: usedPct
      });
    });
  });
}

function getProcessResourceInfo (pid) {
  return new Promise((resolve) => {
    execFile('ps', ['-p', String(pid), '-o', 'etime=,rss='], { timeout: 3000 }, (err, stdout) => {
      if (err || !stdout.trim()) {
        resolve(null);
        return;
      }

      const parts = stdout.trim().split(/\s+/);
      resolve({ etime: parts[0] || null, rssKb: parseInt(parts[1], 10) || null });
    });
  });
}

module.exports = {
  ensureParentDir,
  getDiskInfo,
  getProcessResourceInfo,
  isFreshTimestamp,
  parseDateMs,
  readJsonFile,
  readTail
};
