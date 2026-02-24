# Integration Gateway Roadmap

> Strategic plan for evolving the Integration Gateway into the leading open-source integration platform for multi-tenant SaaS applications.

---

## Current Status: v1.0.0 (Released Q1 2026)

The Integration Gateway is production-ready with a comprehensive feature set for managing outbound webhooks, inbound API proxies, and scheduled automation workflows.

### Delivered Features

#### Core Integration Engine
- Event-driven delivery engine with automatic retries and exponential backoff
- Outbound webhooks with HMAC-SHA256 request signing
- Inbound API proxy with request/response transformation
- Scheduled automation (DELAYED, RECURRING, and CRON-based batch jobs)
- Multi-action workflows (email + SMS + webhook sequences)
- Dead Letter Queue (DLQ) with automatic retry and manual recovery

#### Multi-Tenancy & Security
- Complete organization isolation with parent-child hierarchy support
- RBAC system with 7 built-in roles and 52 granular permissions
- Custom role creation with feature-level permissions
- Audit logging for all configuration changes
- OAuth 2.0 token expiration detection and auto-refresh
- Secure VM sandbox for JavaScript execution (60s timeout, no eval/WebAssembly)
- Per-org event catalogue with global templates and org-specific event type management

#### Data Sources & Transformation
- MySQL event source polling with checkpoint-based processing
- JavaScript-based payload transformation (SIMPLE + SCRIPT modes)
- Lookup tables for field value resolution
- External MongoDB connectivity for scheduled jobs
- Internal API data fetching for batch operations
- Variable substitution ({{config.tenantId}}, {{date.today()}}, {{env.*}})

#### Observability & Monitoring
- Distributed tracing with correlation IDs across all execution steps
- Comprehensive execution logs with request/response capture
- Step-by-step execution breakdowns for debugging
- Dashboard analytics with real-time success rates and error tracking
- Full-text audit log search across all fields
- Scheduled job execution history with data flow visibility

#### Developer Experience
- React 18 + TypeScript frontend with Ant Design UI
- RESTful API with comprehensive error handling
- Docker & Docker Compose deployment support
- PM2 process management
- Biome code formatter and linter
- Extensive documentation (architecture, guides, API reference)

#### Communication Channels
- Email support (SMTP, Gmail OAuth, Outlook OAuth)
- SMS via Twilio integration
- Template-based messaging

---

## v1.1.0 - Reliability & Developer Productivity (Q2 2026)

**Theme**: Make the existing system more debuggable, secure, and productive before adding new protocols.

> Priority order reflects actual user impact — features are listed highest-value first.

---

### 1. Enhanced Error Categorization ⬅ Start here

**Problem**: Raw HTTP status codes and stack traces make debugging slow. Users can't tell if a failure is transient (retry) or permanent (fix config).

**Solution**: Classify every error at delivery time. Drive smarter retry decisions from the classification.

**Error categories**:
- `NETWORK` — connection refused, DNS failure, TCP timeout
- `TIMEOUT` — response exceeded deadline
- `AUTH` — 401/403 responses
- `RATE_LIMIT` — 429 with or without `Retry-After` header
- `VALIDATION` — 400/422 — bad payload, schema mismatch
- `SERVER_ERROR` — 5xx on the target side
- `CLIENT_ERROR` — unclassified 4xx

**Smart retry rules** (replaces current "always retry" logic):
- `AUTH` → don't retry, surface as config error immediately
- `RATE_LIMIT` with `Retry-After` header → wait exactly that long, then retry
- `NETWORK` / `TIMEOUT` → exponential backoff (current behaviour)
- `VALIDATION` → configurable: skip retry (STRICT) or retry (LAX)
- `SERVER_ERROR` → retry with backoff

**UI additions**:
- Error category badge on log/DLQ entries
- Inline troubleshooting hint per category (e.g., "Check API key rotation" for AUTH)
- DLQ filter by error category

**Technical approach**:
- Classify in delivery engine after each attempt
- Store `errorCategory` field on execution log documents
- MongoDB index on `errorCategory` for DLQ filtering

**Impact**: Fastest debugging improvement possible — no new infra, backend-only.

---

### 3. Retry-After Header Support

**Problem**: Rate-limited APIs return `Retry-After: 30` but the current exponential backoff ignores this header and retries too soon, getting the integration temporarily banned.

**Solution**: When a 429 is received, read `Retry-After` (seconds) or `X-RateLimit-Reset` (epoch) and schedule the retry at exactly that time instead of using backoff.

