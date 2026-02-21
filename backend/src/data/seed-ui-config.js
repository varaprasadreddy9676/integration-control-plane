/**
 * UI Configuration Seeder
 * Seeds ui_config collection with default configuration for alert system
 *
 * Run this script to populate MongoDB with default UI configuration:
 * node backend/src/data/seed-ui-config.js
 */

const mongodb = require('../mongodb');
const { log } = require('../logger');

/**
 * Default UI configuration
 * This serves as the baseline for all entities unless overridden
 */
const defaultUiConfig = {
  _id: 'default',
  notifications: {
    failureEmailReports: {
      enabled: false,              // Disabled by default - enable per entity
      email: null,                 // Optional override recipient (falls back to ent_mail)
      intervalMinutes: 15,         // Check for failures every 15 minutes
      lookbackMinutes: 60,         // Look back 60 minutes for failures
      minFailures: 1,              // Send report if at least 1 failure found
      maxItems: 25                 // Include up to 25 recent failures in report
    }
  },
  features: {
    aiAssistant: true,             // AI-powered integration configuration assistant
    advancedTransformations: true, // Script-based transformations
    multiActionIntegrations: true,     // Multiple actions per integration
    scheduledDelivery: true,       // Delayed and recurring integrations
    integrationSigning: true,          // HMAC signature verification
    circuitBreaker: true           // Automatic failure detection and disabling
  },
  worker: {
    multiActionDelayMs: 0          // Optional delay between multi-action steps
  },
  dashboard: {
    autoRefreshSeconds: 30         // Auto-refresh interval for dashboard data
  },
  limits: {
    maxIntegrationsPerEntity: 100,     // Maximum integrations per entity
    maxActionsPerIntegration: 10,      // Maximum actions per integration
    maxTransformationSize: 100000, // Maximum transformation script size (bytes)
    maxRetryAttempts: 5,           // Maximum retry attempts per delivery
    maxScheduledIntegrations: 1000     // Maximum scheduled integrations per entity
  },
  createdAt: new Date(),
  updatedAt: new Date()
};

/**
 * Example entity-specific override (optional)
 * Uncomment and modify to create entity-specific configurations
 */
const entityOverrides = [
  // Example: Enable failure reports for entity 33 (Sankara Eye Hospital)
  // {
  //   orgId: 33,
  //   notifications: {
  //     failureEmailReports: {
  //       enabled: true,
  //       email: 'alerts@example.com',
  //       intervalMinutes: 30,
  //       lookbackMinutes: 120,
  //       minFailures: 5,
  //       maxItems: 50
  //     }
  //   },
  //   updatedAt: new Date()
  // }
];

async function seedUiConfig() {
  try {
    // Connect to MongoDB
    await mongodb.connect();
    log('info', 'Connected to MongoDB for UI config seeding');

    const db = await mongodb.getDbSafe();
    const collection = db.collection('ui_config');

    // Seed default configuration
    log('info', 'Seeding default UI configuration...');
    const defaultResult = await collection.updateOne(
      { _id: 'default' },
      { $set: defaultUiConfig },
      { upsert: true }
    );

    if (defaultResult.upsertedCount > 0) {
      log('info', '✓ Default UI configuration created');
    } else if (defaultResult.modifiedCount > 0) {
      log('info', '✓ Default UI configuration updated');
    } else {
      log('info', '✓ Default UI configuration already exists (no changes)');
    }

    // Seed entity-specific overrides (if any)
    if (entityOverrides.length > 0) {
      log('info', `Seeding ${entityOverrides.length} entity-specific configurations...`);

      const bulkOps = entityOverrides.map(override => ({
        updateOne: {
          filter: { orgId: override.orgId },
          update: { $set: override },
          upsert: true
        }
      }));

      const result = await collection.bulkWrite(bulkOps);
      log('info', `✓ Entity overrides: ${result.upsertedCount} created, ${result.modifiedCount} updated`);
    }

    log('info', '✅ UI configuration seeding complete');

    // Display current configuration
    const config = await collection.findOne({ _id: 'default' });
    log('info', 'Current default configuration:', {
      failureReportsEnabled: config?.notifications?.failureEmailReports?.enabled || false,
      intervalMinutes: config?.notifications?.failureEmailReports?.intervalMinutes || 15,
      featuresEnabled: Object.keys(config?.features || {}).length
    });

  } catch (error) {
    log('error', 'Failed to seed UI configuration', { error: error.message, stack: error.stack });
    process.exit(1);
  } finally {
    await mongodb.close();
  }
}

// Run if executed directly
if (require.main === module) {
  seedUiConfig();
}

module.exports = { seedUiConfig, defaultUiConfig };
