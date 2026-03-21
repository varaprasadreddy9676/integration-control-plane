'use strict';

const integrationDocs = [
  {
    _id: { toString: () => 'delayed-reminder' },
    orgId: 1,
    orgUnitRid: 1,
    name: 'Reminder from confirmation config',
    type: 'APPOINTMENT_CONFIRMATION',
    eventType: 'APPOINTMENT_CONFIRMATION',
    direction: 'OUTBOUND',
    isActive: true,
    scope: 'INCLUDE_CHILDREN',
    targetUrl: 'https://example.com/reminder',
    httpMethod: 'POST',
    outgoingAuthType: 'NONE',
    timeoutMs: 5000,
    retryCount: 3,
    transformationMode: 'SCRIPT',
    transformation: { script: 'return payload;' },
    deliveryMode: 'DELAYED',
    subjectExtraction: {
      mode: 'PATHS',
      paths: {
        appointment_id: 'appt.apptRID',
      },
    },
    lifecycleRules: [
      {
        eventTypes: ['APPOINTMENT_RESCHEDULED'],
        action: 'RESCHEDULE_PENDING',
        matchKeys: ['appointment_id'],
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    _id: { toString: () => 'direct-match' },
    orgId: 1,
    orgUnitRid: 1,
    name: 'Direct reschedule outbound',
    type: 'APPOINTMENT_RESCHEDULED',
    eventType: 'APPOINTMENT_RESCHEDULED',
    direction: 'OUTBOUND',
    isActive: true,
    scope: 'INCLUDE_CHILDREN',
    targetUrl: 'https://example.com/reschedule',
    httpMethod: 'POST',
    outgoingAuthType: 'NONE',
    timeoutMs: 5000,
    retryCount: 3,
    transformationMode: 'SCRIPT',
    transformation: { script: 'return payload;' },
    deliveryMode: 'IMMEDIATE',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    _id: { toString: () => 'immediate-should-not-backfill' },
    orgId: 1,
    orgUnitRid: 1,
    name: 'Immediate config with reschedule rule',
    type: 'APPOINTMENT_CONFIRMATION',
    eventType: 'APPOINTMENT_CONFIRMATION',
    direction: 'OUTBOUND',
    isActive: true,
    scope: 'INCLUDE_CHILDREN',
    targetUrl: 'https://example.com/immediate',
    httpMethod: 'POST',
    outgoingAuthType: 'NONE',
    timeoutMs: 5000,
    retryCount: 3,
    transformationMode: 'SCRIPT',
    transformation: { script: 'return payload;' },
    deliveryMode: 'IMMEDIATE',
    subjectExtraction: {
      mode: 'PATHS',
      paths: {
        appointment_id: 'appt.apptRID',
      },
    },
    lifecycleRules: [
      {
        eventTypes: ['APPOINTMENT_RESCHEDULED'],
        action: 'RESCHEDULE_PENDING',
        matchKeys: ['appointment_id'],
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

const integrationCollection = {
  find: jest.fn(() => ({
    sort: jest.fn().mockReturnThis(),
    toArray: jest.fn().mockResolvedValue(integrationDocs),
  })),
  distinct: jest.fn().mockResolvedValue([]),
  findOne: jest.fn((query) => {
    if (query?.orgId === 1) {
      return Promise.resolve({ orgId: 1 });
    }
    return Promise.resolve(null);
  }),
};

const mockDb = {
  collection: jest.fn((name) => {
    if (name === 'integration_configs') return integrationCollection;
    if (name === 'organizations' || name === 'org_units') return integrationCollection;
    throw new Error(`Unexpected collection: ${name}`);
  }),
};

jest.mock('../../src/mongodb', () => ({
  isConnected: jest.fn(() => true),
  getDbSafe: jest.fn().mockResolvedValue(mockDb),
  toObjectId: jest.fn((value) => value || null),
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
  logError: jest.fn(),
}));

jest.mock('../../src/services/integration-signing', () => ({
  generateSigningSecret: jest.fn(() => 'secret'),
}));

jest.mock('../../src/services/request-policy', () => ({
  normalizeRequestPolicy: jest.fn(() => null),
  normalizeRateLimit: jest.fn(() => null),
}));

const integrations = require('../../src/data/integrations');

describe('integrations processing eligibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    integrationCollection.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue(integrationDocs),
    });
    integrationCollection.findOne.mockImplementation((query) => {
      if (query?.orgId === 1) {
        return Promise.resolve({ orgId: 1 });
      }
      return Promise.resolve(null);
    });
  });

  it('includes delayed reschedule-pending integrations in the processing set for the rescheduled event', async () => {
    const result = await integrations.listIntegrationsForProcessing(1, 'APPOINTMENT_RESCHEDULED');

    expect(result.map((integration) => integration.id)).toEqual(['direct-match', 'delayed-reminder']);
  });
});
