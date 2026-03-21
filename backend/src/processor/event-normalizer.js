'use strict';

const { VM } = require('../utils/secure-vm');
const { normalizeSubjectExtraction } = require('../services/lifecycle-config');

/**
 * Event type classification remains platform behavior. Subject extraction does
 * not depend on these classifications, so unknown event types can still be
 * normalized when a config provides subjectExtraction.
 */
const EVENT_CLASSIFICATIONS = {
  APPOINTMENT_CONFIRMATION: { subjectType: 'APPOINTMENT', action: 'create' },
  APPOINTMENT_RESCHEDULED: { subjectType: 'APPOINTMENT', action: 'update' },
  APPOINTMENT_CANCELLATION: { subjectType: 'APPOINTMENT', action: 'cancel' },
  OPU_RESCHEDULED: { subjectType: 'APPOINTMENT', action: 'update' },
  OPU_CANCELLED: { subjectType: 'APPOINTMENT', action: 'cancel' },
  ET_RESCHEDULED: { subjectType: 'APPOINTMENT', action: 'update' },
  ET_CANCELLED: { subjectType: 'APPOINTMENT', action: 'cancel' },
  SURGERY_CANCELLED: { subjectType: 'SURGERY', action: 'cancel' },
};

function getGlobalUtilities() {
  const epoch = (dateStr) => {
    if (!dateStr) return null;
    try {
      let date;
      if (typeof dateStr === 'number') {
        date = dateStr > 10000000000 ? new Date(dateStr) : new Date(dateStr * 1000);
      } else if (typeof dateStr === 'string' && dateStr.includes('/')) {
        const parts = dateStr.split(' ');
        const [day, month, year] = parts[0].split('/');

        if (parts.length > 1) {
          const timeStr = parts.slice(1).join(' ');
          date = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${timeStr}`);
        } else {
          date = new Date(Number(year), Number(month) - 1, Number(day));
        }
      } else {
        date = new Date(dateStr);
      }

      return Number.isNaN(date.getTime()) ? null : Math.floor(date.getTime() / 1000);
    } catch (_error) {
      return null;
    }
  };

  return {
    epoch,
    datetime: (date, time, timezone) => {
      if (!date) return null;
      const tz = timezone || '+00:00';
      return epoch(time ? `${date}T${time}${tz}` : `${date}T00:00:00${tz}`);
    },
    uppercase: (value) => (value ? String(value).toUpperCase() : value),
    lowercase: (value) => (value ? String(value).toLowerCase() : value),
    trim: (value) => (value ? String(value).trim() : value),
    get: (obj, path, defaultValue) => {
      if (!path || !obj) return defaultValue;
      const keys = path.split('.');
      let value = obj;
      for (const key of keys) {
        value = value?.[key];
        if (value === undefined) return defaultValue;
      }
      return value;
    },
  };
}

function getPathValue(payload, path) {
  if (!path || typeof path !== 'string') {
    return undefined;
  }

  return path.split('.').reduce((value, key) => {
    if (value === null || value === undefined) {
      return undefined;
    }
    return value[key];
  }, payload);
}

function firstMappedValue(payload, mappingValue) {
  const candidates = Array.isArray(mappingValue) ? mappingValue : [mappingValue];

  for (const candidate of candidates) {
    const value = getPathValue(payload, candidate);
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }

  return null;
}

function normalizeComparableValue(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  return null;
}

function normalizeSubjectValue(value) {
  if (Array.isArray(value)) {
    const normalized = value.map(normalizeComparableValue).filter((item) => item !== null);
    return normalized.length > 0 ? Array.from(new Set(normalized)) : null;
  }

  return normalizeComparableValue(value);
}

function normalizeExtractedSubject(rawSubject) {
  if (!rawSubject || typeof rawSubject !== 'object' || Array.isArray(rawSubject)) {
    return { data: null, warnings: ['Subject extraction must return an object'] };
  }

  const normalized = {};
  const warnings = [];

  for (const [rawKey, rawValue] of Object.entries(rawSubject)) {
    if (typeof rawKey !== 'string' || rawKey.trim() === '') {
      continue;
    }

    const key = rawKey.trim();
    const normalizedValue = normalizeSubjectValue(rawValue);

    if (normalizedValue === null) {
      if (rawValue && typeof rawValue === 'object' && !(rawValue instanceof Date)) {
        warnings.push(`Subject key "${key}" resolved to a nested object and was ignored`);
      }
      continue;
    }

    normalized[key] = normalizedValue;
  }

  return {
    data: Object.keys(normalized).length > 0 ? normalized : null,
    warnings,
  };
}

function extractSubjectFromPaths(payload, pathMap = {}) {
  const rawSubject = {};
  for (const [key, mappingValue] of Object.entries(pathMap)) {
    rawSubject[key] = firstMappedValue(payload, mappingValue);
  }

  return normalizeExtractedSubject(rawSubject);
}

async function extractSubjectFromScript(payload, script, context = {}) {
  const vm = new VM({
    timeout: 60000,
    sandbox: {
      payload,
      context,
      ...getGlobalUtilities(),
    },
    allowAsync: true,
  });

  const secureScript = `
    return (async function extractSubject(payload, context) {
      ${script}
    })(payload, context)
  `;

  const rawSubject = await vm.run(secureScript);
  return normalizeExtractedSubject(rawSubject);
}

async function evaluateSubjectExtraction(payload, subjectExtraction, context = {}) {
  const normalizedSubjectExtraction = normalizeSubjectExtraction(subjectExtraction);
  if (!normalizedSubjectExtraction) {
    return { data: null, warnings: ['subjectExtraction is not configured'] };
  }

  if (normalizedSubjectExtraction.mode === 'SCRIPT') {
    return extractSubjectFromScript(payload, normalizedSubjectExtraction.script, context);
  }

  return extractSubjectFromPaths(payload, normalizedSubjectExtraction.paths);
}

async function normalizeEventSubject(eventType, payload, options = {}) {
  const classification = EVENT_CLASSIFICATIONS[eventType] || null;
  const subjectExtraction = normalizeSubjectExtraction(options.subjectExtraction, options.subjectMapping);

  if (!subjectExtraction) {
    return null;
  }

  const extraction = await evaluateSubjectExtraction(payload, subjectExtraction, {
    ...options.context,
    eventType,
    subjectType: options.subjectType || classification?.subjectType || null,
  });

  if (!extraction.data) {
    return {
      eventType,
      action: classification?.action || null,
      subjectType: options.subjectType || classification?.subjectType || null,
      data: null,
      warnings: extraction.warnings,
    };
  }

  return {
    eventType,
    action: classification?.action || null,
    subjectType: options.subjectType || classification?.subjectType || null,
    data: extraction.data,
    warnings: extraction.warnings,
  };
}

function toComparableValues(value) {
  if (value === null || value === undefined || value === '') {
    return [];
  }

  const items = Array.isArray(value) ? value : [value];
  const comparable = [];

  for (const item of items) {
    if (item === null || item === undefined || item === '') {
      continue;
    }

    comparable.push(item);

    if (typeof item === 'number' && Number.isFinite(item)) {
      comparable.push(String(item));
      continue;
    }

    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (trimmed !== '') {
        comparable.push(trimmed);
        const numericValue = Number(trimmed);
        if (!Number.isNaN(numericValue)) {
          comparable.push(numericValue);
        }
      }
      continue;
    }

    if (typeof item === 'boolean') {
      comparable.push(String(item));
    }
  }

  return Array.from(new Set(comparable));
}

function matchSubjects(incomingSubject, candidateSubject, matchKeys = []) {
  if (!incomingSubject?.data || !candidateSubject?.data || matchKeys.length === 0) {
    return null;
  }

  for (const key of matchKeys) {
    const incomingValues = toComparableValues(incomingSubject.data[key]);
    const candidateValues = new Set(toComparableValues(candidateSubject.data[key]));

    if (incomingValues.length === 0 || candidateValues.size === 0) {
      continue;
    }

    if (incomingValues.some((value) => candidateValues.has(value))) {
      return { matchedOn: key };
    }
  }

  return null;
}

function isInvalidatingEvent(eventType) {
  const cls = EVENT_CLASSIFICATIONS[eventType];
  return cls?.action === 'cancel' || cls?.action === 'update';
}

module.exports = {
  evaluateSubjectExtraction,
  normalizeEventSubject,
  matchSubjects,
  toComparableValues,
  isInvalidatingEvent,
};
