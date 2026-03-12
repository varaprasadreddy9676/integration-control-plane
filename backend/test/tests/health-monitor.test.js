'use strict';

const os = require('os');
const v8 = require('v8');

jest.mock('../../src/data', () => ({
  getDashboardSummary: jest.fn(),
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
}));

jest.mock('../../src/services/analytics-aggregator', () => ({
  getIntegrationMetrics: jest.fn(),
  getErrorTrends: jest.fn(),
}));

describe('health-monitor memory metrics', () => {
  let healthMonitor;

  beforeEach(() => {
    jest.resetModules();
    healthMonitor = require('../../src/services/health-monitor');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reports node heap usage against heap limit instead of heapTotal', () => {
    jest.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: 160 * 1024 * 1024,
      heapTotal: 128 * 1024 * 1024,
      heapUsed: 96 * 1024 * 1024,
      external: 24 * 1024 * 1024,
      arrayBuffers: 0,
    });
    jest.spyOn(v8, 'getHeapStatistics').mockReturnValue({
      heap_size_limit: 4096 * 1024 * 1024,
    });
    jest.spyOn(os, 'totalmem').mockReturnValue(8192 * 1024 * 1024);
    jest.spyOn(os, 'freemem').mockReturnValue(2048 * 1024 * 1024);

    const stats = healthMonitor.getMemoryStats();

    expect(stats.nodeHeapUsedMB).toBe(96);
    expect(stats.nodeHeapTotalMB).toBe(128);
    expect(stats.nodeHeapLimitMB).toBe(4096);
    expect(stats.nodeHeapUsagePercent).toBe(2);

    expect(stats.used).toBe(96);
    expect(stats.total).toBe(4096);
    expect(stats.percentage).toBe(2);

    expect(stats.hostTotalMB).toBe(8192);
    expect(stats.hostFreeMB).toBe(2048);
    expect(stats.hostUsedMB).toBe(6144);
    expect(stats.hostUsagePercent).toBe(75);
  });
});
