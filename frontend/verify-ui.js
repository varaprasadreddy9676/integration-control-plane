#!/usr/bin/env node
/**
 * UI Verification Script
 *
 * Quick checks to ensure critical UI data is loading properly.
 * Run this before declaring UI changes complete.
 *
 * Usage: node verify-ui.js
 */

const API_BASE_URL = process.env.VITE_API_BASE_URL || 'http://localhost:4000/api/v1';
const API_KEY = process.env.VITE_API_KEY || 'mdcs_dev_key_1f4a';

const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(type, message) {
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  const typeColors = { success: colors.green, error: colors.red, info: colors.blue, warning: colors.yellow };
  console.log(`${typeColors[type]}${icons[type]} ${message}${colors.reset}`);
}

async function checkEndpoint(name, url, validator) {
  try {
    const response = await fetch(`${API_BASE_URL}${url}`, {
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      }
    });

    if (!response.ok) {
      const error = await response.json();
      log('error', `${name}: ${error.message || error.error || 'Request failed'}`);
      return false;
    }

    const data = await response.json();
    const validationResult = validator(data);

    if (validationResult.success) {
      log('success', `${name}: ${validationResult.message}`);
      return true;
    } else {
      log('error', `${name}: ${validationResult.message}`);
      return false;
    }
  } catch (err) {
    log('error', `${name}: ${err.message}`);
    return false;
  }
}

async function runChecks() {
  console.log(`\n${colors.blue}🔍 Running UI Verification Checks...${colors.reset}\n`);

  const results = [];

  // Check 1: UI Config - Auth Types
  results.push(await checkEndpoint(
    'Authentication Types',
    '/config/ui',
    (data) => {
      if (!data.authTypes || !Array.isArray(data.authTypes)) {
        return { success: false, message: 'authTypes not found or not an array' };
      }
      if (data.authTypes.length === 0) {
        return { success: false, message: 'authTypes array is empty' };
      }
      const hasValidStructure = data.authTypes.every(item => item.value && item.label);
      if (!hasValidStructure) {
        return { success: false, message: 'authTypes items missing value or label properties' };
      }
      return { success: true, message: `${data.authTypes.length} auth types available` };
    }
  ));

  // Check 2: UI Config - HTTP Methods
  results.push(await checkEndpoint(
    'HTTP Methods',
    '/config/ui',
    (data) => {
      if (!data.httpMethods || !Array.isArray(data.httpMethods)) {
        return { success: false, message: 'httpMethods not found or not an array' };
      }
      if (data.httpMethods.length === 0) {
        return { success: false, message: 'httpMethods array is empty' };
      }
      return { success: true, message: `${data.httpMethods.length} HTTP methods available` };
    }
  ));

  // Check 3: UI Config - Scope Types
  results.push(await checkEndpoint(
    'Scope Types',
    '/config/ui',
    (data) => {
      if (!data.scopeTypes || !Array.isArray(data.scopeTypes)) {
        return { success: false, message: 'scopeTypes not found or not an array' };
      }
      if (data.scopeTypes.length === 0) {
        return { success: false, message: 'scopeTypes array is empty' };
      }
      return { success: true, message: `${data.scopeTypes.length} scope types available` };
    }
  ));

  // Check 4: Event Types
  results.push(await checkEndpoint(
    'Event Types',
    '/field-schemas/event-types',
    (data) => {
      if (!data.eventTypes || !Array.isArray(data.eventTypes)) {
        return { success: false, message: 'eventTypes not found or not an array' };
      }
      if (data.eventTypes.length === 0) {
        return { success: false, message: 'No event types found' };
      }
      const hasEventTypeProperty = data.eventTypes.every(item => item.eventType);
      if (!hasEventTypeProperty) {
        return { success: false, message: 'Event type items missing eventType property' };
      }
      return { success: true, message: `${data.eventTypes.length} event types available` };
    }
  ));

  // Check 5: Tenant Info (basic connectivity)
  results.push(await checkEndpoint(
    'Tenant Info',
    '/tenant?entityParentRid=100',
    (data) => {
      if (!data.entityParentRid) {
        return { success: false, message: 'Tenant data missing entityParentRid' };
      }
      return { success: true, message: `Tenant loaded (${data.tenantName || 'Unknown'})` };
    }
  ));

  // Summary
  console.log(`\n${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  const passed = results.filter(r => r).length;
  const total = results.length;

  if (passed === total) {
    log('success', `All ${total} checks passed!`);
    console.log(`${colors.green}\n✨ UI is ready for testing${colors.reset}\n`);
    process.exit(0);
  } else {
    log('error', `${total - passed} of ${total} checks failed`);
    console.log(`${colors.red}\n❌ Fix issues before proceeding${colors.reset}\n`);
    process.exit(1);
  }
}

// Run checks
runChecks().catch(err => {
  log('error', `Verification script failed: ${err.message}`);
  process.exit(1);
});
