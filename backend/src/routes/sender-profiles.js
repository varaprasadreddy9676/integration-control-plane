const express = require('express');
const auth = require('../middleware/auth');
const asyncHandler = require('../utils/async-handler');
const senderProfiles = require('../data/sender-profiles');

const router = express.Router();

router.use(auth.requireEntity);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const profiles = await senderProfiles.listSenderProfiles(req.orgId);
    res.json({ items: profiles });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const profile = await senderProfiles.createSenderProfile(req.orgId, req.body || {}, {
      createdBy: req.user?.email || req.user?.id || 'system',
    });
    res.status(201).json({ item: profile });
  })
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const profile = await senderProfiles.updateSenderProfile(req.orgId, req.params.id, req.body || {});
    res.json({ item: profile });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await senderProfiles.deleteSenderProfile(req.orgId, req.params.id);
    res.json({ success: true });
  })
);

module.exports = router;
