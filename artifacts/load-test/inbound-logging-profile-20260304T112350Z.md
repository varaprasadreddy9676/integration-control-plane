# Inbound Logging Profile Benchmark (20260304T112350Z)

- Endpoint: `POST /api/v1/public/integrations/LOAD_TEST_BASELINE?orgId=999`
- Global limiter: disabled during run (`API_RATE_LIMIT_ENABLED=false`)
- Profiles:
  - `current`: `INBOUND_MINIMAL_LOGGING=false`
  - `minimal`: `INBOUND_MINIMAL_LOGGING=true`

| Connections | Current req/s | Minimal req/s | Req/s delta | Current lat avg (ms) | Minimal lat avg (ms) | Latency delta |
|---:|---:|---:|---:|---:|---:|---:|
| 20 | 120.75 | 1398.00 | +1057.76% | 164.66 | 13.81 | -91.61% |
| 50 | 129.95 | 1305.60 | +904.69% | 380.13 | 37.77 | -90.06% |
| 100 | 112.90 | 1377.60 | +1120.19% | 866.96 | 71.97 | -91.70% |

| Connections | Current p99 (ms) | Minimal p99 (ms) | Current non2xx | Minimal non2xx |
|---:|---:|---:|---:|---:|
| 20 | 284.00 | 28.00 | 0 | 0 |
| 50 | 715.00 | 74.00 | 0 | 0 |
| 100 | 1454.00 | 101.00 | 0 | 0 |

## Raw Files
- c=20
  - current: `/Users/sai/Documents/GitHub/integration-control-plane/artifacts/load-test/inbound-current-c20-20260304T112350Z.json`
  - minimal: `/Users/sai/Documents/GitHub/integration-control-plane/artifacts/load-test/inbound-minimal-c20-20260304T112350Z.json`
- c=50
  - current: `/Users/sai/Documents/GitHub/integration-control-plane/artifacts/load-test/inbound-current-c50-20260304T112350Z.json`
  - minimal: `/Users/sai/Documents/GitHub/integration-control-plane/artifacts/load-test/inbound-minimal-c50-20260304T112350Z.json`
- c=100
  - current: `/Users/sai/Documents/GitHub/integration-control-plane/artifacts/load-test/inbound-current-c100-20260304T112350Z.json`
  - minimal: `/Users/sai/Documents/GitHub/integration-control-plane/artifacts/load-test/inbound-minimal-c100-20260304T112350Z.json`

