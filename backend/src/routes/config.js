const express = require('express');
const mongodb = require('../mongodb');
const data = require('../data');
const { log, logError } = require('../logger');

const router = express.Router();

// UI Configuration endpoint
// Returns all dynamic configuration values for the frontend
// Fetches from MongoDB ui_config collection
router.get('/ui', async (req, res) => {
  try {
    // MongoDB is required - fail if not connected
    if (!mongodb.isConnected()) {
      const error = new Error('MongoDB not available');
      logError(error, { scope: 'UI Config' });
      return res.status(503).json({
        error: 'Service unavailable',
        message: 'Database connection required',
        code: 'DB_NOT_CONNECTED',
      });
    }

    const orgId = req.orgId || Number(req.query.orgId);
    const uiConfig = await data.getUiConfigForEntity(orgId);

    log('debug', 'UI config fetched from MongoDB', { orgId });
    res.json(uiConfig);
  } catch (err) {
    logError(err, { scope: 'UI Config fetch' });
    res.status(500).json({
      error: 'Failed to retrieve UI configuration',
      message: err.message,
      code: 'CONFIG_FETCH_ERROR',
    });
  }
});

router.get('/ui/entity', async (req, res) => {
  try {
    if (!mongodb.isConnected()) {
      const error = new Error('MongoDB not available');
      logError(error, { scope: 'UI Config entity' });
      return res.status(503).json({
        error: 'Service unavailable',
        message: 'Database connection required',
        code: 'DB_NOT_CONNECTED',
      });
    }

    const orgId = req.orgId || Number(req.query.orgId);
    if (!orgId) {
      return res.status(400).json({ error: 'orgId missing', code: 'VALIDATION_ERROR' });
    }

    const override = await data.getUiConfigOverride(orgId);
    res.json({ override: override || null });
  } catch (err) {
    logError(err, { scope: 'UI Config entity fetch' });
    res.status(500).json({
      error: 'Failed to retrieve UI configuration override',
      message: err.message,
      code: 'CONFIG_FETCH_ERROR',
    });
  }
});

router.patch('/ui/entity', async (req, res) => {
  try {
    if (!mongodb.isConnected()) {
      const error = new Error('MongoDB not available');
      logError(error, { scope: 'UI Config entity update' });
      return res.status(503).json({
        error: 'Service unavailable',
        message: 'Database connection required',
        code: 'DB_NOT_CONNECTED',
      });
    }

    const orgId = req.orgId || Number(req.query.orgId);
    if (!orgId) {
      return res.status(400).json({ error: 'orgId missing', code: 'VALIDATION_ERROR' });
    }

    const input = req.body?.override || {};
    const report = input?.notifications?.failureEmailReports || {};
    const worker = input?.worker || {};
    const dashboard = input?.dashboard || {};
    const override = {};

    if (Object.keys(report).length > 0) {
      const cleaned = {};
      if (typeof report.enabled === 'boolean') cleaned.enabled = report.enabled;
      if (Number.isFinite(report.intervalMinutes)) cleaned.intervalMinutes = Number(report.intervalMinutes);
      if (Number.isFinite(report.lookbackMinutes)) cleaned.lookbackMinutes = Number(report.lookbackMinutes);
      if (Number.isFinite(report.minFailures)) cleaned.minFailures = Number(report.minFailures);
      if (Number.isFinite(report.maxItems)) cleaned.maxItems = Number(report.maxItems);
      if (typeof report.email === 'string') cleaned.email = report.email.trim() || null;
      override.notifications = { failureEmailReports: cleaned };
    }

    if (Number.isFinite(worker.multiActionDelayMs)) {
      override.worker = { multiActionDelayMs: Number(worker.multiActionDelayMs) };
    }

    if (Number.isFinite(dashboard.autoRefreshSeconds)) {
      override.dashboard = { autoRefreshSeconds: Number(dashboard.autoRefreshSeconds) };
    }

    if (!override.notifications && !override.worker && !override.dashboard) {
      return res.status(400).json({
        error: 'No supported override fields provided',
        code: 'VALIDATION_ERROR',
      });
    }

    const ok = await data.upsertUiConfigOverride(orgId, override);
    if (!ok) {
      return res.status(500).json({ error: 'Failed to update override', code: 'CONFIG_UPDATE_ERROR' });
    }

    const updated = await data.getUiConfigOverride(orgId);
    res.json({ message: 'Override updated', override: updated || null });
  } catch (err) {
    logError(err, { scope: 'UI Config entity update' });
    res.status(500).json({
      error: 'Failed to update UI configuration override',
      message: err.message,
      code: 'CONFIG_UPDATE_ERROR',
    });
  }
});

router.delete('/ui/entity', async (req, res) => {
  try {
    if (!mongodb.isConnected()) {
      const error = new Error('MongoDB not available');
      logError(error, { scope: 'UI Config entity delete' });
      return res.status(503).json({
        error: 'Service unavailable',
        message: 'Database connection required',
        code: 'DB_NOT_CONNECTED',
      });
    }

    const orgId = req.orgId || Number(req.query.orgId);
    if (!orgId) {
      return res.status(400).json({ error: 'orgId missing', code: 'VALIDATION_ERROR' });
    }

    const ok = await data.clearUiConfigOverride(orgId);
    if (!ok) {
      return res.status(500).json({ error: 'Failed to clear override', code: 'CONFIG_UPDATE_ERROR' });
    }

    res.json({ message: 'Override cleared' });
  } catch (err) {
    logError(err, { scope: 'UI Config entity delete' });
    res.status(500).json({
      error: 'Failed to clear UI configuration override',
      message: err.message,
      code: 'CONFIG_UPDATE_ERROR',
    });
  }
});

