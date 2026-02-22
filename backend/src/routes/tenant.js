const express = require('express');
const data = require('../data');
const asyncHandler = require('../utils/async-handler');

const router = express.Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rid = req.orgId || Number(req.query.orgId);
    if (!rid) {
      return res.status(400).json({ error: 'orgId missing', code: 'VALIDATION_ERROR' });
    }
    const tenant = await data.getTenant(rid);
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found', code: 'NOT_FOUND' });
    }
    return res.json(tenant);
  })
);

module.exports = router;
