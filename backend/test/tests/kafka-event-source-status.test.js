'use strict';

jest.mock('kafkajs', () => ({
  Kafka: jest.fn(),
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
  logError: jest.fn(),
}));

const { KafkaEventSource } = require('../../src/adapters/KafkaEventSource');

describe('KafkaEventSource.getRuntimeStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-11T10:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('exposes reconnect timing/backoff fields when reconnect is scheduled', () => {
    const adapter = new KafkaEventSource({
      orgId: 812,
      brokers: ['kafka-1:9092'],
      topic: 'integration-events',
    });

    adapter._scheduleReconnect(5000, 'consumer_disconnect');

    const status = adapter.getRuntimeStatus();

    expect(status.connectionStatus).toBe('reconnecting');
    expect(status.reconnectAttempt).toBe(1);
    expect(status.lastReconnectReason).toBe('consumer_disconnect');
    expect(status.lastBackoffMs).toBe(5000);
    expect(status.nextReconnectAt).toBe('2026-03-11T10:00:05.000Z');
  });

  it('clears reconnect timing fields after a successful connection', async () => {
    const adapter = new KafkaEventSource({
      orgId: 812,
      brokers: ['kafka-1:9092'],
      topic: 'integration-events',
    });

    adapter._scheduleReconnect(5000, 'consumer_disconnect');
    adapter.connected = true;
    adapter.reconnecting = false;
    adapter.lastConnectAt = new Date('2026-03-11T10:00:10.000Z');
    adapter.reconnectAttempt = 0;
    adapter.lastReconnectReason = null;
    adapter.lastBackoffMs = null;
    adapter.nextReconnectAt = null;

    const status = adapter.getRuntimeStatus();

    expect(status.connectionStatus).toBe('connected');
    expect(status.reconnectAttempt).toBe(0);
    expect(status.lastReconnectReason).toBeNull();
    expect(status.lastBackoffMs).toBeNull();
    expect(status.nextReconnectAt).toBeNull();
  });
});
