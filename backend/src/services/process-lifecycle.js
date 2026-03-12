'use strict';

const fs = require('fs/promises');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
const RUNTIME_DIR = path.join(LOG_DIR, 'runtime');
const CRASH_MARKER_DIR = path.join(RUNTIME_DIR, 'crash-markers');
const STATE_FILE = path.join(RUNTIME_DIR, 'process-state.json');

function sanitizeError(error) {
  if (!error) return null;
  return {
    name: error.name || 'Error',
    message: error.message || String(error),
    stack: error.stack || null,
  };
}

async function ensureRuntimeDir() {
  await fs.mkdir(CRASH_MARKER_DIR, { recursive: true });
}

async function readState() {
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function writeJson(filePath, payload) {
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}

async function writeState(payload) {
  await ensureRuntimeDir();
  await writeJson(STATE_FILE, payload);
}

async function archiveAbruptPreviousState(previousState) {
  if (!previousState || !['starting', 'running', 'draining'].includes(previousState.status)) {
    return null;
  }

  await ensureRuntimeDir();
  const detectedAt = new Date().toISOString();
  const markerName = `abrupt-restart-${detectedAt.replace(/[:.]/g, '-')}-pid-${previousState.pid || 'unknown'}.json`;
  const markerPath = path.join(CRASH_MARKER_DIR, markerName);
  const marker = {
    type: 'abrupt_restart_detected',
    detectedAt,
    markerPath,
    previousState,
  };

  await writeJson(markerPath, marker);
  return marker;
}

async function markProcessStart(metadata = {}) {
  const previousState = await readState();
  const crashMarker = await archiveAbruptPreviousState(previousState);
  const state = {
    status: metadata.status || 'starting',
    pid: process.pid,
    startedAt: metadata.startedAt || new Date().toISOString(),
    cwd: process.cwd(),
    nodeVersion: process.version,
    metadata,
  };
  await writeState(state);
  return { previousState, crashMarker, state };
}

async function updateState(status, metadata = {}, error = null) {
  const previousState = (await readState()) || {};
  const state = {
    ...previousState,
    status,
    pid: process.pid,
    updatedAt: new Date().toISOString(),
    metadata: {
      ...(previousState.metadata || {}),
      ...metadata,
    },
  };
  if (status === 'running' && !state.startedAt) {
    state.startedAt = new Date().toISOString();
  }
  if (status === 'stopped') {
    state.stoppedAt = new Date().toISOString();
  }
  if (error) {
    state.error = sanitizeError(error);
  } else if (status === 'running' && Object.prototype.hasOwnProperty.call(state, 'error')) {
    delete state.error;
  }
  await writeState(state);
  return state;
}

async function markProcessRunning(metadata = {}) {
  return updateState('running', metadata);
}

async function markProcessDraining(reason, error = null, metadata = {}) {
  return updateState(
    'draining',
    {
      reason,
      ...metadata,
    },
    error
  );
}

async function markProcessStopped(reason, error = null, metadata = {}) {
  return updateState(
    'stopped',
    {
      reason,
      ...metadata,
    },
    error
  );
}

module.exports = {
  paths: {
    runtimeDir: RUNTIME_DIR,
    crashMarkerDir: CRASH_MARKER_DIR,
    stateFile: STATE_FILE,
  },
  markProcessStart,
  markProcessRunning,
  markProcessDraining,
  markProcessStopped,
};
