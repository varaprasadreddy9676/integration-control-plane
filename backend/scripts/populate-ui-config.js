#!/usr/bin/env node

/**
 * Populate ui_config collection in MongoDB
 *
 * This script seeds the UI configuration values for dropdowns,
 * validation rules, and other frontend settings.
 *
 * Usage:
 *   node scripts/populate-ui-config.js
 */

const mongodb = require('../src/mongodb');

const defaultUIConfig = {
  _id: 'default', // Single document with fixed ID

  // HTTP Methods for integrations
  httpMethods: [
    { value: 'POST', label: 'POST' },
    { value: 'PUT', label: 'PUT' },
    { value: 'GET', label: 'GET' },
    { value: 'DELETE', label: 'DELETE' },
    { value: 'PATCH', label: 'PATCH' }
  ],

  // Authentication types
  authTypes: [
    { value: 'NONE', label: 'None - No authentication' },
    { value: 'API_KEY', label: 'API Key - Custom header' },
    { value: 'BASIC', label: 'Basic Auth - Username & password' },
    { value: 'BEARER', label: 'Bearer Token - Authorization header' },
    { value: 'OAUTH1', label: 'OAuth 1.0a - Signature-based auth (NetSuite, Twitter)' },
    { value: 'OAUTH2', label: 'OAuth 2.0 - Token-based auth' },
    { value: 'CUSTOM', label: 'Custom - Advanced configuration' },
    { value: 'CUSTOM_HEADERS', label: 'Custom Headers - Multiple headers' }
  ],

  // Entity scope options
  scopeTypes: [
    { value: 'ENTITY_ONLY', label: 'This entity only' },
    { value: 'INCLUDE_CHILDREN', label: 'Include child entities' }
  ],

  // Delivery status values
  deliveryStatuses: [
    { value: 'PENDING', label: 'Pending' },
    { value: 'SUCCESS', label: 'Success' },
    { value: 'FAILED', label: 'Failed' },
    { value: 'RETRYING', label: 'Retrying' },
    { value: 'ABANDONED', label: 'Abandoned' }
  ],

  // Transformation modes
  transformationModes: [
    { value: 'SIMPLE', label: 'Simple Mapping' },
    { value: 'SCRIPT', label: 'JavaScript Script' }
  ],

  // Transformation functions (for SIMPLE mode)
  transformationFunctions: [
    { value: 'none', label: 'None' },
    { value: 'trim', label: 'Trim whitespace' },
    { value: 'upper', label: 'Uppercase' },
    { value: 'lower', label: 'Lowercase' },
    { value: 'date', label: 'Format as date' },
    { value: 'default', label: 'Default value if empty' }
  ],

  // Validation rules
  validationRules: {
    timeout: {
      min: 500,
      max: 60000,
      default: 3000,
      step: 500,
      label: 'Timeout (ms)',
      description: 'Request timeout in milliseconds'
    },
    retry: {
      min: 0,
      max: 10,
      default: 3,
      step: 1,
      label: 'Retry Count',
      description: 'Number of retry attempts on failure'
    }
  },

  // Pagination defaults
  pagination: {
    defaultPageSize: 10,
    pageSizeOptions: [10, 20, 50, 100]
  },

  // Analytics time ranges
  analytics: {
    timeRangeOptions: [
      { value: 7, label: 'Last 7 days' },
      { value: 30, label: 'Last 30 days' },
      { value: 90, label: 'Last 90 days' }
    ]
  },

  // Feature flags
  features: {
    aiAssistant: true,
    advancedTransformations: true,
    multiActionIntegrations: true,
    scheduledDelivery: true,
    integrationSigning: true,
    circuitBreaker: true
  },

  // System limits
  limits: {
    maxIntegrationsPerEntity: 100,
    maxActionsPerIntegration: 10,
    maxTransformationSize: 100000,
    maxRetryAttempts: 5,
    maxScheduledIntegrations: 1000
  },

  // Worker configuration
  worker: {
    multiActionDelayMs: 10000
  },

  // Notification settings
  notifications: {
    failureEmailReports: {
      enabled: true,
      email: 'sai.varaprasad@ubq.in',
      intervalMinutes: 15,
      lookbackMinutes: 60,
      minFailures: 1,
      maxItems: 25
    }
  },

  // Metadata
  version: '1.0.0',
  createdAt: new Date(),
  updatedAt: new Date(),
  updatedBy: 'system'
};

async function populateUIConfig() {
  try {
    console.log('Connecting to MongoDB...');
    await mongodb.connect();

    const db = mongodb.getDb();
    const collection = db.collection('ui_config');

    console.log('Upserting UI configuration...');

    // Upsert (insert or update) the default config
    const result = await collection.replaceOne(
      { _id: 'default' },
      defaultUIConfig,
      { upsert: true }
    );

    if (result.upsertedCount > 0) {
      console.log('✅ UI configuration created successfully');
    } else if (result.modifiedCount > 0) {
      console.log('✅ UI configuration updated successfully');
    } else {
      console.log('✅ UI configuration already up to date');
    }

    // Create index on version for future versioning support
    await collection.createIndex({ version: 1 });
    console.log('✅ Indexes created');

    // Display configuration summary
    console.log('\n📋 Configuration Summary:');
    console.log(`   HTTP Methods: ${defaultUIConfig.httpMethods.length}`);
    console.log(`   Auth Types: ${defaultUIConfig.authTypes.length} (includes OAUTH1, OAUTH2, CUSTOM_HEADERS)`);
    console.log(`   Scope Types: ${defaultUIConfig.scopeTypes.length}`);
    console.log(`   Delivery Statuses: ${defaultUIConfig.deliveryStatuses.length}`);
    console.log(`   Transformation Modes: ${defaultUIConfig.transformationModes.length}`);
    console.log(`   Transformation Functions: ${defaultUIConfig.transformationFunctions.length}`);
    console.log(`   Timeout Range: ${defaultUIConfig.validationRules.timeout.min}-${defaultUIConfig.validationRules.timeout.max} ms`);
    console.log(`   Retry Range: ${defaultUIConfig.validationRules.retry.min}-${defaultUIConfig.validationRules.retry.max}`);
    console.log(`   Max Integrations Per Entity: ${defaultUIConfig.limits.maxIntegrationsPerEntity}`);
    console.log(`   Max Actions Per Integration: ${defaultUIConfig.limits.maxActionsPerIntegration}`);
    console.log(`   Features Enabled: ${Object.keys(defaultUIConfig.features).filter(k => defaultUIConfig.features[k]).length}`);
    console.log(`   Failure Email Reports: ${defaultUIConfig.notifications.failureEmailReports.enabled ? 'Enabled' : 'Disabled'}`);
    console.log(`   Version: ${defaultUIConfig.version}`);

    console.log('\n✅ UI configuration populated successfully!');

  } catch (error) {
    console.error('❌ Failed to populate UI configuration:', error);
    process.exit(1);
  } finally {
    // MongoDB client doesn't expose disconnect in this module
    // Connection will close when process exits
    process.exit(0);
  }
}

// Run if executed directly
if (require.main === module) {
  populateUIConfig();
}

module.exports = { populateUIConfig, defaultUIConfig };
