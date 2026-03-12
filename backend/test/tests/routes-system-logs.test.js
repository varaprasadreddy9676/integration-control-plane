'use strict';

const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const request = require('supertest');

const mockDb = {
  collection: jest.fn(() => ({
    createIndex: jest.fn().mockResolvedValue(undefined),
    insertOne: jest.fn().mockResolvedValue(undefined),
    findOne: jest.fn().mockResolvedValue(null),
    findOneAndUpdate: jest.fn().mockResolvedValue({ value: null }),
    updateOne: jest.fn().mockResolvedValue(undefined),
  })),
};

jest.mock('../../src/mongodb', () => ({
  getDbSafe: jest.fn().mockResolvedValue(mockDb),
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
}));

const buildApp = () => {
  const app = express();
  app.use(express.json());
  const router = require('../../src/routes/system-logs');
  app.use('/api/v1/system-logs', router);
  return app;
};

describe('System Logs Routes', () => {
  let tempRoot;
  let logDir;
  let processFile;

  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();
    tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'system-logs-route-'));
    logDir = path.join(tempRoot, 'logs');
    processFile = path.join(tempRoot, 'nohup.out');
    await fsp.mkdir(logDir, { recursive: true });
    process.env.SYSTEM_LOG_DIR = logDir;
    process.env.SYSTEM_PROCESS_LOG_FILE = processFile;
  });

  afterEach(async () => {
    delete process.env.SYSTEM_LOG_DIR;
    delete process.env.SYSTEM_PROCESS_LOG_FILE;
    if (tempRoot) {
      await fsp.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('reads rotated app logs and access logs with source filtering', async () => {
    const recentTimestamp = new Date(Date.now() - 60 * 1000).toISOString();
    const olderTimestamp = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    await fsp.writeFile(
      path.join(logDir, 'app-2026-03-12.log'),
      [
        JSON.stringify({ timestamp: olderTimestamp, level: 'info', message: '[SCHEDULER #1] old line', meta: {} }),
        JSON.stringify({ timestamp: recentTimestamp, level: 'info', message: '[SCHEDULER #9] Cycle started', meta: { worker: 'scheduler' } }),
      ].join('\n'),
      'utf8'
    );

    await fsp.writeFile(
      path.join(logDir, 'access-2026-03-12.log'),
      `${recentTimestamp} GET /api/v1/system-status?orgId=648 503 1047 - 31.285 ms\n`,
      'utf8'
    );

    const app = buildApp();

    const appRes = await request(app).get('/api/v1/system-logs?source=app');
    expect(appRes.status).toBe(200);
    expect(appRes.body.logs).toHaveLength(1);
    expect(appRes.body.logs[0].stream).toBe('app');
    expect(appRes.body.logs[0].message).toContain('Cycle started');

    const accessRes = await request(app).get('/api/v1/system-logs?source=access');
    expect(accessRes.status).toBe(200);
    expect(accessRes.body.logs).toHaveLength(1);
    expect(accessRes.body.logs[0].stream).toBe('access');
    expect(accessRes.body.logs[0].level).toBe('error');
    expect(accessRes.body.logs[0].meta.status).toBe(503);
  });

  it('returns a tail view for nohup.out', async () => {
    await fsp.writeFile(processFile, ['line one', 'line two', 'line three'].join('\n'), 'utf8');
    const app = buildApp();

    const res = await request(app).get('/api/v1/system-logs/process-tail?lines=2');

    expect(res.status).toBe(200);
    expect(res.body.fileExists).toBe(true);
    expect(res.body.returnedLines).toBe(2);
    expect(res.body.lines.map((line) => line.text)).toEqual(['line two', 'line three']);
  });
});
