const { VM } = require('../utils/secure-vm');
const { log, logError } = require('../logger');

/**
 * Execute scheduling script in sandboxed environment
 * @param {string} script - JavaScript scheduling script
 * @param {Object} event - Event payload
 * @param {Object} context - Additional context (eventType, orgId, __KEEP_integrationConfig__)
 * @returns {Promise<number|Object>} Unix timestamp (ms) for DELAYED, or config object for RECURRING
 */
async function executeSchedulingScript(script, event, context = {}) {
  try {
    // Utility functions available in scheduling scripts
    // Define epoch as a standalone function so datetime can reference it directly
    const epochFn = (dateStr) => {
      if (!dateStr) return null;
      try {
        let date;
        if (typeof dateStr === 'number') {
          date = dateStr > 10000000000 ? new Date(dateStr) : new Date(dateStr * 1000);
        } else if (dateStr.includes('/')) {
          // Handle DD/MM/YYYY or DD/MM/YYYY HH:MM AM/PM format
          const parts = dateStr.split(' ');
          const [day, month, year] = parts[0].split('/');

          if (parts.length > 1) {
            // Has time component like "04/02/2026 04:07 PM"
            const timeStr = parts.slice(1).join(' ');
            const isoDateStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${timeStr}`;
            date = new Date(isoDateStr);
          } else {
            // Date only like "04/02/2026"
            date = new Date(year, month - 1, day);
          }
        } else if (dateStr.match(/^\d{1,2}-[A-Za-z]{3}-\d{4}/)) {
          const parts = dateStr.split(/[\s-]+/);
          const monthMap = {
            jan: 0,
            feb: 1,
            mar: 2,
            apr: 3,
            may: 4,
            jun: 5,
            jul: 6,
            aug: 7,
            sep: 8,
            oct: 9,
            nov: 10,
            dec: 11,
          };
          date = new Date(parts[2], monthMap[parts[1].toLowerCase().substring(0, 3)], parts[0]);
        } else {
          date = new Date(dateStr);
        }
        return Number.isNaN(date.getTime()) ? null : Math.floor(date.getTime() / 1000);
      } catch (_e) {
        return null;
      }
    };

    const utilities = {
      // Date/Time conversion utilities
      epoch: epochFn,

      datetime: (date, time, timezone) => {
        if (!date) return null;
        const tz = timezone || '+05:30';
        const dateTimeStr = time ? `${date}T${time}${tz}` : `${date}T00:00:00${tz}`;
        return epochFn(dateTimeStr); // Call epochFn directly instead of this.epoch
      },

      // Date parsing
      parseDate: (dateString) => {
        const parsed = new Date(dateString);
        if (Number.isNaN(parsed.getTime())) {
          throw new Error(`Invalid date string: ${dateString}`);
        }
        return parsed;
      },

      // Time manipulation (hours)
      addHours: (date, hours) => {
        const result = new Date(date);
        result.setHours(result.getHours() + hours);
        return result;
      },
      subtractHours: (date, hours) => {
        const result = new Date(date);
        result.setHours(result.getHours() - hours);
        return result;
      },

      // Time manipulation (days)
      addDays: (date, days) => {
        const result = new Date(date);
        result.setDate(result.getDate() + days);
        return result;
      },
      subtractDays: (date, days) => {
        const result = new Date(date);
        result.setDate(result.getDate() - days);
        return result;
      },

      // Time manipulation (minutes)
      addMinutes: (date, minutes) => {
        const result = new Date(date);
        result.setMinutes(result.getMinutes() + minutes);
        return result;
      },
      subtractMinutes: (date, minutes) => {
        const result = new Date(date);
        result.setMinutes(result.getMinutes() - minutes);
        return result;
      },

      // Get current time
      now: () => new Date(),

      // Convert to Unix timestamp (ms)
      toTimestamp: (date) => {
        if (date instanceof Date) {
          return date.getTime();
        }
        return new Date(date).getTime();
      },

      // Logging (limited)
      console: {
        log: (...args) => log('debug', 'Scheduling script log', { message: args.join(' ') }),
        error: (...args) => log('warn', 'Scheduling script error', { message: args.join(' ') }),
      },
    };

    // Create sandboxed VM
    const vm = new VM({
      timeout: 5000, // 5 second timeout
      allowAsync: false, // Scheduling scripts are synchronous
      sandbox: {
        event, // Event payload
        context, // Additional context
        ...utilities, // Utility functions (Date, Math, JSON provided by SecureVM)
      },
    });

    // Wrap script in a function to allow return statements
    // Return the result so SecureVM captures it correctly
    const wrappedScript = `return (function() { ${script} })()`;

    // Execute the script (SecureVM returns a Promise)
    const result = await vm.run(wrappedScript);

    // Validate result
    if (typeof result === 'number') {
      // DELAYED mode: allow past timestamps to support OVERDUE scheduled entries
      if (result > Date.now() + 365 * 24 * 60 * 60 * 1000) {
        throw new Error('Scheduled time cannot be more than 1 year in the future');
      }
      return result;
    } else if (typeof result === 'object' && result !== null) {
      // RECURRING mode: validate config object
      validateRecurringConfig(result);
      return result;
    } else {
      throw new Error('Script must return a number (timestamp) or object (recurring config)');
    }
  } catch (err) {
    logError(err, {
      scope: 'executeSchedulingScript',
      eventType: context.eventType,
    });
    throw new Error(`Scheduling script execution failed: ${err.message}`);
  }
}

/**
 * Validate recurring integration configuration
 * @param {Object} config - Recurring config from script
 */
function validateRecurringConfig(config) {
  if (!config.firstOccurrence || typeof config.firstOccurrence !== 'number') {
    throw new Error('Recurring config must have firstOccurrence (Unix timestamp)');
  }

  // Allow a small grace period for recurring first occurrence (same as DELAYED mode)
  // This prevents the recurring validation from being stricter than the worker's past-time check
  const gracePeriodMs = 60000; // 1 minute
  if (config.firstOccurrence < Date.now() - gracePeriodMs) {
    throw new Error('First occurrence must not be more than 1 minute in the past');
  }

  if (!config.intervalMs || typeof config.intervalMs !== 'number' || config.intervalMs < 60000) {
    throw new Error('intervalMs must be at least 60000 (1 minute)');
  }

  // Validate end condition (one of: maxOccurrences, endDate)
  if (config.maxOccurrences) {
    if (typeof config.maxOccurrences !== 'number' || config.maxOccurrences < 2 || config.maxOccurrences > 365) {
      throw new Error('maxOccurrences must be between 2 and 365');
    }
  } else if (config.endDate) {
    if (typeof config.endDate !== 'number' || config.endDate <= config.firstOccurrence) {
      throw new Error('endDate must be after firstOccurrence');
    }
  } else {
    throw new Error('Recurring config must have either maxOccurrences or endDate');
  }
}

/**
 * Extract cancellation info from event payload
 * Looks for patientRid and scheduledDateTime fields
 * @param {Object} event - Event payload
 * @param {string} eventType - Event type
 * @returns {Object|null} Cancellation info or null
 */
function extractCancellationInfo(event, _eventType) {
  const cancellationInfo = {};

  // Extract patientRid (check common field names)
  const patientRidFields = ['patientRid', 'patient_rid', 'patientId', 'patient_id', 'ridPatient', 'rid_patient'];
  for (const field of patientRidFields) {
    if (event[field]) {
      cancellationInfo.patientRid = event[field];
      break;
    }
  }

  // Extract scheduledDateTime (check common field names)
  const datetimeFields = [
    'scheduledDateTime',
    'scheduled_date_time',
    'appointmentDateTime',
    'appointment_date_time',
    'scheduledDate',
    'scheduled_date',
    'appointmentDate',
    'appointment_date',
    'scheduledTime',
    'scheduled_time',
  ];
  for (const field of datetimeFields) {
    if (event[field]) {
      cancellationInfo.scheduledDateTime = event[field];
      break;
    }
  }

  // Only return if we have at least patientRid
  if (cancellationInfo.patientRid) {
    return cancellationInfo;
  }

  return null;
}

/**
 * Calculate next occurrence for recurring integration
 * @param {Object} recurringConfig - Recurring configuration
 * @param {number} currentOccurrence - Current occurrence number (1 = first, 2 = second, etc.)
 * @returns {number|null} Next occurrence timestamp or null if series is complete
 */
function calculateNextOccurrence(recurringConfig, currentOccurrence) {
  const { firstOccurrence, intervalMs, maxOccurrences, endDate } = recurringConfig;

  // currentOccurrence is 1-based (1 = first occurrence, 2 = second, etc.)
  const nextTimestamp = firstOccurrence + intervalMs * (currentOccurrence - 1);

  // Check if series is complete
  if (maxOccurrences && currentOccurrence > maxOccurrences) {
    return null; // Series complete
  }

  if (endDate && nextTimestamp > endDate) {
    return null; // Past end date
  }

  return nextTimestamp;
}

module.exports = {
  executeSchedulingScript,
  extractCancellationInfo,
  calculateNextOccurrence,
  validateRecurringConfig,
};
