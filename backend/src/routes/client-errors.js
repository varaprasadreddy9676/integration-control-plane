const express = require('express');
const { log } = require('../logger');
const mongodb = require('../mongodb');
const { getOrgIdFromRequest } = require('../utils/org-context');

const router = express.Router();

// Log client-side errors
router.post('/', async (req, res) => {
  try {
    const { message, stack, context, url, userAgent, timestamp, type, category, source } = req.body;
    const orgId = getOrgIdFromRequest(req);

    // Determine error category and source
    const errorCategory = category || 'unknown';
    const errorSource = source || 'browser';  // 'browser' or 'server'

    // Log to app.log for immediate viewing (24 hours)
    log('error', `[${errorSource.toUpperCase()} ERROR - ${errorCategory}] ${message}`, {
      stack,
      context,
      url,
      userAgent,
      timestamp,
      type,
      category: errorCategory,
      source: errorSource,
      orgId,
      entityParentRid: orgId
    });

    // Save to MongoDB for retention (30 days)
    try {
      const db = await mongodb.getDbSafe();
      await db.collection('error_logs').insertOne({
        source: errorSource,
        category: errorCategory,
        level: 'error',
        message,
        stack,
        context,
        url,
        userAgent,
        type,
        orgId,
        entityParentRid: orgId,
        timestamp: new Date(timestamp),
        createdAt: new Date()
      });
    } catch (dbErr) {
      console.error('Failed to save error to MongoDB:', dbErr);
      // Don't fail the request if MongoDB save fails
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Failed to log client error:', err);
    res.status(500).json({ error: 'Failed to log error' });
  }
});

module.exports = router;
