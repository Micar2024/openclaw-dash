const fs = require('fs');
const { execFile } = require('child_process');
const {
  DASHBOARD_PATH,
  OPENCLAW_BIN
} = require('./config');

function createGatewayService () {
  let wasRunning = null;

  function getGatewayProcesses () {
    return new Promise((resolve) => {
      execFile('ps', ['ax', '-o', 'pid=,command='], { timeout: 5000 }, (error, stdout) => {
        if (error || !stdout.trim()) { resolve([]); return; }
        const processes = stdout.split(/\r?\n/)
          .map((line) => {
            const match = line.trim().match(/^(\d+)\s+(.+)$/);
            return match ? { pid: Number(match[1]), command: match[2] } : null;
          })
          .filter(Boolean)
          .filter(({ pid, command }) => {
            const cmd = command.toLowerCase();
            return pid !== process.pid && (/\/openclaw\/dist\/index\.js\s+gateway\b/.test(cmd) || /\/openclaw(?:\.mjs)?\s+gateway\b/.test(cmd));
          });
        resolve(processes);
      });
    });
  }

  function checkGatewayStatus () {
    return getGatewayProcesses().then((processes) => processes.length > 0);
  }

  function assertOpenClawAvailable () {
    return new Promise((resolve, reject) => {
      fs.access(OPENCLAW_BIN, fs.constants.X_OK, (error) => {
        if (error) reject(new Error(`openclaw command was not detected. Please confirm ${OPENCLAW_BIN} exists and is executable.`));
        else resolve();
      });
    });
  }

  function sleep (ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForGatewayState (expectedRunning, timeoutMs = 15000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const isRunning = await checkGatewayStatus();
      if (isRunning === expectedRunning) return true;
      await sleep(500);
    }
    return false;
  }

  async function runGatewayControl (action) {
    await assertOpenClawAvailable();
    if (action === 'start') {
      await runOpenClawDaemonCommand('start');
      const started = await waitForGatewayState(true, 20000);
      if (!started) throw new Error('OpenClaw daemon start ran, but Gateway did not become running before timeout.');
      wasRunning = true;
      return { changed: true, pids: (await getGatewayProcesses()).map((p) => p.pid), isRunning: true, message: 'Gateway started.' };
    }
    if (action === 'stop') {
      wasRunning = false;
      await runOpenClawDaemonCommand('stop');
      const stopped = await waitForGatewayState(false, 15000);
      if (!stopped) throw new Error('OpenClaw daemon stop ran, but Gateway did not stop before timeout.');
      return { changed: true, pids: [], isRunning: false, message: 'Gateway stopped.' };
    }

    wasRunning = false;
    await runOpenClawDaemonCommand('restart');
    const restarted = await waitForGatewayState(true, 25000);
    if (!restarted) throw new Error('OpenClaw daemon restart ran, but Gateway did not become running before timeout.');
    wasRunning = true;
    return { changed: true, pids: (await getGatewayProcesses()).map((p) => p.pid), isRunning: true, message: 'Gateway restarted.' };
  }

  function runOpenClawDaemonCommand (action) {
    return new Promise((resolve, reject) => {
      execFile(OPENCLAW_BIN, ['daemon', action], { env: { ...process.env, PATH: DASHBOARD_PATH }, timeout: 30000 }, (error, stdout, stderr) => {
        if (error) reject(new Error((stderr || stdout || error.message).trim()));
        else resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      });
    });
  }

  function sendMacOSAlert (message = 'Gateway process terminated unexpectedly. Please check the dashboard.', title = 'OpenClaw Alert') {
    return new Promise((resolve) => {
      const script = `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)} sound name "Basso"`;
      execFile('osascript', ['-e', script], { timeout: 5000 }, (error) => {
        if (error) console.error('[Watchdog] macOS notification failed:', error.message);
        resolve();
      });
    });
  }

  async function runWatchdogCheck () {
    try {
      const isRunning = await checkGatewayStatus();
      if (wasRunning === null) {
        wasRunning = isRunning;
        return;
      }
      if (!isRunning && wasRunning) {
        wasRunning = false;
        await sendMacOSAlert();
        return;
      }
      if (isRunning) wasRunning = true;
    } catch (error) {
      console.error('[Watchdog] Status check failed:', error.message);
    }
  }

  async function initializeWatchdogState () {
    try {
      wasRunning = await checkGatewayStatus();
      console.log(`[Watchdog] Initial Gateway state: ${wasRunning ? 'running' : 'stopped'}`);
    } catch (error) {
      wasRunning = null;
      console.error('[Watchdog] Initial status read failed:', error.message);
    }
  }

  return {
    assertOpenClawAvailable,
    checkGatewayStatus,
    getGatewayProcesses,
    initializeWatchdogState,
    runGatewayControl,
    runWatchdogCheck,
    sendMacOSAlert
  };
}

module.exports = { createGatewayService };
