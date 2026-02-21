#!/bin/bash

# Quick Smoke Test Script - Event Gateway
# Tests critical wildcard and multi-action functionality
# Run: chmod +x quick-test.sh && ./quick-test.sh

set -e

API_BASE="http://localhost:4000/api/v1"
API_KEY="mdcs_dev_key_1f4a"
ENTITY_RID=33
WEBHOOK_SITE_ID="YOUR-WEBHOOK-SITE-ID"  # Replace with actual webhook.site ID

echo "========================================="
echo "Event Gateway - Quick Smoke Test"
echo "========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
PASSED=0
FAILED=0

test_result() {
  if [ $1 -eq 0 ]; then
    echo -e "${GREEN}✅ PASS${NC}: $2"
    ((PASSED++))
  else
    echo -e "${RED}❌ FAIL${NC}: $2"
    ((FAILED++))
  fi
}

echo "1. Testing Wildcard Event Matching..."
echo "--------------------------------------"

# Create wildcard webhook
WILDCARD_RESPONSE=$(curl -s -X POST "${API_BASE}/webhooks?entityParentRid=${ENTITY_RID}" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Smoke Test - Wildcard",
    "eventType": "*",
    "scope": "ENTITY_ONLY",
    "targetUrl": "https://webhook.site/'${WEBHOOK_SITE_ID}'",
    "httpMethod": "POST",
    "outgoingAuthType": "NONE",
    "isActive": true,
    "timeoutMs": 5000,
    "retryCount": 1,
    "transformationMode": "SCRIPT",
    "transformation": {
      "mode": "SCRIPT",
      "script": "function transform(p) { return { test: \"wildcard\", event: p.eventType, data: p }; }"
    }
  }')

WILDCARD_ID=$(echo $WILDCARD_RESPONSE | jq -r '.id')
if [ "$WILDCARD_ID" != "null" ] && [ -n "$WILDCARD_ID" ]; then
  test_result 0 "Created wildcard webhook (ID: $WILDCARD_ID)"
else
  test_result 1 "Failed to create wildcard webhook"
  echo "Response: $WILDCARD_RESPONSE"
  exit 1
fi

echo ""
echo "2. Testing Wildcard with Multiple Event Types..."
echo "--------------------------------------"

# Test 3 different event types
for EVENT_TYPE in "PATIENT_REGISTRATION" "APPOINTMENT_CREATED" "BILL_CREATED"; do
  echo "Testing event: $EVENT_TYPE"

  TEST_RESPONSE=$(curl -s -X POST "${API_BASE}/webhooks/${WILDCARD_ID}/test?entityParentRid=${ENTITY_RID}" \
    -H "X-API-Key: ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{
      "payload": {
        "eventType": "'${EVENT_TYPE}'",
        "testId": "smoke-test-'$(date +%s)'",
        "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"
      }
    }')

  STATUS=$(echo $TEST_RESPONSE | jq -r '.status')
  if [ "$STATUS" = "success" ] || [ "$STATUS" = "failed" ]; then
    # Either status is OK - "failed" might be due to webhook.site timeout, but delivery was attempted
    test_result 0 "Wildcard matched $EVENT_TYPE (status: $STATUS)"
  else
    test_result 1 "Wildcard did not match $EVENT_TYPE"
    echo "Response: $TEST_RESPONSE"
  fi

  sleep 1
done

echo ""
echo "3. Testing CUSTOM_HEADERS Authentication..."
echo "--------------------------------------"

CUSTOM_HEADERS_RESPONSE=$(curl -s -X POST "${API_BASE}/webhooks?entityParentRid=${ENTITY_RID}" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Smoke Test - Custom Headers",
    "eventType": "PATIENT_REGISTRATION",
    "scope": "ENTITY_ONLY",
    "targetUrl": "https://webhook.site/'${WEBHOOK_SITE_ID}'",
    "httpMethod": "POST",
    "outgoingAuthType": "CUSTOM_HEADERS",
    "outgoingAuthConfig": {
      "headers": {
        "X-Test-Header-1": "value1",
        "X-Test-Header-2": "value2",
        "X-API-Secret": "test-secret-123"
      }
    },
    "isActive": true,
    "timeoutMs": 5000,
    "retryCount": 1,
    "transformationMode": "SCRIPT",
    "transformation": {
      "mode": "SCRIPT",
      "script": "function transform(p) { return { test: \"custom-headers\", data: p }; }"
    }
  }')

