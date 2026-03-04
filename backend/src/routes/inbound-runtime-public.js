const express = require('express');
const inboundIntegrationsRouter = require('./integrations');

const router = express.Router();

const runtimeHandler = inboundIntegrationsRouter.handleInboundRuntime;
const parseInboundRuntimeRequest = inboundIntegrationsRouter.parseInboundRuntimeRequest;

if (typeof runtimeHandler !== 'function' || typeof parseInboundRuntimeRequest !== 'function') {
  throw new Error('Inbound runtime handler is not available');
}

router.post('/:type', parseInboundRuntimeRequest, runtimeHandler);
router.put('/:type', parseInboundRuntimeRequest, runtimeHandler);
router.get('/:type', parseInboundRuntimeRequest, runtimeHandler);

module.exports = router;
