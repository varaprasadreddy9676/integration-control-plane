# Inbound Load-Test Baseline

This baseline targets the public inbound runtime endpoint:

- `POST /api/v1/public/integrations/LOAD_TEST_BASELINE?orgId=999`

The setup script creates/updates one deterministic inbound integration in MongoDB:

- `orgId`: `999`
- `type`: `LOAD_TEST_BASELINE`
- `targetUrl`: `http://frontend/health`
- `method`: `POST`
- no inbound auth / no outbound auth / no retries

## Run

1. Start stack (recommended for benchmark run with high/disabled global API limiter):

```bash
API_RATE_LIMIT_ENABLED=false docker compose up -d --build
```

2. Execute baseline:

```bash
./scripts/load-test/run-inbound-baseline.sh
```

3. Reports are saved under:

- `artifacts/load-test/*.json`

## Compare Logging Profiles

Run current logging vs minimal inbound logging:

```bash
./scripts/load-test/run-inbound-logging-profile.sh
```

This runs both profiles with the same workload:

- `current`: `INBOUND_MINIMAL_LOGGING=false`
- `minimal`: `INBOUND_MINIMAL_LOGGING=true`

Outputs:

- `artifacts/load-test/inbound-current-c*-<timestamp>.json`
- `artifacts/load-test/inbound-minimal-c*-<timestamp>.json`
- `artifacts/load-test/inbound-logging-profile-<timestamp>.md`

## Tunables

- `CONNECTIONS` (default: `"20 50 100"`)
- `DURATION_SECONDS` (default: `20`)
- `WARMUP_SECONDS` (default: `8`)
- `LOAD_TEST_URL`
- `LOAD_TEST_PAYLOAD`
- `OUTPUT_DIR`
- `RESULT_PREFIX`
- `TIMESTAMP_OVERRIDE`

## Latest Measured Results (March 4, 2026)

Source: `artifacts/load-test/inbound-logging-profile-20260304T112350Z.md`

| Connections | Current req/s | Minimal req/s | Req/s delta | Current avg latency | Minimal avg latency |
|---:|---:|---:|---:|---:|---:|
| 20 | 120.75 | 1398.00 | +1057.76% | 164.66 ms | 13.81 ms |
| 50 | 129.95 | 1305.60 | +904.69% | 380.13 ms | 37.77 ms |
| 100 | 112.90 | 1377.60 | +1120.19% | 866.96 ms | 71.97 ms |

Interpretation:

- Current mode is dominated by per-request log persistence (`execution_logs` and rich request/response records).
- Minimal mode quantifies overhead by skipping rich inbound persistence writes while keeping runtime behavior for request handling.
