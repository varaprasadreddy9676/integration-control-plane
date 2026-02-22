const express = require('express');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const router = express.Router();

// Helper: Extract poll ID from message
const extractPollId = (message) => {
  if (!message) return null;
  const match = message.match(/\[POLL\s*#(\d+)\]/i);
  return match ? match[1] : null;
};

// Helper: Categorize error type
const categorizeError = (message, level, meta) => {
  if (level !== 'error') return null;
  if (!message) return 'unknown';

  // PRIORITY 1: Use explicit category from meta if it exists (from frontend error logger or other sources)
  if (meta?.category) {
    // Frontend sends: ui_error, api_error, validation_error, business_logic, unhandled, unknown
    // Use these directly - they are more accurate than inference
    return meta.category;
  }

  // PRIORITY 2: Infer category from message patterns (fallback for logs without explicit category)
  const msg = message.toLowerCase();

  // Browser/UI errors (from frontend source marker)
  if (meta?.source === 'browser') {
    return 'browser_error';
  }

  // HTTP 4xx client errors
  if (
    msg.includes('400') ||
    msg.includes('401') ||
    msg.includes('403') ||
    msg.includes('404') ||
    msg.includes('bad request')
  ) {
    return 'http_4xx';
  }

  // HTTP 5xx server errors
  if (
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504') ||
    msg.includes('server error')
  ) {
    return 'http_5xx';
  }

  // Network/Connection errors
  if (
    msg.includes('timeout') ||
    msg.includes('connection') ||
    msg.includes('econnrefused') ||
    msg.includes('network')
  ) {
    return 'network';
  }

  // Transform errors
  if (msg.includes('transform failed') || msg.includes('transformation')) {
    return 'transform';
  }

  // Rate limiting
  if (msg.includes('rate limit') || msg.includes('429')) {
    return 'ratelimit';
  }

  // Database errors
  if (
    msg.includes('mongodb') ||
    msg.includes('mysql') ||
    msg.includes('database') ||
    msg.includes('query') ||
    msg.includes('sequelize')
  ) {
    return 'database';
  }

  // Validation errors
  if (msg.includes('validation') || msg.includes('invalid') || msg.includes('required field')) {
    return 'validation_error';
  }

  return 'other';
};

// Helper: Group logs by poll ID
const groupLogsByPoll = (logs) => {
  const groups = {};

  logs.forEach((log) => {
    const pollId = extractPollId(log.message) || 'NO_POLL';

    if (!groups[pollId]) {
      groups[pollId] = {
        pollId,
        logs: [],
        firstTimestamp: log.timestamp,
        lastTimestamp: log.timestamp,
        hasError: false,
        hasWarn: false,
        levels: { error: 0, warn: 0, info: 0, debug: 0 },
        eventsProcessed: 0,
        retriesProcessed: 0,
        totalDurationMs: 0,
      };
    }

    const group = groups[pollId];
    group.logs.push(log);

    // Update timestamps
    if (log.timestamp < group.firstTimestamp) {
      group.firstTimestamp = log.timestamp;
    }
    if (log.timestamp > group.lastTimestamp) {
      group.lastTimestamp = log.timestamp;
    }

    // Update flags
    if (log.level === 'error') group.hasError = true;
    if (log.level === 'warn') group.hasWarn = true;

    // Count levels
    if (group.levels[log.level] !== undefined) {
      group.levels[log.level]++;
    }

    // Extract metadata
    if (log.meta) {
      if (typeof log.meta.eventsProcessed === 'number') {
        group.eventsProcessed = Math.max(group.eventsProcessed, log.meta.eventsProcessed);
      }
      if (typeof log.meta.retriesProcessed === 'number') {
        group.retriesProcessed = Math.max(group.retriesProcessed, log.meta.retriesProcessed);
      }
      if (typeof log.meta.durationMs === 'number') {
        group.totalDurationMs += log.meta.durationMs;
      }
    }
  });

  // Calculate poll durations and sort logs
  Object.values(groups).forEach((group) => {
    const startTime = new Date(group.firstTimestamp).getTime();
    const endTime = new Date(group.lastTimestamp).getTime();
    group.pollDurationMs = endTime - startTime;

    // Sort logs chronologically
    group.logs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  });

  return Object.values(groups).sort(
    (a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime()
  );
};

// Get system logs (last 24 hours)
router.get('/', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 1000, 10000); // Increased to 10000 for high-volume systems
  const level = req.query.level; // Filter by level: info, error, debug, warn
  const search = req.query.search; // Search in message
  const pollId = req.query.pollId; // Filter by specific poll ID
  const errorCategory = req.query.errorCategory; // Filter by error category
  const grouped = req.query.grouped === 'true'; // Return grouped by poll cycles

  const logFile = path.join(__dirname, '..', '..', 'logs', 'app.log');

  if (!fs.existsSync(logFile)) {
    return res.json({
      logs: [],
      total: 0,
      pollGroups: [],
      stats: { total: 0, error: 0, warn: 0, info: 0, debug: 0 },
      pollStats: { total: 0, withErrors: 0, withWarnings: 0, healthy: 0 },
    });
  }

  const logs = [];
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  try {
    // Read file line by line from the end (most recent first)
    const fileStream = fs.createReadStream(logFile);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    const allLines = [];
    const allLogsForStats = []; // For calculating accurate statistics
    for await (const line of rl) {
      if (line.trim()) {
        allLines.push(line);
      }
    }

    // First pass: collect ALL logs within 24 hours for accurate statistics
    for (let i = allLines.length - 1; i >= 0; i--) {
      const line = allLines[i];
      try {
        const logEntry = JSON.parse(line);
        const logTime = new Date(logEntry.timestamp).getTime();

        // Skip logs older than 24 hours
        if (logTime < oneDayAgo) continue;

        // Add error category
        logEntry.errorCategory = categorizeError(logEntry.message, logEntry.level, logEntry.meta);

        // Add to stats array (no filters applied for accurate counts)
        allLogsForStats.push(logEntry);
      } catch (_err) {}
    }

    // Second pass: apply filters and limit for display
    for (let i = allLines.length - 1; i >= 0 && logs.length < limit; i--) {
      const line = allLines[i];
      try {
        const logEntry = JSON.parse(line);
        const logTime = new Date(logEntry.timestamp).getTime();

        // Skip logs older than 24 hours
        if (logTime < oneDayAgo) continue;

        // Filter by level if specified
        if (level && logEntry.level !== level) continue;

        // Filter by search term if specified
        if (search && !logEntry.message.toLowerCase().includes(search.toLowerCase())) {
          continue;
        }

        // Filter by poll ID if specified
        if (pollId) {
          const logPollId = extractPollId(logEntry.message);
          if (pollId === 'NO_POLL' && logPollId !== null) continue;
          if (pollId !== 'NO_POLL' && logPollId !== pollId) continue;
        }

        // Add error category
        logEntry.errorCategory = categorizeError(logEntry.message, logEntry.level, logEntry.meta);

        // Filter by error category if specified
        if (errorCategory && logEntry.errorCategory !== errorCategory) continue;

        logs.push(logEntry);
      } catch (_err) {}
    }

    // Calculate statistics from ALL logs (not just filtered/limited display logs)
    const errorLogsAll = allLogsForStats.filter((l) => l.level === 'error');
    const stats = {
      total: allLogsForStats.length,
      error: errorLogsAll.length,
      warn: allLogsForStats.filter((l) => l.level === 'warn').length,
      info: allLogsForStats.filter((l) => l.level === 'info').length,
      debug: allLogsForStats.filter((l) => l.level === 'debug').length,
      errorCategories: {
        // Frontend-sent categories (explicit)
        ui_error: errorLogsAll.filter((l) => l.errorCategory === 'ui_error').length,
        api_error: errorLogsAll.filter((l) => l.errorCategory === 'api_error').length,
        validation_error: errorLogsAll.filter((l) => l.errorCategory === 'validation_error').length,
        business_logic: errorLogsAll.filter((l) => l.errorCategory === 'business_logic').length,
        unhandled: errorLogsAll.filter((l) => l.errorCategory === 'unhandled').length,

        // Inferred categories (fallback)
        browser_error: errorLogsAll.filter((l) => l.errorCategory === 'browser_error').length,
        http_4xx: errorLogsAll.filter((l) => l.errorCategory === 'http_4xx').length,
        http_5xx: errorLogsAll.filter((l) => l.errorCategory === 'http_5xx').length,
        network: errorLogsAll.filter((l) => l.errorCategory === 'network').length,
        transform: errorLogsAll.filter((l) => l.errorCategory === 'transform').length,
        ratelimit: errorLogsAll.filter((l) => l.errorCategory === 'ratelimit').length,
        database: errorLogsAll.filter((l) => l.errorCategory === 'database').length,

        // Catch-all
        other: errorLogsAll.filter((l) => l.errorCategory === 'other').length,
        unknown: errorLogsAll.filter((l) => l.errorCategory === 'unknown').length,
      },
    };

    // Group by poll cycles
    const pollGroups = groupLogsByPoll(logs);

    const pollStats = {
      total: pollGroups.length,
      withErrors: pollGroups.filter((g) => g.hasError).length,
      withWarnings: pollGroups.filter((g) => g.hasWarn && !g.hasError).length,
      healthy: pollGroups.filter((g) => !g.hasError && !g.hasWarn).length,
    };

    // Performance insights
    const pollPerformance = pollGroups
      .filter((g) => g.pollId !== 'NO_POLL')
      .slice(0, 10)
      .map((g) => ({
        pollId: g.pollId,
        durationMs: g.pollDurationMs,
        eventsProcessed: g.eventsProcessed,
        retriesProcessed: g.retriesProcessed,
        logCount: g.logs.length,
        hasError: g.hasError,
        hasWarn: g.hasWarn,
      }));

    const response = {
      logs,
      displayed: logs.length, // Number of logs returned (with filters & limit)
      totalInPeriod: allLogsForStats.length, // Total logs in 24h period (for accurate stats)
      limit,
      filters: { level, search, pollId, errorCategory },
      stats, // Stats calculated from ALL logs in period, not just displayed
      pollStats,
      pollPerformance,
    };

    // Optionally include full poll groups
    if (grouped) {
      response.pollGroups = pollGroups;
    }

    res.json(response);
  } catch (err) {
    res.status(500).json({
      error: 'Failed to read logs',
      message: err.message,
    });
  }
});

// Export system logs as JSON
router.get('/export/json', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 5000, 50000); // Increased to 50000 for high-volume systems
  const level = req.query.level;
  const search = req.query.search;
  const errorCategory = req.query.errorCategory;

  const logFile = path.join(__dirname, '..', '..', 'logs', 'app.log');

  if (!fs.existsSync(logFile)) {
    return res.json([]);
  }

  const logs = [];
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  try {
    const fileStream = fs.createReadStream(logFile);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    const allLines = [];
    for await (const line of rl) {
      if (line.trim()) allLines.push(line);
    }

    // Process logs with filters
    for (let i = allLines.length - 1; i >= 0 && logs.length < limit; i--) {
      const line = allLines[i];
      try {
        const logEntry = JSON.parse(line);
        const logTime = new Date(logEntry.timestamp).getTime();

        if (logTime < oneDayAgo) continue;
        if (level && logEntry.level !== level) continue;
        if (search && !logEntry.message.toLowerCase().includes(search.toLowerCase())) continue;

        logEntry.errorCategory = categorizeError(logEntry.message, logEntry.level);
        if (errorCategory && logEntry.errorCategory !== errorCategory) continue;

        logs.push(logEntry);
      } catch (_err) {}
    }

    const filename = `system-logs-${new Date().toISOString().split('T')[0]}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: 'Export failed', message: err.message });
  }
});

// Export system logs as CSV
router.get('/export/csv', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 5000, 50000); // Increased to 50000 for high-volume systems
  const level = req.query.level;
  const search = req.query.search;
  const errorCategory = req.query.errorCategory;

  const logFile = path.join(__dirname, '..', '..', 'logs', 'app.log');

  if (!fs.existsSync(logFile)) {
    const emptyCSV = 'Timestamp,Level,Message,Error Category\n';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="system-logs.csv"');
    return res.send(emptyCSV);
  }

  const logs = [];
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  try {
    const fileStream = fs.createReadStream(logFile);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    const allLines = [];
    for await (const line of rl) {
      if (line.trim()) allLines.push(line);
    }

    for (let i = allLines.length - 1; i >= 0 && logs.length < limit; i--) {
      const line = allLines[i];
      try {
        const logEntry = JSON.parse(line);
        const logTime = new Date(logEntry.timestamp).getTime();

        if (logTime < oneDayAgo) continue;
        if (level && logEntry.level !== level) continue;
        if (search && !logEntry.message.toLowerCase().includes(search.toLowerCase())) continue;

        logEntry.errorCategory = categorizeError(logEntry.message, logEntry.level);
        if (errorCategory && logEntry.errorCategory !== errorCategory) continue;

        logs.push(logEntry);
      } catch (_err) {}
    }

    // Build CSV
    const headers = ['Timestamp', 'Level', 'Message', 'Error Category', 'Metadata'];
    const rows = logs.map((log) => [
      log.timestamp,
      log.level,
      log.message || '',
      log.errorCategory || '',
      log.meta ? JSON.stringify(log.meta) : '',
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row) =>
        row
          .map((cell) => {
            const str = String(cell);
            if (str.includes(',') || str.includes('\n') || str.includes('"')) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          })
          .join(',')
      ),
    ].join('\n');

    const filename = `system-logs-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);
  } catch (err) {
    res.status(500).json({ error: 'Export failed', message: err.message });
  }
});

// Clear all system logs (truncate file)
router.delete('/clear', async (_req, res) => {
  const logFile = path.join(__dirname, '..', '..', 'logs', 'app.log');

  try {
    // Archive current logs before clearing
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archiveFile = path.join(__dirname, '..', '..', 'logs', `app.log.${timestamp}.archive`);

    if (fs.existsSync(logFile)) {
      fs.copyFileSync(logFile, archiveFile);
      fs.truncateSync(logFile, 0);
    }

    res.json({
      message: 'System logs cleared successfully',
      archived: archiveFile,
    });
  } catch (err) {
    res.status(500).json({
      error: 'Failed to clear logs',
      message: err.message,
    });
  }
});

module.exports = router;
