'use strict';

// Spawns and supervises the corelyn-studiod Go daemon as an Electron
// sidecar. See docs/superpowers/specs/2026-07-22-corelyn-studio-v2-go-design.md §3.1.

const { app } = require('electron');
const { spawn } = require('node:child_process');
const net = require('node:net');
const http = require('node:http');
const path = require('node:path');

const HEALTH_POLL_INTERVAL_MS = 100;
const HEALTH_TIMEOUT_MS = 10_000;

// Bind an ephemeral port, read it back, release it. Small TOCTOU race
// (something else could grab the port before the daemon binds it) — acceptable
// for a loopback-only dev/desktop tool.
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

function binaryPath() {
  const name = process.platform === 'win32' ? 'corelyn-studiod.exe' : 'corelyn-studiod';
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin', name)
    : path.join(__dirname, '..', 'backend', name);
}

function waitForHealth(port, deadlineAt) {
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(
        { host: '127.0.0.1', port, path: '/api/health', timeout: 1000 },
        (res) => {
          let body = '';
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                if (JSON.parse(body).status === 'ok') {
                  resolve();
                  return;
                }
              } catch {
                // fall through to retry
              }
            }
            scheduleRetry();
          });
        },
      );
      req.on('error', scheduleRetry);
      req.on('timeout', () => req.destroy());
    };

    const scheduleRetry = () => {
      if (Date.now() >= deadlineAt) {
        reject(new Error(`sidecar health check did not succeed within ${HEALTH_TIMEOUT_MS}ms`));
        return;
      }
      setTimeout(attempt, HEALTH_POLL_INTERVAL_MS);
    };

    attempt();
  });
}

// startSidecar spawns corelyn-studiod, waits for it to report healthy, and
// returns its port plus a stop() to tear it down.
//
// The daemon's DB always lives under app.getPath('userData') — never beside
// the binary. The AppImage mount is read-only, so a path resolved next to the
// executable works in dev and fails only once packaged.
async function startSidecar() {
  const port = await getFreePort();
  const dbPath = path.join(app.getPath('userData'), 'corelyn.db');
  const bin = binaryPath();

  // stdio is fully piped (not 'inherit') so the daemon's stdin is a pipe whose
  // write end we hold. If Electron itself is killed -9, no JS handler runs,
  // but the OS closes that pipe anyway — the daemon's own stdin-EOF watch
  // (backend/cmd/corelyn-studiod/main.go) is what actually kills it in that
  // case, not anything below.
  // The robot link is optional: with no URL the daemon serves the API but has
  // nowhere to publish missions. DEMO MODE (spec §3.3) is this pointed at
  // corelyn-mockbot; a live cell points it at the robot's rosbridge.
  const args = ['--port', String(port), '--db', dbPath];
  if (process.env.CORELYN_ROSBRIDGE_URL) {
    args.push('--rosbridge', process.env.CORELYN_ROSBRIDGE_URL);
  }

  const child = spawn(bin, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => process.stdout.write(`[corelyn-studiod] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[corelyn-studiod] ${chunk}`));

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (!child.killed) child.kill();
  };

  child.on('exit', (code, signal) => {
    stopped = true;
    if (code !== 0 && code !== null) {
      console.error(`corelyn-studiod exited unexpectedly: code=${code} signal=${signal}`);
    }
  });

  // Normal-quit paths. A hard kill -9 of Electron bypasses all of these —
  // see the comment above.
  app.on('before-quit', stop);
  app.on('window-all-closed', stop);
  process.on('exit', stop);

  try {
    await waitForHealth(port, Date.now() + HEALTH_TIMEOUT_MS);
  } catch (err) {
    stop();
    throw err;
  }

  return { port, stop };
}

module.exports = { startSidecar, getFreePort, binaryPath };