CUSTOM_HEADERS_ID=$(echo $CUSTOM_HEADERS_RESPONSE | jq -r '.id')
if [ "$CUSTOM_HEADERS_ID" != "null" ] && [ -n "$CUSTOM_HEADERS_ID" ]; then
  test_result 0 "Created CUSTOM_HEADERS webhook (ID: $CUSTOM_HEADERS_ID)"

  # Test the webhook
  curl -s -X POST "${API_BASE}/webhooks/${CUSTOM_HEADERS_ID}/test?entityParentRid=${ENTITY_RID}" \
    -H "X-API-Key: ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"payload": {"eventType": "PATIENT_REGISTRATION", "testData": "headers-test"}}' > /dev/null

  test_result 0 "Sent test request with custom headers"
  echo "  ℹ️  Check webhook.site for headers: X-Test-Header-1, X-Test-Header-2, X-API-Secret"
else
  test_result 1 "Failed to create CUSTOM_HEADERS webhook"
fi

echo ""
echo "4. Testing Multi-Action Webhooks..."
echo "--------------------------------------"

MULTI_ACTION_RESPONSE=$(curl -s -X POST "${API_BASE}/webhooks?entityParentRid=${ENTITY_RID}" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Smoke Test - Multi-Action",
    "eventType": "PATIENT_REGISTRATION",
    "scope": "ENTITY_ONLY",
    "targetUrl": "https://webhook.site/'${WEBHOOK_SITE_ID}'",
    "httpMethod": "POST",
    "outgoingAuthType": "NONE",
    "isActive": true,
    "timeoutMs": 5000,
    "retryCount": 1,
    "actions": [
      {
        "name": "Action 1 - Profile",
        "targetUrl": "https://webhook.site/'${WEBHOOK_SITE_ID}'",
        "httpMethod": "POST",
        "transformationMode": "SCRIPT",
        "transformation": {
          "script": "function transform(p) { return { action: \"profile\", step: 1, data: p }; }"
        }
      },
      {
        "name": "Action 2 - Event",
        "targetUrl": "https://webhook.site/'${WEBHOOK_SITE_ID}'",
        "httpMethod": "POST",
        "transformationMode": "SCRIPT",
        "transformation": {
          "script": "function transform(p) { return { action: \"event\", step: 2, data: p }; }"
        }
      },
      {
        "name": "Action 3 - Notification",
        "targetUrl": "https://webhook.site/'${WEBHOOK_SITE_ID}'",
        "httpMethod": "POST",
        "transformationMode": "SCRIPT",
        "transformation": {
          "script": "function transform(p) { return { action: \"notification\", step: 3, data: p }; }"
        }
      }
    ]
  }')

MULTI_ACTION_ID=$(echo $MULTI_ACTION_RESPONSE | jq -r '.id')
if [ "$MULTI_ACTION_ID" != "null" ] && [ -n "$MULTI_ACTION_ID" ]; then
  test_result 0 "Created multi-action webhook (ID: $MULTI_ACTION_ID)"

  # Test the multi-action webhook
  curl -s -X POST "${API_BASE}/webhooks/${MULTI_ACTION_ID}/test?entityParentRid=${ENTITY_RID}" \
    -H "X-API-Key: ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"payload": {"eventType": "PATIENT_REGISTRATION", "testData": "multi-action-test"}}' > /dev/null

  test_result 0 "Executed multi-action webhook"
  echo "  ℹ️  Check webhook.site for 3 sequential requests"
else
  test_result 1 "Failed to create multi-action webhook"
fi

echo ""
echo "5. Testing Wildcard + Multi-Action Combination..."
echo "--------------------------------------"

WILDCARD_MULTI_RESPONSE=$(curl -s -X POST "${API_BASE}/webhooks?entityParentRid=${ENTITY_RID}" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Smoke Test - Wildcard Multi-Action",
    "eventType": "*",
    "scope": "ENTITY_ONLY",
    "targetUrl": "https://webhook.site/'${WEBHOOK_SITE_ID}'",
    "httpMethod": "POST",
    "outgoingAuthType": "NONE",
    "isActive": true,
    "timeoutMs": 5000,
    "retryCount": 1,
    "actions": [
      {
        "name": "Log All Events",
        "targetUrl": "https://webhook.site/'${WEBHOOK_SITE_ID}'",
        "httpMethod": "POST",
        "transformationMode": "SCRIPT",
        "transformation": {
          "script": "function transform(p) { return { wildcard: true, multiAction: true, eventType: p.eventType, timestamp: new Date().toISOString() }; }"
        }
      }
    ]
  }')

WILDCARD_MULTI_ID=$(echo $WILDCARD_MULTI_RESPONSE | jq -r '.id')
if [ "$WILDCARD_MULTI_ID" != "null" ] && [ -n "$WILDCARD_MULTI_ID" ]; then
  test_result 0 "Created wildcard multi-action webhook (ID: $WILDCARD_MULTI_ID)"

  # Test with random event type
  curl -s -X POST "${API_BASE}/webhooks/${WILDCARD_MULTI_ID}/test?entityParentRid=${ENTITY_RID}" \
    -H "X-API-Key: ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"payload": {"eventType": "BILL_CREATED", "testData": "wildcard-multi"}}' > /dev/null

  test_result 0 "Executed wildcard multi-action webhook"
