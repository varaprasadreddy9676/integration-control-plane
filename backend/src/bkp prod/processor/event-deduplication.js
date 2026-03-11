const { log } = require('../logger');

// Event deduplication cache (simple in-memory implementation)
const processedEvents = new Map();
const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
let lastDedupCleanup = Date.now();

function cleanupDedupCache(now = Date.now()) {
  const cutoff = now - DEDUP_WINDOW_MS;
  for (const [key, timestamp] of processedEvents.entries()) {
    if (timestamp < cutoff) {
      processedEvents.delete(key);
    }
  }
  lastDedupCleanup = now;
}

function isEventProcessed(eventKey) {
  const now = Date.now();
  if (now - lastDedupCleanup > DEDUP_WINDOW_MS) {
    cleanupDedupCache(now);
  }
  const lastProcessed = processedEvents.get(eventKey);
  if (!lastProcessed) return false;

  return (now - lastProcessed) < DEDUP_WINDOW_MS;
}

function markEventProcessed(eventKey) {
  processedEvents.set(eventKey, Date.now());

  // Clean old entries periodically (keep cache manageable)
  if (processedEvents.size > 10000) {
    const cutoff = Date.now() - DEDUP_WINDOW_MS;
    for (const [key, timestamp] of processedEvents.entries()) {
      if (timestamp < cutoff) {
        processedEvents.delete(key);
      }
    }
    log('info', 'Cleaned event deduplication cache', {
      size: processedEvents.size,
      cutoff
    });
  }
}

/**
 * Get the processed events map (for testing)
 * @returns {Map} The processed events map
 */
function getProcessedEventsMap() {
  return processedEvents;
}

module.exports = {
  cleanupDedupCache,
  isEventProcessed,
  markEventProcessed,
  getProcessedEventsMap
};
