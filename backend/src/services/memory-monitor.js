/**
 * Memory Monitor Service
 * Tracks memory usage and prevents out-of-memory errors
 * Auto-restarts process if memory threshold is exceeded
 */

const v8 = require('v8');
const { log, logError } = require('../logger');

class MemoryMonitor {
  constructor(options = {}) {
    // Threshold at 85% of max heap by default
    const heapStats = v8.getHeapStatistics();
    const defaultThreshold = Math.round((heapStats.heap_size_limit / 1024 / 1024) * 0.85);

    this.heapThresholdMB = options.heapThresholdMB || defaultThreshold;
    this.checkIntervalMs = options.checkIntervalMs || 60000; // Every minute
    this.gracefulShutdown = options.gracefulShutdown !== false; // Default true
    this.warningThresholdMB = Math.round(this.heapThresholdMB * 0.9); // Warning at 90% of threshold
    this.intervalHandle = null;
    this.lastGCStats = null;
  }

  /**
   * Start monitoring memory usage
   */
  start() {
    log('info', 'Memory monitor started', {
      heapThresholdMB: this.heapThresholdMB,
      warningThresholdMB: this.warningThresholdMB,
      checkIntervalMs: this.checkIntervalMs,
    });

    this.intervalHandle = setInterval(() => {
      this.checkMemory();
    }, this.checkIntervalMs);

    // Log initial memory stats
    this.logMemoryStats();
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      log('info', 'Memory monitor stopped');
    }
  }

  /**
   * Check current memory usage and take action if needed
   */
  checkMemory() {
    const stats = this.getMemoryStats();
    const heapUsedMB = stats.heapUsedMB;

    // Log memory stats periodically
    this.logMemoryStats();

    // Warning threshold
    if (heapUsedMB > this.warningThresholdMB && heapUsedMB <= this.heapThresholdMB) {
      log('warn', 'Memory usage approaching threshold', {
        heapUsedMB,
        warningThresholdMB: this.warningThresholdMB,
        heapThresholdMB: this.heapThresholdMB,
        percentOfThreshold: Math.round((heapUsedMB / this.heapThresholdMB) * 100),
      });

      // Trigger garbage collection if available
      if (global.gc) {
        log('info', 'Forcing garbage collection');
        try {
          global.gc();
        } catch (e) {
          log('warn', 'Failed to force GC', { error: e.message });
        }
      }
    }

    // Critical threshold - initiate shutdown
    if (heapUsedMB > this.heapThresholdMB) {
      logError(new Error('Memory threshold exceeded'), {
        scope: 'MemoryMonitor',
        heapUsedMB,
        heapThresholdMB: this.heapThresholdMB,
        percentUsed: stats.percentUsed,
        action: this.gracefulShutdown ? 'graceful_shutdown' : 'log_only',
      });

      if (this.gracefulShutdown) {
        this.initiateGracefulShutdown();
      }
    }
  }

  /**
   * Get current memory statistics
   */
  getMemoryStats() {
    const heapStats = v8.getHeapStatistics();
    const memUsage = process.memoryUsage();

    return {
      // Heap statistics
      heapUsedMB: Math.round(heapStats.used_heap_size / 1024 / 1024),
      heapTotalMB: Math.round(heapStats.total_heap_size / 1024 / 1024),
      heapLimitMB: Math.round(heapStats.heap_size_limit / 1024 / 1024),
      percentUsed: Math.round((heapStats.used_heap_size / heapStats.heap_size_limit) * 100),

      // Process memory
      rss: Math.round(memUsage.rss / 1024 / 1024), // Resident Set Size
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      external: Math.round(memUsage.external / 1024 / 1024), // C++ objects bound to JS

      // Additional heap stats
      mallocedMemory: Math.round(heapStats.malloced_memory / 1024 / 1024),
      peakMallocedMemory: Math.round(heapStats.peak_malloced_memory / 1024 / 1024),
      numberOfNativeContexts: heapStats.number_of_native_contexts,
      numberOfDetachedContexts: heapStats.number_of_detached_contexts,

      // Uptime
      uptimeSeconds: Math.round(process.uptime()),
      uptimeHours: Math.round((process.uptime() / 3600) * 10) / 10,
    };
  }

  /**
   * Log memory statistics
   */
  logMemoryStats() {
    const stats = this.getMemoryStats();

    log('debug', 'Memory stats', {
      heapUsedMB: stats.heapUsedMB,
      heapLimitMB: stats.heapLimitMB,
      percentUsed: stats.percentUsed,
      rss: stats.rss,
      uptimeHours: stats.uptimeHours,
      detachedContexts: stats.numberOfDetachedContexts,
    });

    // Warn about detached contexts (potential memory leaks)
    if (stats.numberOfDetachedContexts > 10) {
      log('warn', 'High number of detached contexts detected', {
        detachedContexts: stats.numberOfDetachedContexts,
        note: 'Potential memory leak',
      });
    }
  }

  /**
   * Initiate graceful shutdown
   */
  initiateGracefulShutdown() {
    log('error', 'Initiating graceful shutdown due to memory threshold', {
      heapUsedMB: this.getMemoryStats().heapUsedMB,
      thresholdMB: this.heapThresholdMB,
    });

    // Stop accepting new requests
    this.stop();

    // Give time for in-flight requests to complete (5 seconds)
    setTimeout(() => {
      log('info', 'Graceful shutdown complete - exiting process');
      process.exit(1); // Exit with error code so process manager can restart
    }, 5000);
  }

  /**
   * Get human-readable memory report
   */
  getMemoryReport() {
    const stats = this.getMemoryStats();

    return {
      status: stats.percentUsed > 85 ? 'critical' : stats.percentUsed > 70 ? 'warning' : 'healthy',
      heap: {
        used: `${stats.heapUsedMB} MB`,
        total: `${stats.heapTotalMB} MB`,
        limit: `${stats.heapLimitMB} MB`,
        percentUsed: `${stats.percentUsed}%`,
      },
      process: {
        rss: `${stats.rss} MB`,
        external: `${stats.external} MB`,
      },
      threshold: {
        warning: `${this.warningThresholdMB} MB`,
        critical: `${this.heapThresholdMB} MB`,
      },
      uptime: {
        seconds: stats.uptimeSeconds,
        hours: stats.uptimeHours,
      },
      leakIndicators: {
        detachedContexts: stats.numberOfDetachedContexts,
        possibleLeak: stats.numberOfDetachedContexts > 10,
      },
    };
  }

  /**
   * Force garbage collection (requires --expose-gc flag)
   */
  forceGC() {
    if (global.gc) {
      const before = this.getMemoryStats().heapUsedMB;
      global.gc();
      const after = this.getMemoryStats().heapUsedMB;

      log('info', 'Forced garbage collection', {
        before: `${before} MB`,
        after: `${after} MB`,
        freed: `${before - after} MB`,
      });

      return { before, after, freed: before - after };
    } else {
      log('warn', 'GC not available', {
        note: 'Start Node.js with --expose-gc flag to enable manual GC',
      });
      return null;
    }
  }
}

module.exports = { MemoryMonitor };