// Worker checkpoint/offset endpoints
// Returns different data based on event source type (MySQL vs Kafka)
router.get('/checkpoint', async (_req, res) => {
  try {
    const config = require('../config');
    const sourceType = config.eventSource?.type;

    if (!sourceType) {
      return res.json({
        eventSource: 'none',
        message: 'No global event source configured. Configure per organization via /event-sources.',
      });
    }

    if (sourceType === 'mysql') {
      // MySQL: Return checkpoint from MongoDB
      if (!mongodb.isConnected()) {
        return res.status(503).json({ error: 'Service unavailable', code: 'DB_NOT_CONNECTED' });
      }

      const checkpoint = await data.getWorkerCheckpoint();
      res.json({
        eventSource: 'mysql',
        checkpoint: {
          lastProcessedId: checkpoint,
          updatedAt: new Date(),
        },
      });
    } else if (sourceType === 'kafka') {
      // Kafka: Return consumer group offsets
      try {
        const { Kafka } = require('kafkajs');

        const kafka = new Kafka({
          clientId: config.kafka?.clientId || 'integration-gateway',
          brokers: config.kafka?.brokers || ['localhost:9092'],
        });

        const admin = kafka.admin();
        await admin.connect();

        // Get consumer group info
        const groupId = config.kafka?.groupId || 'integration-processor';
        const topic = config.kafka?.topic || 'integration-events';

        // Fetch offsets for the consumer group
        const offsets = await admin.fetchOffsets({ groupId, topic });

        // Fetch topic metadata to get high watermarks (latest offsets)
        const topicMetadata = await admin.fetchTopicMetadata({ topics: [topic] });
        const partitionMetadata = topicMetadata.topics[0]?.partitions || [];

        // Calculate lag for each partition
        const partitions = offsets.map((offset) => {
          const metadata = partitionMetadata.find((p) => p.partitionId === offset.partition);
          const highWatermark = metadata?.high || 0;
          const currentOffset = parseInt(offset.offset, 10) || 0;
          const lag = Math.max(0, highWatermark - currentOffset);

          return {
            partition: offset.partition,
            offset: currentOffset,
            highWatermark,
            lag,
          };
        });

        await admin.disconnect();

        res.json({
          eventSource: 'kafka',
          consumerGroup: groupId,
          topic,
          partitions,
          totalLag: partitions.reduce((sum, p) => sum + p.lag, 0),
        });
      } catch (kafkaError) {
        log('error', 'Failed to fetch Kafka consumer group info', { error: kafkaError.message });

        // Fallback: Return basic info without offsets
        res.json({
          eventSource: 'kafka',
          consumerGroup: config.kafka?.groupId || 'integration-processor',
          topic: config.kafka?.topic || 'integration-events',
          error: 'Unable to fetch consumer group offsets',
          message: kafkaError.message,
        });
      }
    } else {
      res.status(400).json({
        error: 'Unknown event source type',
        eventSource: sourceType,
        code: 'INVALID_EVENT_SOURCE',
      });
    }
  } catch (err) {
    logError(err, { scope: 'checkpoint get' });
    res.status(500).json({ error: 'Failed to retrieve checkpoint', message: err.message, code: 'CHECKPOINT_ERROR' });
  }
});

router.patch('/checkpoint', async (req, res) => {
  try {
    const config = require('../config');
    const sourceType = config.eventSource?.type;

    if (!sourceType) {
      return res.status(400).json({
        error: 'No global event source configured',
        message: 'Use per-organization event source configuration via /event-sources.',
        code: 'EVENT_SOURCE_NOT_CONFIGURED',
      });
    }

    if (sourceType === 'mysql') {
      // MySQL: Allow manual checkpoint updates
      if (!mongodb.isConnected()) {
        return res.status(503).json({ error: 'Service unavailable', code: 'DB_NOT_CONNECTED' });
      }

      const { lastProcessedId } = req.body;
      if (lastProcessedId === undefined || lastProcessedId === null || !Number.isFinite(Number(lastProcessedId))) {
        return res.status(400).json({ error: 'lastProcessedId must be a valid number', code: 'VALIDATION_ERROR' });
      }

      await data.setWorkerCheckpoint(Number(lastProcessedId));
      log('info', 'Worker checkpoint updated via API', { lastProcessedId: Number(lastProcessedId) });
      res.json({ message: 'Checkpoint updated', lastProcessedId: Number(lastProcessedId) });
    } else if (sourceType === 'kafka') {
      // Kafka: Offsets are managed by Kafka, cannot be manually updated via API
      res.status(400).json({
        error: 'Kafka offsets cannot be manually updated',
        message: 'Consumer group offsets are managed by Kafka. Use Kafka admin tools to reset offsets if needed.',
        code: 'KAFKA_OFFSET_READONLY',
        suggestion: 'Use kafka-consumer-groups --reset-offsets command',
      });
    } else {
      res.status(400).json({
        error: 'Unknown event source type',
        eventSource: sourceType,
        code: 'INVALID_EVENT_SOURCE',
      });
    }
  } catch (err) {
    logError(err, { scope: 'checkpoint update' });
    res.status(500).json({ error: 'Failed to update checkpoint', message: err.message, code: 'CHECKPOINT_ERROR' });
  }
});

module.exports = router;