**Technical approach**:
- In retry handler, after 429: extract header, compute `nextRetryAt = now + retryAfterSeconds`
- Store `nextRetryAt` on the delivery record
- Pending deliveries worker respects `nextRetryAt` before picking up

**Impact**: Prevents ban/blacklist scenarios, reduces DLQ noise from rate-limited integrations. Small backend change, high operational value.

---

### 4. Webhook Signature Verification — Inbound

**Problem**: Inbound integrations accept any HTTP request. Without signature verification, there's no proof that requests come from the expected source (Stripe, GitHub, Shopify, etc.).

**Solution**: Per-inbound-integration HMAC verification with support for common signing formats.

**Supported formats**:
- **Stripe**: `Stripe-Signature: t=<ts>,v1=<sig>` — HMAC-SHA256 over `ts.body`
- **GitHub**: `X-Hub-Signature-256: sha256=<sig>` — HMAC-SHA256 over raw body
- **Generic**: custom header name + HMAC-SHA256 over raw body

**Features**:
- Per-integration: enable/disable signature verification
- Configurable: signing secret, header name, algorithm, tolerance window (default 5 min replay protection)
- Requests failing verification → 401, logged, not processed
- UI: verification config section in inbound integration settings

**Technical approach**:
- Middleware added to inbound route handler, runs before transformation
- Raw body must be preserved (use `express.raw()` before `json()`)
- Signing secret stored encrypted (same pattern as existing secrets)

**Impact**: Blocking requirement for any production Stripe/GitHub integration. Two hours of backend work.

---

### 5. Integration Health Scores

**Problem**: A list of integrations with no health signal forces users to check logs to know if something is degrading.

**Solution**: Calculate a 0–100 health score per integration from existing data. No new data collection needed.

**Score formula**:
```
score = (successRate * 0.5) + (responseTimeScore * 0.25) + (dlqScore * 0.15) + (uptimeScore * 0.10)

successRate    = (successes / total) * 100 over last 24h
responseTimeScore = max(0, 100 - (avgResponseMs / 20))   // 0ms=100, 2000ms=0
dlqScore       = max(0, 100 - (dlqCount * 5))             // 0 entries=100, 20+=0
uptimeScore    = 100 if worker running and last event <1h ago, else 0
```

**UI**:
- Score badge (colored ring: green ≥80, amber 60–79, red <60) on integration list cards
- Trend arrow (7-day direction)
- "Unhealthy integrations" alert on the dashboard if any score <60
- Tooltip with score breakdown on hover

**Technical approach**:
- New aggregation endpoint: `GET /api/v1/integrations/:id/health`
- Computed on-demand (cached 5 min in memory), not stored
- Frontend polls every 5 min (same pattern as DLQ badge)

**Impact**: Ops teams immediately latch onto a visible health number. No new infra.

---

### 6. Webhook Payload Validation

**Problem**: Malformed payloads cause delivery failures and DLQ buildup. Failures only surface after the attempt, wasting retry cycles.

**Solution**: Optional JSON Schema validation step before transformation. Invalid payloads rejected early with clear error messages.

**Validation modes**:
- **STRICT** — reject the event immediately, log the validation error, don't retry
- **LAX** — log the validation error but attempt delivery anyway
- **TRANSFORM** — coerce types and fill defaults before delivery

**Features**:
- Per-integration JSON Schema attached in settings
- UI: raw textarea for now (full visual builder is future scope)
- Validation errors stored in execution logs with field-level detail
- Dashboard metric: validation failure rate per integration

**Technical approach**:
- `ajv` (JSON Schema draft-07) added to backend dependencies
- Pre-validation step in delivery engine, before transformation
- `validationSchema` + `validationMode` fields on integration config document

**Impact**: Estimated 30-40% DLQ reduction for orgs that enable it.

---

### 7. GraphQL API Support

**Problem**: Modern platforms (Shopify, GitHub, Hasura, Contentful) use GraphQL; current system only supports REST.

**Solution**: Native GraphQL query/mutation support for outbound delivery.

**Features**:
- `protocol` field on integration config: `REST` | `GRAPHQL`
- `graphqlConfig`: endpoint, query/mutation string, variable mapping from payload
- GraphQL-specific error handling (validation errors, execution errors)
- Schema introspection for auto-completion in UI (future)
- GraphQL Playground in settings for test firing

**Technical approach**:
- `graphql-request` library for client execution
- New delivery handler branch for `GRAPHQL` protocol
- Response transformation works the same as REST

**Note**: Deprioritized relative to items 1–6 above. Implement once the reliability baseline is solid.

---

