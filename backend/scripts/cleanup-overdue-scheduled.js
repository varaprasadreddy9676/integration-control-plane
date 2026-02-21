#!/usr/bin/env node
/**
 * Cleanup Script: Cancel Overdue Scheduled Integrations
 *
 * This script cancels scheduled integrations that are in PENDING/OVERDUE status
 * but have a scheduledFor time in the past (beyond a grace period).
 *
 * Usage:
 *   node scripts/cleanup-overdue-scheduled.js [--dry-run] [--grace-hours=24]
 *
 * Options:
 *   --dry-run         Show what would be cancelled without actually cancelling
 *   --grace-hours=N   Only cancel if past by more than N hours (default: 24)
 *   --write-logs      Write SKIPPED logs for cancelled integrations
 */

const mongodb = require('../src/mongodb');
const { log } = require('../src/logger');
const data = require('../src/data');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const writeLogs = args.includes('--write-logs');
const graceHoursArg = args.find(arg => arg.startsWith('--grace-hours='));
const graceHours = graceHoursArg ? parseInt(graceHoursArg.split('=')[1]) : 24;

async function main() {
  try {
    console.log('='.repeat(60));
    console.log('Cleanup Overdue Scheduled Integrations');
    console.log('='.repeat(60));
    console.log('Mode:', dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE');
    console.log('Grace period:', graceHours, 'hours');
    console.log('Write logs:', writeLogs ? 'Yes' : 'No');
    console.log('='.repeat(60));
    console.log('');

    await mongodb.connect();
    const db = await mongodb.getDbSafe();

    const graceMs = graceHours * 3600000;
    const cutoffTime = new Date(Date.now() - graceMs);

    // Find overdue scheduled integrations
    const overdueIntegrations = await db.collection('scheduled_integrations')
      .find({
        status: { $in: ['PENDING', 'OVERDUE'] },
        scheduledFor: { $lt: cutoffTime }
      })
      .sort({ scheduledFor: 1 })
      .toArray();

    console.log(`Found ${overdueIntegrations.length} overdue scheduled integrations (past by >${graceHours}h)\n`);

    if (overdueIntegrations.length === 0) {
      console.log('✅ No overdue scheduled integrations to clean up');
      process.exit(0);
    }

    // Group by integration name for summary
    const byIntegration = {};
    overdueIntegrations.forEach(s => {
      const name = s.__KEEP_integrationName__ || 'Unknown';
      byIntegration[name] = (byIntegration[name] || 0) + 1;
    });

    console.log('Breakdown by integration:');
    Object.entries(byIntegration).forEach(([name, count]) => {
      console.log(`  ${name}: ${count}`);
    });
    console.log('');

    if (dryRun) {
      console.log('Sample records that would be cancelled:');
      overdueIntegrations.slice(0, 5).forEach(s => {
        const pastByHours = Math.floor((Date.now() - new Date(s.scheduledFor).getTime()) / 3600000);
        console.log('  -', s.__KEEP_integrationName__);
        console.log('    Scheduled:', s.scheduledFor);
        console.log('    Past by:', pastByHours, 'hours');
        console.log('    Status:', s.status);
      });
      console.log('');
      console.log('Run without --dry-run to actually cancel these integrations');
      process.exit(0);
    }

    // Cancel each integration
    let cancelledCount = 0;
    let logsCreated = 0;

    for (const scheduled of overdueIntegrations) {
      try {
        const pastByMs = Date.now() - new Date(scheduled.scheduledFor).getTime();
        const pastByHours = Math.floor(pastByMs / 3600000);

        // Update status to CANCELLED
        await db.collection('scheduled_integrations').updateOne(
          { _id: scheduled._id },
          {
            $set: {
              status: 'CANCELLED',
              errorMessage: `Cancelled by cleanup script: scheduled time was ${pastByHours}h in the past`,
              updatedAt: new Date()
            }
          }
        );

        cancelledCount++;

        // Optionally write a SKIPPED log entry for visibility
        if (writeLogs) {
          await data.recordLog(scheduled.tenantId || scheduled.orgId, {
            __KEEP___KEEP_integrationConfig__Id__: scheduled.__KEEP___KEEP_integrationConfig__Id__,
            __KEEP_integrationName__: scheduled.__KEEP_integrationName__,
            eventId: scheduled.originalEventId || null,
            eventType: scheduled.eventType,
            status: 'SKIPPED',
            errorCategory: 'SCHEDULED_TIME_PASSED',
            responseStatus: 204,
            responseTimeMs: 0,
            attemptCount: 0,
            originalPayload: scheduled.originalPayload || {},
            requestPayload: scheduled.payload || {},
            errorMessage: `Skipped: scheduled time (${new Date(scheduled.scheduledFor).toISOString()}) was ${pastByHours}h in the past (cleanup script)`,
            targetUrl: scheduled.targetUrl,
            httpMethod: scheduled.httpMethod || 'POST',
            direction: 'OUTBOUND',
            triggerType: 'SCHEDULED',
            correlationId: null,
            traceId: null,
            requestHeaders: null
          });
          logsCreated++;
        }

        console.log(`✓ Cancelled: ${scheduled.__KEEP_integrationName__} (${pastByHours}h past)`);
      } catch (err) {
        console.error(`✗ Failed to cancel ${scheduled._id}:`, err.message);
      }
    }

    console.log('');
    console.log('='.repeat(60));
    console.log('Summary:');
    console.log('  Cancelled:', cancelledCount);
    if (writeLogs) {
      console.log('  Logs created:', logsCreated);
    }
    console.log('='.repeat(60));

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

main();
