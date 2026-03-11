'use strict';

const { mapLogFromMongo } = require('../../src/data/helpers');

describe('data helpers', () => {
  it('does not expose finishedAt as deliveredAt for failed logs', () => {
    const mapped = mapLogFromMongo({
      _id: { toString: () => 'log-1' },
      status: 'FAILED',
      createdAt: new Date('2026-03-11T10:00:00.000Z'),
      finishedAt: new Date('2026-03-11T10:01:00.000Z'),
      deliveredAt: null,
      request: {},
      response: {},
    });

    expect(mapped.deliveredAt).toBeUndefined();
    expect(mapped.finishedAt).toBe('2026-03-11T10:01:00.000Z');
  });
});