## v1.2.0 - Resilience & Scale (Q3 2026)

**Theme**: Handle failure modes gracefully at higher volumes.

---

### 1. Advanced Circuit Breaker

**Problem**: Current circuit breaker is binary: 5 consecutive failures → disable entirely. No automatic recovery, no manual control.

**Solution**: Three-state circuit breaker with configurable thresholds and auto-recovery.

**States**:
- `CLOSED` — normal operation
- `OPEN` — integration suspended, requests rejected immediately (no delivery attempt)
- `HALF_OPEN` — probe mode: allow 1–3 test requests through; if they succeed → CLOSED, if any fail → OPEN with exponential recovery delay

**Configurable thresholds**:
- Failure rate (e.g., >50% in 5 minutes)
- Consecutive failure count (e.g., 5 in a row)
- Minimum request count before opening (e.g., 10 requests)
- Recovery timeout (1–60 minutes, default 5)

**Dashboard additions**:
- Circuit state badge per integration (CLOSED/OPEN/HALF_OPEN)
- State change history timeline
- Manual override: force-open (pause) / force-close (resume) — critical for ops
- Alert on state change

**Technical approach**:
- Circuit breaker state machine in Redis (supports multi-instance)
- Config stored on integration document
- Delivery engine checks state before attempting

**Impact**: Prevents cascading failures. Manual override is the most immediately requested ops feature.

---

### 2. Request Batching

**Problem**: High-volume integrations make one HTTP call per event. At 10,000 events/day, that's 10,000 API calls — expensive and often unnecessary.

**Solution**: Configurable batching: collect N events or wait T seconds, then send as a single HTTP call.

**Configuration**:
- `batchSize`: max events per batch (default: 1 = no batching, max: 500)
- `batchTimeout`: flush interval in seconds (default: 5)
- Batch format: `{ events: [...] }` wrapper, or configurable via transformation

**Technical approach**:
- Batch accumulator in worker (in-memory buffer, flushed to Redis on shutdown)
- Delivery engine sends array payload instead of single payload
- Execution log records individual event IDs that were batched
- Retry on batch failure: retry entire batch or split and retry individually (configurable)

**Impact**: Major cost reduction for high-volume integrations. Reduces API calls proportionally to batch size.

---

### 3. Native Kafka Source/Sink Support

**Problem**: Many enterprise systems use Kafka for event streaming; current Kafka support is basic polling.

**Solution**: Full Kafka consumer (source) and producer (sink) with enterprise features.

**Kafka Event Source** (Consumer):
- Consumer group management with automatic partition assignment
- Offset management with manual commit control
- Dead letter topic for failed messages
- Schema Registry integration (Avro, Protobuf, JSON Schema)
- SASL/SSL authentication
- Multi-cluster support

**Kafka Event Sink** (Producer):
- Deliver transformed events to Kafka topics instead of (or in addition to) HTTP
- Configurable partitioning (key-based, round-robin, custom)
- At-least-once delivery guarantees
- Compression support (gzip, snappy, lz4)

**Kafka-to-Kafka Pipelines**:
- Source topic → Transform → Sink topic
- Multi-topic fan-out

**Technical approach**:
- Extend existing `KafkaEventSource` adapter
- New `KafkaSink` delivery target alongside HTTP
- `kafkajs` already available in the backend

**Impact**: Reduces event latency from ~5s (MySQL polling) to <100ms. Unlocks enterprise streaming use cases.

---

### 4. Advanced Retry Strategies

**Problem**: One-size-fits-all exponential backoff doesn't match the behaviour of all target APIs.

**Solution**: Per-integration configurable retry strategy.

**Strategies**:
- **Exponential backoff with jitter** — current default
- **Linear backoff** — better for rate-limited APIs with predictable windows
- **Custom schedule** — retry after 1m, 5m, 15m, 1h, then give up
- **Retry until time** — retry until EOD, then DLQ
- **No retry** — fail immediately to DLQ (useful for idempotency-sensitive targets)

**Technical approach**:
- `retryStrategy` field on integration config
- Retry handler reads strategy and computes `nextRetryAt` accordingly
- Existing exponential backoff becomes the default strategy

---

### 5. Rate Limiter Improvements

