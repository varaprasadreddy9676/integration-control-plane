# Smoke Test for Worker.js Refactoring

This smoke test verifies that the worker.js refactoring (Phases 1-8) preserved all functionality.

## Quick Start

### 1. Get a Test Webhook URL

Visit [https://webhook.site](https://webhook.site) and copy your unique URL.

### 2. Configure the Test

Edit `smoke-test.js` and update these values:

```javascript
const CONFIG = {
  baseUrl: 'http://localhost:3545',
  tenantId: 1, // Your test tenant ID
  testWebhookUrl: 'https://webhook.site/YOUR-UNIQUE-ID', // Your webhook.site URL
  timeout: 30000,
};
```

### 3. Start the Server

```bash
npm start
# or
node src/index.js
```

### 4. Run the Smoke Test

In a new terminal:

```bash
cd backend
node smoke-test.js
```

## What the Test Covers

### ✅ Core Functionality Tests

1. **Server Health Check** - Verifies server is running
2. **Create Single Action Integration** - Tests integration creation
3. **Create Multi-Action Integration** - Tests multi-action setup
4. **Send Test Event** - Tests event API
5. **Event Processing & Delivery** - Verifies delivery-engine.js works
6. **Event Deduplication** - Tests event-deduplication.js
7. **Condition Evaluation** - Tests condition-evaluator.js
8. **Retry Mechanism** - Tests retry-handler.js
9. **Manual Replay** - Tests replayEvent function
10. **Worker Module Imports** - Tests all module exports

### 📦 Modules Being Tested

- `utils/event-utils.js` - Utility functions
- `processor/event-deduplication.js` - Deduplication cache
- `processor/condition-evaluator.js` - Condition evaluation
- `processor/delivery-engine.js` - Core delivery (CRITICAL - 1500 lines)
- `processor/event-processor.js` - Event orchestration
- `processor/retry-handler.js` - Retry & replay
- `processor/pending-deliveries-worker.js` - INBOUND worker
- `processor/worker.js` - Main worker (now 481 lines)

## Expected Output

### ✅ Success (Safe for Production)

```
==========================================================
📊 Test Summary
==========================================================

Total Tests: 10
✓ Passed: 10
✗ Failed: 0
⊘ Skipped: 0

🎉 All tests passed! Refactoring verified successful.
✅ SAFE TO DEPLOY TO PRODUCTION
```

### ❌ Failure (Review Required)

```
Total Tests: 10
✓ Passed: 8
✗ Failed: 2
⊘ Skipped: 0

Failed Tests:
  - Event Processing & Delivery: No logs found
  - Manual Replay: Status: 404

⚠️  Some tests failed. Please review before deploying.
❌ NOT RECOMMENDED FOR PRODUCTION
```

## Troubleshooting

### Test webhook is unreachable

If webhook.site is down, the test will show deliveries as RETRYING or FAILED. This is **expected behavior** - the important thing is that:
- Events are accepted
- Logs are created
- Retry mechanism kicks in

### No integrations created

Check:
- Is the tenant ID correct?
- Does your database connection work?
- Check server logs for errors

### Module import errors

This indicates a problem with the refactoring. Check:
- All 7 new modules exist
- No circular dependencies
- All exports are correct

## Manual Verification

After running the smoke test, you can also manually verify:

1. **Check webhook.site** - You should see HTTP requests if the URL was reachable
2. **Check logs UI** - Should show test events processed
3. **Check database** - Integrations and logs created

## Cleanup

The test automatically cleans up:
- Test integrations are deleted
- Test events remain in logs (for audit)

To manually clean up logs:
```bash
# Delete test logs from UI or via API
curl -X DELETE http://localhost:3545/api/logs/bulk \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: 1" \
  -d '{"ids": ["log-id-1", "log-id-2"]}'
```

## Next Steps

### If All Tests Pass ✅
- Deploy to staging (if available)
- Run smoke test in staging
- Deploy to production
- Monitor logs for errors

### If Tests Fail ❌
- Review error messages
- Check server logs
- Fix issues
- Re-run smoke test
- Do NOT deploy to production until all tests pass