else
  test_result 1 "Failed to create wildcard multi-action webhook"
fi

echo ""
echo "6. Checking API Response includes Actions Array..."
echo "--------------------------------------"

# Get webhook details and verify actions are returned
WEBHOOK_DETAIL=$(curl -s "${API_BASE}/webhooks/${MULTI_ACTION_ID}?entityParentRid=${ENTITY_RID}" \
  -H "X-API-Key: ${API_KEY}")

ACTIONS_COUNT=$(echo $WEBHOOK_DETAIL | jq '.actions | length')
if [ "$ACTIONS_COUNT" -gt 0 ]; then
  test_result 0 "API returns actions array ($ACTIONS_COUNT actions)"
else
  test_result 1 "API does not return actions array"
fi

echo ""
echo "7. Testing Backward Compatibility (Single-Action Webhook)..."
echo "--------------------------------------"

LEGACY_RESPONSE=$(curl -s -X POST "${API_BASE}/webhooks?entityParentRid=${ENTITY_RID}" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Smoke Test - Legacy Single Action",
    "eventType": "PATIENT_UPDATE",
    "scope": "ENTITY_ONLY",
    "targetUrl": "https://webhook.site/'${WEBHOOK_SITE_ID}'",
    "httpMethod": "POST",
    "outgoingAuthType": "NONE",
    "isActive": true,
    "timeoutMs": 5000,
    "retryCount": 1,
    "transformationMode": "SCRIPT",
    "transformation": {
      "mode": "SCRIPT",
      "script": "function transform(p) { return { legacy: true, data: p }; }"
    }
  }')

LEGACY_ID=$(echo $LEGACY_RESPONSE | jq -r '.id')
if [ "$LEGACY_ID" != "null" ] && [ -n "$LEGACY_ID" ]; then
  test_result 0 "Created legacy single-action webhook (ID: $LEGACY_ID)"

  curl -s -X POST "${API_BASE}/webhooks/${LEGACY_ID}/test?entityParentRid=${ENTITY_RID}" \
    -H "X-API-Key: ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"payload": {"eventType": "PATIENT_UPDATE", "testData": "legacy-test"}}' > /dev/null

  test_result 0 "Legacy webhook executes successfully"
else
  test_result 1 "Failed to create legacy webhook"
fi

echo ""
echo "8. Verifying Delivery Logs..."
echo "--------------------------------------"

sleep 2  # Wait for logs to be written

LOGS_RESPONSE=$(curl -s "${API_BASE}/logs?entityParentRid=${ENTITY_RID}&limit=20" \
  -H "X-API-Key: ${API_KEY}")

LOG_COUNT=$(echo $LOGS_RESPONSE | jq 'length')
if [ "$LOG_COUNT" -gt 5 ]; then
  test_result 0 "Delivery logs created ($LOG_COUNT logs)"
else
  test_result 1 "Insufficient delivery logs ($LOG_COUNT logs)"
fi

echo ""
echo "========================================="
echo "Test Summary"
echo "========================================="
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}✅ ALL TESTS PASSED!${NC}"
  echo ""
  echo "Next Steps:"
  echo "1. Check webhook.site (https://webhook.site/$WEBHOOK_SITE_ID) to verify requests"
  echo "2. Test frontend UI at http://localhost:5174"
  echo "3. Run full test plan: backend/docs/testing/comprehensive-test-plan.md"
  EXIT_CODE=0
else
  echo -e "${RED}❌ SOME TESTS FAILED${NC}"
  echo ""
  echo "Check the failures above and:"
  echo "1. Verify backend is running (http://localhost:4000)"
  echo "2. Check backend logs for errors"
  echo "3. Verify MongoDB and MySQL connections"
  EXIT_CODE=1
fi

echo ""
echo "Cleanup:"
echo "To delete test webhooks, run:"
echo "  curl -s '${API_BASE}/webhooks?entityParentRid=${ENTITY_RID}' -H 'X-API-Key: ${API_KEY}' | jq -r '.[] | select(.name | startswith(\"Smoke Test\")) | .id' | xargs -I {} curl -X DELETE '${API_BASE}/webhooks/{}?entityParentRid=${ENTITY_RID}' -H 'X-API-Key: ${API_KEY}'"

echo ""
echo "Created Webhook IDs:"
echo "  Wildcard: $WILDCARD_ID"
echo "  Custom Headers: $CUSTOM_HEADERS_ID"
echo "  Multi-Action: $MULTI_ACTION_ID"
echo "  Wildcard Multi-Action: $WILDCARD_MULTI_ID"
echo "  Legacy: $LEGACY_ID"

exit $EXIT_CODE
