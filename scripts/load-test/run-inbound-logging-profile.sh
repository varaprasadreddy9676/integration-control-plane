#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTPUT_DIR="${OUTPUT_DIR:-$ROOT_DIR/artifacts/load-test}"
CONNECTIONS="${CONNECTIONS:-20 50 100}"
DURATION_SECONDS="${DURATION_SECONDS:-20}"
WARMUP_SECONDS="${WARMUP_SECONDS:-8}"
TIMESTAMP="${TIMESTAMP_OVERRIDE:-$(date -u +%Y%m%dT%H%M%SZ)}"

mkdir -p "$OUTPUT_DIR"
cd "$ROOT_DIR"

run_profile() {
  local profile="$1"
  local minimal="$2"
  local prefix="inbound-${profile}"

  echo "[profile] ${profile} (INBOUND_MINIMAL_LOGGING=${minimal})"
  API_RATE_LIMIT_ENABLED=false INBOUND_MINIMAL_LOGGING="$minimal" docker compose up -d --build backend >/dev/null

  RESULT_PREFIX="$prefix" \
  TIMESTAMP_OVERRIDE="$TIMESTAMP" \
  CONNECTIONS="$CONNECTIONS" \
  DURATION_SECONDS="$DURATION_SECONDS" \
  WARMUP_SECONDS="$WARMUP_SECONDS" \
  ./scripts/load-test/run-inbound-baseline.sh
}

run_profile "current" "false"
run_profile "minimal" "true"

SUMMARY_PATH="$OUTPUT_DIR/inbound-logging-profile-${TIMESTAMP}.md"

node - "$OUTPUT_DIR" "$TIMESTAMP" "$CONNECTIONS" "$SUMMARY_PATH" <<'NODE'
const fs = require('fs');
const path = require('path');

const [outDir, ts, connRaw, summaryPath] = process.argv.slice(2);
const conns = connRaw.trim().split(/\s+/).filter(Boolean);

function readMetrics(profile, c) {
  const file = path.join(outDir, `inbound-${profile}-c${c}-${ts}.json`);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {
    file,
    reqAvg: Number(raw?.requests?.average || 0),
    reqTotal: Number(raw?.requests?.total || 0),
    latAvg: Number(raw?.latency?.average || 0),
    latP99: Number(raw?.latency?.p99 || 0),
    errors: Number(raw?.errors || 0),
    timeouts: Number(raw?.timeouts || 0),
    non2xx: Number(raw?.non2xx || 0),
  };
}

function pctChange(next, prev) {
  if (!prev) return 0;
  return ((next - prev) / prev) * 100;
}

const rows = conns.map((c) => {
  const current = readMetrics('current', c);
  const minimal = readMetrics('minimal', c);
  return {
    c,
    current,
    minimal,
    reqDeltaPct: pctChange(minimal.reqAvg, current.reqAvg),
    latDeltaPct: pctChange(minimal.latAvg, current.latAvg),
  };
});

const lines = [];
lines.push(`# Inbound Logging Profile Benchmark (${ts})`);
lines.push('');
lines.push('- Endpoint: `POST /api/v1/public/integrations/LOAD_TEST_BASELINE?orgId=999`');
lines.push('- Global limiter: disabled during run (`API_RATE_LIMIT_ENABLED=false`)');
lines.push('- Profiles:');
lines.push('  - `current`: `INBOUND_MINIMAL_LOGGING=false`');
lines.push('  - `minimal`: `INBOUND_MINIMAL_LOGGING=true`');
lines.push('');
lines.push('| Connections | Current req/s | Minimal req/s | Req/s delta | Current lat avg (ms) | Minimal lat avg (ms) | Latency delta |');
lines.push('|---:|---:|---:|---:|---:|---:|---:|');
for (const row of rows) {
  lines.push(
    `| ${row.c} | ${row.current.reqAvg.toFixed(2)} | ${row.minimal.reqAvg.toFixed(2)} | ${row.reqDeltaPct >= 0 ? '+' : ''}${row.reqDeltaPct.toFixed(2)}% | ${row.current.latAvg.toFixed(2)} | ${row.minimal.latAvg.toFixed(2)} | ${row.latDeltaPct >= 0 ? '+' : ''}${row.latDeltaPct.toFixed(2)}% |`
  );
}
lines.push('');
lines.push('| Connections | Current p99 (ms) | Minimal p99 (ms) | Current non2xx | Minimal non2xx |');
lines.push('|---:|---:|---:|---:|---:|');
for (const row of rows) {
  lines.push(`| ${row.c} | ${row.current.latP99.toFixed(2)} | ${row.minimal.latP99.toFixed(2)} | ${row.current.non2xx} | ${row.minimal.non2xx} |`);
}
lines.push('');
lines.push('## Raw Files');
for (const row of rows) {
  lines.push(`- c=${row.c}`);
  lines.push(`  - current: \`${row.current.file}\``);
  lines.push(`  - minimal: \`${row.minimal.file}\``);
}
lines.push('');

fs.writeFileSync(summaryPath, `${lines.join('\n')}\n`);
console.log(summaryPath);
NODE

echo "[profile] summary: $SUMMARY_PATH"
