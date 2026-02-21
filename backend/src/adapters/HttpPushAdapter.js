/**
 * HTTP Push Adapter (stub - Phase 2)
 *
 * Polls MongoDB pending_events collection for events pushed via
 * POST /api/v1/events/push.
 *
 * TODO (Phase 2): implement full polling loop.
 */

const { EventSourceAdapter } = require('./EventSourceAdapter');
const { log } = require('../logger');

class HttpPushAdapter extends EventSourceAdapter {
  constructor(config = {}) {
    super();
    if (!config.orgId) throw new Error('HttpPushAdapter: orgId is required');
    this.orgId = config.orgId;
  }

  async start(_handler) {
    log('info', `[HttpPush:${this.orgId}] Adapter registered (Phase 2 - not yet polling)`);
  }

  async stop() {
    log('info', `[HttpPush:${this.orgId}] Stopped`);
  }

  getName() {
    return `HttpPushAdapter[org=${this.orgId}]`;
  }
}

module.exports = { HttpPushAdapter };
