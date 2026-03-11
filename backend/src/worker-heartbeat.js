/**
 * Worker runtime telemetry registry.
 * All background workers report through this module so health/status pages
 * can render consistent runtime information.
 */

const DEFAULT_THRESHOLD_MS = 120000;

const defaultWorkers = {
  deliveryWorker: { displayName: 'Delivery Worker', thresholdMs: 120000 },
  schedulerWorker: { displayName: 'Scheduler Worker', thresholdMs: 120000 },
  pendingDeliveriesWorker: { displayName: 'Pending Deliveries Worker', thresholdMs: 30000 },
  scheduledJobWorker: { displayName: 'Scheduled Job Worker', thresholdMs: 180000 },
  dlqWorker: { displayName: 'DLQ Worker', thresholdMs: 180000 },
};

const workers = new Map();

function asDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function ensureWorker(workerName) {
  if (!workers.has(workerName)) {
    const defaults = defaultWorkers[workerName] || {};
    workers.set(workerName, {
      workerName,
      displayName: defaults.displayName || workerName,
      thresholdMs: defaults.thresholdMs || DEFAULT_THRESHOLD_MS,
      enabled: true,
      running: false,
      intervalMs: null,
      startedAt: null,
      stoppedAt: null,
      lastHeartbeat: null,
      lastRunStartedAt: null,
      lastRunFinishedAt: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastErrorMessage: null,
      meta: {},
    });
  }
  return workers.get(workerName);
}

function applyPatch(worker, patch = {}) {
  if (Object.prototype.hasOwnProperty.call(patch, 'displayName')) worker.displayName = patch.displayName || worker.displayName;
  if (Object.prototype.hasOwnProperty.call(patch, 'thresholdMs') && Number.isFinite(Number(patch.thresholdMs))) {
    worker.thresholdMs = Number(patch.thresholdMs);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'enabled')) worker.enabled = Boolean(patch.enabled);
  if (Object.prototype.hasOwnProperty.call(patch, 'running')) worker.running = Boolean(patch.running);
  if (Object.prototype.hasOwnProperty.call(patch, 'intervalMs') && Number.isFinite(Number(patch.intervalMs))) {
    worker.intervalMs = Number(patch.intervalMs);
    if (!Object.prototype.hasOwnProperty.call(patch, 'thresholdMs')) {
      worker.thresholdMs = Math.max(worker.thresholdMs || 0, worker.intervalMs * 4);
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'startedAt')) worker.startedAt = asDate(patch.startedAt);
  if (Object.prototype.hasOwnProperty.call(patch, 'stoppedAt')) worker.stoppedAt = asDate(patch.stoppedAt);
  if (Object.prototype.hasOwnProperty.call(patch, 'lastHeartbeat')) worker.lastHeartbeat = asDate(patch.lastHeartbeat);
  if (Object.prototype.hasOwnProperty.call(patch, 'lastRunStartedAt')) worker.lastRunStartedAt = asDate(patch.lastRunStartedAt);
  if (Object.prototype.hasOwnProperty.call(patch, 'lastRunFinishedAt')) worker.lastRunFinishedAt = asDate(patch.lastRunFinishedAt);
  if (Object.prototype.hasOwnProperty.call(patch, 'lastSuccessAt')) worker.lastSuccessAt = asDate(patch.lastSuccessAt);
  if (Object.prototype.hasOwnProperty.call(patch, 'lastErrorAt')) worker.lastErrorAt = asDate(patch.lastErrorAt);
  if (Object.prototype.hasOwnProperty.call(patch, 'lastErrorMessage')) worker.lastErrorMessage = patch.lastErrorMessage || null;
  if (patch.meta && typeof patch.meta === 'object') {
    worker.meta = {
      ...worker.meta,
      ...patch.meta,
    };
  }
}

function setWorkerState(workerName, patch = {}) {
  const worker = ensureWorker(workerName);
  applyPatch(worker, patch);
  return worker;
}

function updateHeartbeat(workerName, patch = {}) {
  const worker = ensureWorker(workerName);
  applyPatch(worker, patch);
  worker.lastHeartbeat = new Date();
  worker.running = Object.prototype.hasOwnProperty.call(patch, 'running') ? Boolean(patch.running) : true;
  if (!worker.startedAt) {
    worker.startedAt = new Date();
  }
  return worker;
}

function markWorkerRunStart(workerName, patch = {}) {
  return updateHeartbeat(workerName, {
    ...patch,
    running: true,
    lastRunStartedAt: new Date(),
    stoppedAt: null,
  });
}

function markWorkerRunSuccess(workerName, patch = {}) {
  return updateHeartbeat(workerName, {
    ...patch,
    running: true,
    lastRunFinishedAt: new Date(),
    lastSuccessAt: new Date(),
    lastErrorMessage: patch.clearLastError === false ? undefined : null,
  });
}

function markWorkerRunError(workerName, error, patch = {}) {
  return updateHeartbeat(workerName, {
    ...patch,
    running: true,
    lastRunFinishedAt: new Date(),
    lastErrorAt: new Date(),
    lastErrorMessage: error?.message || patch.lastErrorMessage || 'Unknown worker error',
  });
}

function stopWorker(workerName, patch = {}) {
  const worker = ensureWorker(workerName);
  applyPatch(worker, patch);
  worker.running = false;
  worker.stoppedAt = new Date();
  return worker;
}

function toWorkerStatus(worker) {
  const now = Date.now();
  const lastHeartbeatMs = worker.lastHeartbeat ? worker.lastHeartbeat.getTime() : null;
  const timeSinceLastMs = lastHeartbeatMs ? now - lastHeartbeatMs : null;
  const alive = worker.running && lastHeartbeatMs !== null && timeSinceLastMs < worker.thresholdMs;

  return {
    workerName: worker.workerName,
    displayName: worker.displayName,
    enabled: worker.enabled,
    running: worker.running,
    alive,
    thresholdMs: worker.thresholdMs,
    intervalMs: worker.intervalMs,
    lastHeartbeat: worker.lastHeartbeat ? worker.lastHeartbeat.toISOString() : null,
    timeSinceLastMs,
    startedAt: worker.startedAt ? worker.startedAt.toISOString() : null,
    stoppedAt: worker.stoppedAt ? worker.stoppedAt.toISOString() : null,
    lastRunStartedAt: worker.lastRunStartedAt ? worker.lastRunStartedAt.toISOString() : null,
    lastRunFinishedAt: worker.lastRunFinishedAt ? worker.lastRunFinishedAt.toISOString() : null,
    lastSuccessAt: worker.lastSuccessAt ? worker.lastSuccessAt.toISOString() : null,
    lastErrorAt: worker.lastErrorAt ? worker.lastErrorAt.toISOString() : null,
    lastErrorMessage: worker.lastErrorMessage,
    meta: worker.meta || {},
  };
}

function getWorkersStatus() {
  const result = {};
  Object.keys(defaultWorkers).forEach((workerName) => {
    ensureWorker(workerName);
  });
  for (const [workerName, worker] of workers.entries()) {
    result[workerName] = toWorkerStatus(worker);
  }
  return result;
}

/**
 * Legacy shape used by /health.
 */
function checkWorkers() {
  return getWorkersStatus();
}

function areWorkersHealthy() {
  const status = getWorkersStatus();
  return Boolean(status.deliveryWorker?.alive && status.schedulerWorker?.alive);
}

module.exports = {
  updateHeartbeat,
  setWorkerState,
  stopWorker,
  markWorkerRunStart,
  markWorkerRunSuccess,
  markWorkerRunError,
  getWorkersStatus,
  checkWorkers,
  areWorkersHealthy,
};
