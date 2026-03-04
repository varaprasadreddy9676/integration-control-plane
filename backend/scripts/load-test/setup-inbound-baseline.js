#!/usr/bin/env node

const { MongoClient } = require('mongodb');

const orgId = Number(process.env.LOAD_TEST_ORG_ID || 999);
const type = process.env.LOAD_TEST_TYPE || 'LOAD_TEST_BASELINE';
const targetUrl = process.env.LOAD_TEST_TARGET_URL || 'http://frontend/health';
const mongoUri = process.env.MONGODB_URI || 'mongodb://mongodb:27017/integration_gateway';
const databaseName = process.env.MONGODB_DATABASE || 'integration_gateway';

async function run() {
  if (!Number.isFinite(orgId) || orgId <= 0) {
    throw new Error(`Invalid LOAD_TEST_ORG_ID: ${process.env.LOAD_TEST_ORG_ID}`);
  }

  const client = new MongoClient(mongoUri);
  await client.connect();
  try {
    const db = client.db(databaseName);
    const now = new Date();

    const doc = {
      orgId,
      name: 'Load Test Baseline',
      type,
      direction: 'INBOUND',
      targetUrl,
      httpMethod: 'POST',
      inboundAuthType: 'NONE',
      inboundAuthConfig: {},
      outgoingAuthType: 'NONE',
      outgoingAuthConfig: {},
      requestTransformation: {
        mode: 'SCRIPT',
        script: 'return payload;',
      },
      responseTransformation: null,
      streamResponse: false,
      rateLimits: null,
      timeout: 5000,
      timeoutMs: 5000,
      retryCount: 1,
      contentType: 'application/json',
      maxInboundFileSizeMb: 50,
      isActive: true,
      actions: null,
      updatedAt: now,
      createdBy: 'load-test',
    };

    const filter = { orgId, type, direction: 'INBOUND' };
    const existing = await db.collection('integration_configs').findOne(filter, { projection: { _id: 1 } });
    let integrationId = null;
    let upserted = false;

    if (existing?._id) {
      integrationId = String(existing._id);
      await db.collection('integration_configs').updateOne(
        { _id: existing._id },
        { $set: { ...doc, updatedAt: now } }
      );
    } else {
      const insertResult = await db.collection('integration_configs').insertOne({
        ...doc,
        createdAt: now,
        updatedAt: now,
      });
      integrationId = String(insertResult.insertedId);
      upserted = true;
    }

    const payload = {
      ok: true,
      orgId,
      type,
      targetUrl,
      integrationId,
      upserted,
    };
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } finally {
    await client.close();
  }
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
