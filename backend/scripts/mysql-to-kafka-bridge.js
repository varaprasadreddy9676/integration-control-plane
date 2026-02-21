/**
 * MySQL to Kafka Bridge
 *
 * Dual-write bridge that reads events from notification_queue and publishes to Kafka
 * Useful for validating Kafka migration in parallel with MySQL polling
 *
 * Usage: node scripts/mysql-to-kafka-bridge.js
 */

const { Kafka } = require('kafkajs');
const mysql = require('mysql2/promise');
const mongodb = require('../src/mongodb');
const config = require('../config.json');
const { log } = require('../src/logger');

let running = true;
let producer = null;
let mysqlConnection = null;

async function startBridge() {
  console.log('MySQL to Kafka Bridge');
  console.log('=====================');
  console.log('This bridge reads from notification_queue and publishes to Kafka');
  console.log('Useful for dual-write validation during migration');
  console.log('');

  try {
    // Connect to MongoDB for checkpoint storage
    await mongodb.connect();
    console.log('✓ Connected to MongoDB');

    // Connect to MySQL
    mysqlConnection = await mysql.createConnection({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database
    });
    console.log('✓ Connected to MySQL');

    // Connect to Kafka
    const kafka = new Kafka({
      clientId: 'mysql-kafka-bridge',
      brokers: config.kafka.brokers
    });

    producer = kafka.producer();
    await producer.connect();
    console.log('✓ Connected to Kafka');
    console.log('');

    // Get or initialize bridge checkpoint
    const db = await mongodb.getDbSafe();
    let checkpoint = await db.collection('bridge_checkpoint').findOne({ bridgeId: 'mysql-kafka' });

    if (!checkpoint) {
      // Initialize from worker checkpoint if exists
      const workerCheckpoint = await db.collection('worker_checkpoint').findOne({ workerId: 'deliveryWorker' });
      const initialCheckpoint = workerCheckpoint?.lastProcessedId || 0;

      await db.collection('bridge_checkpoint').insertOne({
        bridgeId: 'mysql-kafka',
        lastProcessedId: initialCheckpoint,
        updatedAt: new Date()
      });

      checkpoint = { lastProcessedId: initialCheckpoint };
      console.log(`Initialized bridge checkpoint at ${initialCheckpoint}`);
    } else {
      console.log(`Resuming from checkpoint ${checkpoint.lastProcessedId}`);
    }

    console.log('');
    console.log('Bridge running... Press Ctrl+C to stop');
    console.log('');

    // Poll and bridge events
    while (running) {
      try {
        const events = await fetchPendingEvents(checkpoint.lastProcessedId, 5);

        if (events.length > 0) {
          console.log(`Processing ${events.length} events...`);

          for (const event of events) {
            await publishToKafka(event);
            await updateBridgeCheckpoint(event.id);
            checkpoint.lastProcessedId = event.id;

            console.log(`  ✓ Bridged event ${event.id} (${event.event_type})`);
          }

          console.log('');
        }

        // Wait before next poll (5 seconds)
        await sleep(5000);

      } catch (error) {
        console.error('Error in bridge loop:', error.message);
        await sleep(5000);
      }
    }

  } catch (error) {
    console.error('✗ Bridge startup failed:', error.message);
    process.exit(1);
  }
}

async function fetchPendingEvents(lastId, limit) {
  const query = `
    SELECT *
    FROM notification_queue
    WHERE id > ?
      AND is_processed = 0
      AND DATE(created_at) >= DATE_SUB(CURDATE(), INTERVAL 1 DAY)
    ORDER BY id ASC
    LIMIT ?
  `;

  const [rows] = await mysqlConnection.execute(query, [lastId, limit]);

  return rows.map(row => ({
    id: row.id,
    eventId: `${row.entity_parent_rid}-${row.transaction_type}-${row.id}`,
    entity_rid: row.entity_rid,
    entity_parent_rid: row.entity_parent_rid,
    event_type: row.transaction_type || row.event_type,
    created_at: row.created_at,
    payload: parsePayload(row.payload)
  }));
}

function parsePayload(payloadStr) {
  try {
    return JSON.parse(payloadStr);
  } catch {
    return {};
  }
}

async function publishToKafka(event) {
  await producer.send({
    topic: config.kafka.topic,
    messages: [
      {
        key: event.entity_parent_rid.toString(), // Partition key for ordering
        value: JSON.stringify({
          id: event.id,
          eventId: event.eventId,
          entity_rid: event.entity_rid,
          entity_parent_rid: event.entity_parent_rid,
          event_type: event.event_type,
          created_at: event.created_at,
          payload: event.payload
        }),
        headers: {
          source: 'mysql-kafka-bridge',
          mysqlId: event.id.toString(),
          bridgedAt: Date.now().toString()
        }
      }
    ]
  });
}

async function updateBridgeCheckpoint(lastProcessedId) {
  const db = await mongodb.getDbSafe();
  await db.collection('bridge_checkpoint').updateOne(
    { bridgeId: 'mysql-kafka' },
    {
      $set: {
        lastProcessedId,
        updatedAt: new Date()
      }
    }
  );
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('');
  console.log('Shutting down bridge...');
  running = false;

  if (producer) {
    await producer.disconnect();
    console.log('✓ Kafka producer disconnected');
  }

  if (mysqlConnection) {
    await mysqlConnection.end();
    console.log('✓ MySQL connection closed');
  }

  await mongodb.close();
  console.log('✓ MongoDB connection closed');

  console.log('Bridge stopped');
  process.exit(0);
});

// Start the bridge
startBridge().catch(console.error);
