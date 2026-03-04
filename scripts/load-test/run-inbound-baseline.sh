#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTPUT_DIR="${OUTPUT_DIR:-$ROOT_DIR/artifacts/load-test}"
mkdir -p "$OUTPUT_DIR"

LOAD_TEST_ORG_ID="${LOAD_TEST_ORG_ID:-999}"
LOAD_TEST_TYPE="${LOAD_TEST_TYPE:-LOAD_TEST_BASELINE}"
LOAD_TEST_URL="${LOAD_TEST_URL:-http://localhost:3545/api/v1/public/integrations/$LOAD_TEST_TYPE?orgId=$LOAD_TEST_ORG_ID}"
LOAD_TEST_PAYLOAD="${LOAD_TEST_PAYLOAD:-{\"ping\":\"baseline\",\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}}"
WARMUP_SECONDS="${WARMUP_SECONDS:-8}"
DURATION_SECONDS="${DURATION_SECONDS:-20}"
CONNECTIONS="${CONNECTIONS:-20 50 100}"
RESULT_PREFIX="${RESULT_PREFIX:-inbound-baseline}"
TIMESTAMP="${TIMESTAMP_OVERRIDE:-$(date -u +%Y%m%dT%H%M%SZ)}"

echo "[load-test] root: $ROOT_DIR"
echo "[load-test] output: $OUTPUT_DIR"
echo "[load-test] url: $LOAD_TEST_URL"
echo "[load-test] connections: $CONNECTIONS"
echo "[load-test] duration: ${DURATION_SECONDS}s (warmup ${WARMUP_SECONDS}s)"

cd "$ROOT_DIR"

echo "[load-test] ensuring load-test inbound integration exists"
docker compose exec -T backend \
  env LOAD_TEST_ORG_ID="$LOAD_TEST_ORG_ID" LOAD_TEST_TYPE="$LOAD_TEST_TYPE" \
  node scripts/load-test/setup-inbound-baseline.js

echo "[load-test] warmup"
npx --yes autocannon@7.14.0 \
  -c 10 \
  -d "$WARMUP_SECONDS" \
  -p 1 \
  -m POST \
  -H "content-type: application/json" \
  -b "$LOAD_TEST_PAYLOAD" \
  "$LOAD_TEST_URL" >/dev/null

for c in $CONNECTIONS; do
  REPORT_PATH="$OUTPUT_DIR/${RESULT_PREFIX}-c${c}-${TIMESTAMP}.json"
  echo "[load-test] running c=$c -> $REPORT_PATH"
  npx --yes autocannon@7.14.0 \
    --json \
    --renderStatusCodes \
    -c "$c" \
    -d "$DURATION_SECONDS" \
    -p 1 \
    -m POST \
    -H "content-type: application/json" \
    -b "$LOAD_TEST_PAYLOAD" \
    "$LOAD_TEST_URL" >"$REPORT_PATH"
done

echo "[load-test] summary"
for f in "$OUTPUT_DIR"/"${RESULT_PREFIX}"-c*-"$TIMESTAMP".json; do
  node -e '
const fs = require("fs");
const f = process.argv[1];
const d = JSON.parse(fs.readFileSync(f, "utf8"));
const p = d.latency || {};
const r = d.requests || {};
const e = d.errors || 0;
const t = d.timeouts || 0;
const statuses = d["1xx"] || d["2xx"] || d["3xx"] || d["4xx"] || d["5xx"] ? {
  "1xx": d["1xx"] || 0,
  "2xx": d["2xx"] || 0,
  "3xx": d["3xx"] || 0,
  "4xx": d["4xx"] || 0,
  "5xx": d["5xx"] || 0
} : null;
console.log(`${f}
  req_avg=${r.average || 0}/s req_p97_5=${r.p97_5 || 0}/s
  lat_avg=${p.average || 0}ms lat_p97_5=${p.p97_5 || 0}ms lat_p99=${p.p99 || 0}ms
  errors=${e} timeouts=${t}${statuses ? ` status=${JSON.stringify(statuses)}` : ""}`);
' "$f"
done

echo "[load-test] done"
