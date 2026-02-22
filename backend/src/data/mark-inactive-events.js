/**
 * Mark Non-Production Events as Inactive
 * Marks all event types that don't have production-validated schemas as inactive
 */

const mongodb = require('../mongodb');
const { log } = require('../logger');

// Production-validated event types (from seed-event-schemas.js)
const ACTIVE_EVENT_TYPES = [
  'PATIENT_REGISTERED',
  'OP_VISIT_CREATED',
  'OP_VISIT_MODIFIED',
  'APPOINTMENT_CONFIRMATION',
  'APPOINTMENT_CANCELLATION',
  'APPOINTMENT_RESCHEDULED',
  'BILL_CREATED',
  'OP_REFERRAL_DOCTOR_EVENT',
];

async function markInactiveEvents() {
  try {
    await mongodb.connect();
    const mongoDb = await mongodb.getDbSafe();
    const collection = mongoDb.collection('event_types');

    log('info', 'Marking non-production events as inactive...');

    // First, ensure all production events are marked as active
    const activeResult = await collection.updateMany(
      { eventType: { $in: ACTIVE_EVENT_TYPES } },
      { $set: { isActive: true, updatedAt: new Date() } }
    );

    log('info', 'Marked production events as active', {
      matched: activeResult.matchedCount,
      modified: activeResult.modifiedCount,
    });

    // Then, mark all other events as inactive
    const inactiveResult = await collection.updateMany(
      { eventType: { $nin: ACTIVE_EVENT_TYPES } },
      { $set: { isActive: false, updatedAt: new Date() } }
    );

    log('info', 'Marked non-production events as inactive', {
      matched: inactiveResult.matchedCount,
      modified: inactiveResult.modifiedCount,
    });

    // Get counts
    const activeCount = await collection.countDocuments({ isActive: true });
    const inactiveCount = await collection.countDocuments({ isActive: false });
    const totalCount = await collection.countDocuments();

    log('info', 'Event status summary', {
      active: activeCount,
      inactive: inactiveCount,
      total: totalCount,
    });

    // List active events
    const activeEvents = await collection.find({ isActive: true }, { eventType: 1, label: 1, _id: 0 }).toArray();
    log('info', 'Active events:', { events: activeEvents.map((e) => e.eventType) });

    await mongodb.close();

    return {
      active: activeCount,
      inactive: inactiveCount,
      total: totalCount,
      activeEvents: activeEvents.map((e) => e.eventType),
    };
  } catch (error) {
    log('error', 'Failed to mark inactive events', { error: error.message });
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  markInactiveEvents()
    .then((result) => {
      console.log('\n=== Event Status Summary ===');
      console.log(`Active events: ${result.active}`);
      console.log(`Inactive events: ${result.inactive}`);
      console.log(`Total events: ${result.total}`);
      console.log('\nActive event types:');
      result.activeEvents.forEach((e) => console.log(`  - ${e}`));
      process.exit(0);
    })
    .catch((error) => {
      console.error('Failed to mark inactive events:', error);
      process.exit(1);
    });
}

module.exports = { markInactiveEvents, ACTIVE_EVENT_TYPES };
