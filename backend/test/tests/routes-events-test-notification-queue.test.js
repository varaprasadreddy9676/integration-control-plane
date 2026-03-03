'use strict';

const express = require('express');
const request = require('supertest');
const fs = require('fs');

jest.mock('../../src/db', () => ({
  isConfigured: jest.fn(),
  query: jest.fn(),
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
}));

jest.mock('../../src/data', () => ({}));

jest.mock('../../src/mongodb', () => ({
  getDbSafe: jest.fn(),
}));

jest.mock('../../src/data/event-sources', () => ({
  enqueuePushEvent: jest.fn(),
}));

const db = require('../../src/db');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'user-1', role: 'ORG_ADMIN', orgId: 33 };
    req.orgId = 33;
    next();
  });
  const eventsRouter = require('../../src/routes/events');
  const errorHandler = require('../../src/middleware/error-handler');
  app.use('/api/v1/events', eventsRouter);
  app.use(errorHandler);
  return app;
}

describe('POST /api/v1/events/test-notification-queue', () => {
  let app;
  let readFileSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
    db.isConfigured.mockReturnValue(true);
    db.query.mockResolvedValue([{}]);

    readFileSpy = jest.spyOn(fs, 'readFileSync').mockImplementation((filePath) => {
      const normalizedPath = String(filePath).replace(/\\/g, '/');

      if (normalizedPath.includes('/setup/event-types.json')) {
        return JSON.stringify([
          { eventType: 'PATIENT_REGISTERED', samplePayload: { type: 'PATIENT_REGISTERED' } },
          { eventType: 'OP_VISIT_CREATED', samplePayload: { type: 'OP_VISIT_CREATED' } },
        ]);
      }

      throw new Error(`Unexpected file read: ${normalizedPath}`);
    });
  });

  afterEach(() => {
    if (readFileSpy) {
      readFileSpy.mockRestore();
    }
  });

  it('inserts events from setup/event-types.json as the canonical source', async () => {
    const res = await request(app).post('/api/v1/events/test-notification-queue').send({ orgId: 33, orgUnitRid: 33 });

    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(2);
    expect(res.body.eventTypes).toEqual(['PATIENT_REGISTERED', 'OP_VISIT_CREATED']);
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.query.mock.calls[0][0]).toContain('INSERT INTO notification_queue');
    expect(readFileSpy).toHaveBeenCalledTimes(1);
    expect(String(readFileSpy.mock.calls[0][0]).replace(/\\/g, '/')).toContain('/setup/event-types.json');
  });

  it('uses event-types.json as the single source and respects limit', async () => {
    readFileSpy.mockImplementation((filePath) => {
      const normalizedPath = String(filePath).replace(/\\/g, '/');

      if (normalizedPath.includes('/setup/event-types.json')) {
        return JSON.stringify([{ eventType: 'PATIENT_REGISTERED', samplePayload: { type: 'PATIENT_REGISTERED' } }]);
      }

      throw new Error(`Unexpected file read: ${normalizedPath}`);
    });

    const res = await request(app).post('/api/v1/events/test-notification-queue').send({ orgId: 33, orgUnitRid: 33, limit: 1 });

    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(1);
    expect(res.body.eventTypes).toEqual(['PATIENT_REGISTERED']);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('inserts schema events by requested eventTypes filter', async () => {
    readFileSpy.mockImplementation((filePath) => {
      const normalizedPath = String(filePath).replace(/\\/g, '/');

      if (normalizedPath.includes('/setup/event-types.json')) {
        return JSON.stringify([
          { eventType: 'PATIENT_REGISTERED', samplePayload: { type: 'PATIENT_REGISTERED' } },
          { eventType: 'OP_VISIT_CREATED', samplePayload: { type: 'OP_VISIT_CREATED' } },
          { eventType: 'LAB_REPORT_READY', samplePayload: { type: 'LAB_REPORT_READY' } },
        ]);
      }

      throw new Error(`Unexpected file read: ${normalizedPath}`);
    });

    const res = await request(app)
      .post('/api/v1/events/test-notification-queue')
      .send({ orgId: 33, orgUnitRid: 33, eventTypes: ['LAB_REPORT_READY'] });

    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(1);
    expect(res.body.eventTypes).toEqual(['LAB_REPORT_READY']);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('returns validation error instead of silently inserting zero rows when requested eventTypes do not match', async () => {
    const res = await request(app)
      .post('/api/v1/events/test-notification-queue')
      .send({ orgId: 33, orgUnitRid: 33, eventTypes: ['UNKNOWN_EVENT'] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.error).toContain('requested eventTypes');
    expect(db.query).not.toHaveBeenCalled();
  });
});