- Token bucket algorithm (more flexible than current sliding window)
- Distributed rate limiting via Redis (works across multiple backend instances)
- Per-user rate limits in addition to per-integration
- Burst allowance configuration
- Standard rate limit headers in API responses (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`)

---

## v2.0.0 - Enterprise Scale & Observability (Q4 2026)

**Theme**: Production-grade monitoring and global deployment.

---

### 1. Distributed Tracing with OpenTelemetry

**Problem**: Current correlation IDs cover the gateway's own execution but don't propagate context to external services or aggregate across components.

**Solution**: Full OpenTelemetry instrumentation with export to standard observability backends.

**Features**:
- Instrument all services with OpenTelemetry SDK
- Auto-instrumentation: HTTP, MongoDB, MySQL
- Manual spans: transformation, lookup resolution, circuit breaker decisions
- Propagate `traceparent` header to delivery targets
- Export to: Jaeger, Zipkin, Honeycomb, Datadog, New Relic
- Sampling: always sample errors, 10% sample successes

**Technical approach**:
- `@opentelemetry/sdk-node` with auto-instrumentation packages
- Jaeger all-in-one for local development
- OpenTelemetry Collector for production aggregation

**Impact**: Reduces MTTR by 60%. Critical for multi-service debugging.

---

### 2. Built-In Monitoring Dashboard

**Problem**: Analytics are per-integration. No system-wide operational view for DevOps.

**Solution**: Grafana + Prometheus stack with pre-built dashboards.

**Dashboards**:
- **Operations**: Worker status, DB pool utilization, memory/CPU, API latency (p50/p95/p99)
- **Integration Health**: Success rate, error rate, DLQ depth per integration
- **Performance**: Throughput, processing lag, batch sizes
- **SLO**: Error budget tracking, burn rate alerts

**Alerting**:
- Worker stopped >5 minutes
- DLQ size >1000
- Error rate >10% for 5 minutes
- API latency p95 >500ms

**Technical approach**:
- Prometheus metrics endpoint on backend (`/metrics`)
- Pre-built Grafana dashboard JSON exports in the repo
- Alert Manager for routing (Slack, Email, PagerDuty, webhook)

---

### 3. Multi-Region Deployment

**Problem**: Global customers experience latency. Compliance requirements (GDPR, HIPAA) demand data residency.

**Solution**: Active-active multi-region with geo-routing and data residency controls.

**Features**:
- Regional deployment (US-East, US-West, EU, APAC)
- DNS-based geo-routing to nearest region
- Automatic failover to secondary region
- Per-org data residency config
- Cross-region dashboard

**Technical approach**:
- MongoDB Atlas global clusters with zone-based sharding
- Regional Kubernetes clusters (Helm)
- Global load balancer (AWS Route 53 or Cloudflare)
- Regional Redis clusters

---

### 4. Advanced Retry Scheduling

- Configurable retry policies per integration with full UI
- Retry until specific deadline (e.g., retry until EOD, then give up permanently)
- Historical retry schedule visualization

---

### 5. Integration Testing Framework

- Synthetic monitoring: test integrations on a schedule with real payloads
- Pre-deployment integration tests before enabling a new integration
- Canary deployments with automatic rollback on test failure

---

### 6. Audit Trail Enhancements

- Audit log export (CSV, JSON) for compliance reporting
- Configurable retention policies (e.g., keep for 7 years)
- GDPR/HIPAA compliance checklist per org

---

## Beyond v2.0.0 — Future Considerations

### Integration Templates Marketplace

> Deprioritized from v1.1.0. This is primarily a content problem (requires curating 50+ quality templates) not an infrastructure problem. Build the infrastructure first, curate templates when there's community appetite.

- Template gallery with one-click deploy
- Categories: CRM, Communication, Analytics, Payment, Healthcare
- Community submissions with ratings
- Template export/import across orgs

---

### Low-Code Integration Builder

- Visual workflow builder (drag-and-drop)
- No-code transformation builder
- Pre-built connector library

---

### AI-Native Implementation Backlog

> Scope note: The AI Wizard is removed and out of scope. This backlog covers runtime AI operations, safety/compliance, and grounded intelligence. **Do not skip Phase 0–1** to get to RAG features — Phase 1 (PHI/PII redaction + risk-tier gating) is a legal and compliance prerequisite.

#### Phase 0 — Foundation (complete before any AI ops work)
- Define AI product KPIs: MTTR reduction, failed-delivery recovery rate, false-fix rate, % incidents auto-resolved
- Define risk matrix for AI actions: `read-only` → `recommendation` → `patch-proposal` → `auto-apply`
- Extend AI telemetry schema: model, latency, token usage, estimated cost, confidence, linked operational outcome

#### Phase 1 — Safety and Compliance Layer (prerequisite for all subsequent phases)
- PHI/PII redaction middleware for all `/api/v1/ai/*` endpoints before provider calls
- Prompt/response policy checks: block credential leaks, unsafe code suggestions, disallowed targets
- Explainability bundle per AI action: input context hash, guardrail decisions, model metadata, decision rationale
- Auditable traces for all AI-generated recommendations and applied changes

#### Phase 2 — Runtime AI Ops Intelligence
- Confidence-scored error diagnosis with strict JSON output schema
- Safe remediation lifecycle: `proposed → approved → applied → validated → rolled_back`
- Role-based approval + risk-tier gating for `apply-log-fix`
- Post-apply validation with automatic rollback on regression
- Incident triage assistant: prioritize failures by recurrence, blast radius, SLA impact

#### Phase 3 — Grounded Intelligence (RAG)
- Org-scoped knowledge index from runbooks, templates, integration docs, event schemas
- Citation-backed responses in chat and diagnosis flows
- Retrieval filters by org, integration type, recency, confidence
- "Unknown from available context" enforcement when evidence is insufficient

#### Phase 4 — Evaluation and Release Gates
- Offline evaluation harness with golden datasets from real failure patterns
- Evaluate: transformation quality, remediation correctness, hallucination rate, policy compliance
- CI release gates for prompt/model changes — block rollout on regression
- Online A/B testing for model/prompt variants with operational outcome tracking

#### Phase 5 — Cost and Reliability Hardening
- Model routing by task complexity (triage vs remediation synthesis)
- Caching/deduplication for repeated error signatures and prompts
- Provider failover with timeout/retry/fallback routing
- AI availability and quality SLOs

---

### Enterprise Features
- SSO integration (SAML, OAuth 2.0)
- Fine-grained API access control (per-endpoint permissions)
- White-label deployment options
- Dedicated support SLAs

### Performance & Scale
- Horizontal worker scaling with distributed locks
- Event partitioning for parallel processing
- In-memory caching with Redis
- Connection pooling optimization

### Developer Experience
- CLI for integration management
- Terraform provider for IaC
- OpenAPI 3.0 spec generation
- SDK libraries (Python, Go, Java, Node.js)

---

## Release Cadence

### Versioning Strategy
- **MAJOR** (v2.0.0): Breaking changes, major new features
- **MINOR** (v1.1.0): New features, backwards compatible
- **PATCH** (v1.0.1): Bug fixes, security patches

### Release Schedule
- **MINOR** releases: Quarterly (Q2, Q3, Q4)
- **PATCH** releases: As needed (security fixes, critical bugs)
- **MAJOR** releases: Annually or when significant breaking changes are required

### Support Policy
- **Latest MAJOR**: Full support (features + security)
- **Previous MAJOR**: Security fixes only (12 months)
- **Older versions**: No support (upgrade required)

---

## Community & Contributions

### How to Contribute to the Roadmap
- Submit feature requests via GitHub Issues
- Upvote features on GitHub Discussions
- Join community calls (monthly roadmap reviews)
- Submit pull requests for documentation improvements

### Roadmap Priorities
Features are prioritized based on:
1. **User Impact**: How many users benefit and how directly?
2. **Implementation cost**: Backend-only changes ship before full-stack features
3. **Strategic Value**: Does it unlock the platform for new verticals?
4. **Community Interest**: GitHub upvotes and discussion activity

### Feedback Channels
- **GitHub Issues**: Bug reports and feature requests
- **GitHub Discussions**: Roadmap feedback and Q&A
- **Community Slack**: Real-time discussions
- **Email**: roadmap@integration-gateway.io

---

## Success Metrics

### v1.1.0
- Per-org event catalogue adopted by >50% of non-Medics orgs
- Error categorization reduces mean debug time (target: 40% fewer DLQ re-queues per support request)
- Inbound signature verification enabled on >60% of new inbound integrations
- Health score <60 alert adopted by ops teams using the platform

### v1.2.0
- Circuit breaker auto-recovery rate: >80%
- Kafka throughput: 1M+ events/day per instance
- Request batching reduces average API calls by >50% for high-volume integrations

### v2.0.0
- Multi-region latency: <100ms API latency globally
- Uptime: 99.99% across all regions
- MTTR: <30 minutes average resolution time
- 100% of requests traced end-to-end

---

## Get Involved

1. **Star the repo** to show your support
2. **Submit issues** for bugs or feature requests
3. **Join discussions** to shape the roadmap
4. **Contribute code** via pull requests
5. **Share your use case** to help prioritize features

---

**Last Updated**: February 2026

**Maintainers**: Integration Gateway Core Team

**License**: AGPL v3.0
