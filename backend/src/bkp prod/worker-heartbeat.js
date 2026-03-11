/**
 * Simple worker heartbeat tracker
 * Workers update their heartbeat, health endpoint checks if they're alive
 */

const heartbeats = {
  deliveryWorker: null,
  schedulerWorker: null
};

/**
 * Update worker heartbeat
 * @param {string} workerName - 'deliveryWorker' or 'schedulerWorker'
 */
function updateHeartbeat(workerName) {
  heartbeats[workerName] = Date.now();
}

/**
 * Check if workers are alive (heartbeat within last 2 minutes)
 * @returns {object} Status of each worker
 */
function checkWorkers() {
  const now = Date.now();
  const threshold = 120000; // 2 minutes

  return {
    deliveryWorker: {
      alive: heartbeats.deliveryWorker && (now - heartbeats.deliveryWorker) < threshold,
      lastHeartbeat: heartbeats.deliveryWorker,
      timeSinceLastMs: heartbeats.deliveryWorker ? now - heartbeats.deliveryWorker : null
    },
    schedulerWorker: {
      alive: heartbeats.schedulerWorker && (now - heartbeats.schedulerWorker) < threshold,
      lastHeartbeat: heartbeats.schedulerWorker,
      timeSinceLastMs: heartbeats.schedulerWorker ? now - heartbeats.schedulerWorker : null
    }
  };
}

/**
 * Check if all workers are healthy
 * @returns {boolean} True if all workers are alive
 */
function areWorkersHealthy() {
  const status = checkWorkers();
  return status.deliveryWorker.alive && status.schedulerWorker.alive;
}

module.exports = {
  updateHeartbeat,
  checkWorkers,
  areWorkersHealthy
};
