const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

const ENTRY = path.join(__dirname, 'src', 'index.js');
const CONFIG_PATH = path.join(__dirname, 'config.json');
const PID_FILE = path.join(__dirname, 'supervisor.pid');
const CHECK_INTERVAL = parseInt(process.env.SUPERVISOR_CHECK_INTERVAL) || 30000; // Check every 30 seconds
const HEALTH_TIMEOUT = 5000; // 5 second timeout for health check
const STARTUP_GRACE_PERIOD = parseInt(process.env.SUPERVISOR_GRACE_PERIOD) || 30000; // Wait 30s after startup before health checks
const SIGTERM_TIMEOUT = 5000; // Wait 5s for graceful shutdown before SIGKILL
const BASE_RESTART_DELAY = 1000; // 1 second
const MAX_RESTART_DELAY = 30000; // 30 seconds max

let child = null;
let stopping = false;
let checking = false;
let restartCount = 0;
let lastStartTime = null;
let port = 4000; // Default

// Check for existing supervisor instance
function checkPidLock() {
  try {
    if (fs.existsSync(PID_FILE)) {
      const existingPid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim());

      // Check if process is still running
      try {
        process.kill(existingPid, 0); // Signal 0 checks if process exists
        // eslint-disable-next-line no-console
        console.error(`[supervisor] ERROR: Another supervisor is already running (PID ${existingPid})`);
        console.error(`[supervisor] To force start, delete: ${PID_FILE}`);
        process.exit(1);
      } catch (err) {
        // Process doesn't exist, stale PID file
        // eslint-disable-next-line no-console
        console.log(`[supervisor] Removing stale PID file from previous run`);
        fs.unlinkSync(PID_FILE);
      }
    }

    // Write our PID
    fs.writeFileSync(PID_FILE, process.pid.toString());
    // eslint-disable-next-line no-console
    console.log(`[supervisor] Created PID lock file (PID ${process.pid})`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[supervisor] Failed to create PID lock: ${err.message}`);
    process.exit(1);
  }
}

function cleanupPidLock() {
  try {
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
      // eslint-disable-next-line no-console
      console.log(`[supervisor] Removed PID lock file`);
    }
  } catch (err) {
    // Ignore cleanup errors
  }
}

// Read port from config
try {
  const configData = fs.readFileSync(CONFIG_PATH, 'utf8');
  const config = JSON.parse(configData);
  port = config.port || 4000;
  // eslint-disable-next-line no-console
  console.log(`[supervisor] Using port ${port} from config`);
} catch (err) {
  // eslint-disable-next-line no-console
  console.log(`[supervisor] Could not read config, using default port ${port}`);
}

function checkHealth() {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/health`, { timeout: HEALTH_TIMEOUT }, (res) => {
      // Only treat 2xx and 3xx as healthy
      // 4xx/5xx indicate server is alive but unhealthy (workers frozen, DB down, etc.)
      const isHealthy = res.statusCode >= 200 && res.statusCode < 400;
      resolve(isHealthy);
    });

    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function getRestartDelay() {
  // Exponential backoff with max cap
  const delay = Math.min(BASE_RESTART_DELAY * Math.pow(2, restartCount), MAX_RESTART_DELAY);
  return delay;
}

async function killProcess(proc) {
  if (!proc || proc.killed) return;

  // Try graceful shutdown first
  // eslint-disable-next-line no-console
  console.log('[supervisor] Sending SIGTERM for graceful shutdown...');
  proc.kill('SIGTERM');

  // Wait for graceful shutdown
  await new Promise(resolve => setTimeout(resolve, SIGTERM_TIMEOUT));

  // Force kill if still alive
  if (!proc.killed) {
    // eslint-disable-next-line no-console
    console.log('[supervisor] Process did not exit gracefully, sending SIGKILL...');
    proc.kill('SIGKILL');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

function startServer() {
  if (stopping) return;

  const delay = restartCount > 0 ? getRestartDelay() : 0;

  if (delay > 0) {
    // eslint-disable-next-line no-console
    console.log(`[supervisor] Restarting in ${delay}ms (attempt ${restartCount + 1})...`);
    setTimeout(() => doStartServer(), delay);
  } else {
    doStartServer();
  }
}

function doStartServer() {
  if (stopping) return;

  lastStartTime = Date.now();
  // eslint-disable-next-line no-console
  console.log('[supervisor] Starting server...');

  child = spawn(process.execPath, [ENTRY], {
    stdio: 'inherit',
    env: process.env
  });

  child.on('exit', (code, signal) => {
    if (stopping) return;

    // eslint-disable-next-line no-console
    console.log(`[supervisor] Server exited (code=${code}, signal=${signal})`);
    child = null;

    // Increment restart count
    restartCount++;

    // Restart immediately (with backoff delay)
    startServer();
  });

  child.on('error', (err) => {
    if (stopping) return;

    // eslint-disable-next-line no-console
    console.log(`[supervisor] Server error: ${err.message}`);
    child = null;

    // Increment restart count
    restartCount++;

    // Restart immediately (with backoff delay)
    startServer();
  });
}

async function monitorServer() {
  if (checking || stopping) return;

  // Skip health check during startup grace period
  const timeSinceStart = Date.now() - (lastStartTime || 0);
  if (timeSinceStart < STARTUP_GRACE_PERIOD) {
    return; // Still in grace period, skip check
  }

  checking = true;

  try {
    const isHealthy = await checkHealth();

    if (!isHealthy) {
      // eslint-disable-next-line no-console
      console.log('[supervisor] Health check failed. Server not responding or workers frozen.');

      // Kill old process
      if (child) {
        await killProcess(child);
        child = null;
      }

      // Reset restart count on health-check restart (not crash)
      restartCount = 0;

      // Start fresh
      startServer();
    } else {
      // Reset restart count on successful health check
      if (restartCount > 0) {
        // eslint-disable-next-line no-console
        console.log('[supervisor] Server healthy, reset restart counter');
        restartCount = 0;
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.log(`[supervisor] Monitor error: ${err.message}`);
  } finally {
    checking = false;
  }
}

async function shutdown() {
  stopping = true;
  // eslint-disable-next-line no-console
  console.log('[supervisor] Shutting down...');

  if (child) {
    await killProcess(child);
  }

  cleanupPidLock();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', cleanupPidLock); // Cleanup on any exit

// Check for existing supervisor and create PID lock
checkPidLock();

// Start server
startServer();

// Monitor every 30 seconds
setInterval(monitorServer, CHECK_INTERVAL);

// eslint-disable-next-line no-console
console.log(`[supervisor] Monitoring server health every ${CHECK_INTERVAL / 1000} seconds`);
console.log(`[supervisor] Startup grace period: ${STARTUP_GRACE_PERIOD / 1000} seconds`);
console.log('[supervisor] Environment variables: SUPERVISOR_CHECK_INTERVAL, SUPERVISOR_GRACE_PERIOD');
