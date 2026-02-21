const { log } = require('../src/logger');
const db = require('../src/db');

/**
 * Migration to add metadata column to webhook_config table
 * This supports storing template information and other webhook metadata
 */
async function addMetadataColumn() {
  if (!db.isConfigured()) {
    log('info', 'Database not configured, skipping migration');
    return;
  }

  const connection = await db.getConnection();

  try {
    // Check if metadata column already exists
    const [columns] = await connection.execute(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'webhook_config'
      AND COLUMN_NAME = 'metadata'
      AND TABLE_SCHEMA = DATABASE()
    `);

    if (columns.length === 0) {
      log('info', 'Adding metadata column to webhook_config table');

      // Add metadata column
      await connection.execute(`
        ALTER TABLE webhook_config
        ADD COLUMN metadata JSON NULL
        COMMENT 'Webhook metadata including template information'
      `);

      log('info', 'Metadata column added successfully');
    } else {
      log('info', 'Metadata column already exists');
    }

    // Verify column was added successfully
    const [checkColumns] = await connection.execute(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'webhook_config'
      AND COLUMN_NAME = 'metadata'
      AND TABLE_SCHEMA = DATABASE()
    `);

    if (checkColumns.length > 0) {
      log('info', 'Metadata column verification successful', {
        column: checkColumns[0]
      });
    } else {
      throw new Error('Metadata column verification failed');
    }

  } catch (error) {
    log('error', 'Failed to add metadata column', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  } finally {
    await connection.release();
  }
}

/**
 * Migration to add created_at column if it doesn't exist
 * This helps track when webhooks were created
 */
async function addCreatedAtColumn() {
  if (!db.isConfigured()) {
    log('info', 'Database not configured, skipping created_at migration');
    return;
  }

  const connection = await db.getConnection();

  try {
    // Check if created_at column already exists
    const [columns] = await connection.execute(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'webhook_config'
      AND COLUMN_NAME = 'created_at'
      AND TABLE_SCHEMA = DATABASE()
    `);

    if (columns.length === 0) {
      log('info', 'Adding created_at column to webhook_config table');

      // Add created_at column
      await connection.execute(`
        ALTER TABLE webhook_config
        ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        COMMENT 'When the webhook was originally created'
      `);

      // Update existing records to have created_at = updated_at
      await connection.execute(`
        UPDATE webhook_config
        SET created_at = updated_at
        WHERE created_at IS NULL
      `);

      log('info', 'Created_at column added successfully');
    } else {
      log('info', 'Created_at column already exists');
    }

    // Verify column was added successfully
    const [checkColumns] = await connection.execute(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'webhook_config'
      AND COLUMN_NAME = 'created_at'
      AND TABLE_SCHEMA = DATABASE()
    `);

    if (checkColumns.length > 0) {
      log('info', 'Created_at column verification successful', {
        column: checkColumns[0]
      });
    } else {
      throw new Error('Created_at column verification failed');
    }

  } catch (error) {
    log('error', 'Failed to add created_at column', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  } finally {
    await connection.release();
  }
}

/**
 * Run all migrations for webhook_config table
 */
async function runMigrations() {
  log('info', 'Starting webhook_config table migrations');

  try {
    await addCreatedAtColumn();
    await addMetadataColumn();

    log('info', 'All webhook_config migrations completed successfully');
  } catch (error) {
    log('error', 'Migration failed', {
      error: error.message
    });
    throw error;
  }
}

// Run migrations if this script is executed directly
if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('Migrations completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error.message);
      process.exit(1);
    });
}

module.exports = {
  addMetadataColumn,
  addCreatedAtColumn,
  runMigrations
};