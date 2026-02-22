# Integration Control Plane (Integration Gateway)

Open-source, multi-tenant integration control plane for outbound webhooks, inbound runtime proxying, scheduling, event-source adapters, observability, RBAC, and AI-assisted operations.

[![License](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Website](https://img.shields.io/badge/Website-icplane.com-blue)](https://icplane.com)

## 💡 Why I Built This (The Origin Story)

If you're building a B2B SaaS platform—especially a growing, multi-tenant one—managing how your system talks to your customers' external systems is a massive pain point. 

I faced this exact problem while building integrations for a **Healthcare Information Management System (HIMS)** provider. I was spending weeks building custom webhook delivery systems, inbound API gateways, rate limiters, and dead-letter queues just so our internal products could integrate reliably with external hospital tools and third-party vendors. 

Enterprise integration platforms like **MuleSoft** or **Kong** cost a fortune and are incredibly heavy to run. On the other hand, hacking together custom scripts per tenant was completely unmaintainable as we scaled. 

So, I built precisely what growing multi-tenant companies actually need: a fast, organization-scoped **Integration Control Plane**. 

This system acts as a unified traffic controller. Instead of spending 3-6 months building a reliable webhook and proxy infrastructure from scratch, you can deploy this gateway alongside your MongoDB/MySQL database and instantly have enterprise-grade, multi-tenant integration management. What used to take our team weeks of development per integration now takes minutes.

### 🌟 Why It's Unique

While there are other webhook services (like Svix) or API Gateways (like Kong), this project occupies a highly valuable middle ground:
1. **The "All-in-One" Approach**: It handles **Outbound Webhooks** (pushing events), **Inbound Proxying** (receiving requests), and **Scheduled Jobs** (batch data fetching) in a single platform. Most competitors only do one.
2. **AI-Assisted Operations**: This is the killer feature. Instead of forcing developers to manually write complex transformation scripts, the gateway uses built-in AI (OpenAI, Anthropic, GLM, Moonshot) to generate JS/JMESPath transformations, analyze vendor API docs, suggest data mappings, and diagnose log failures instantly.
3. **Deep Multi-Tenancy**: Everything is strictly scoped by `orgId` (tenant) and supports organizational hierarchies, meaning it is built for B2B scale from day one.
4. **Built-in Observability**: It doesn't just route traffic; it stores execution traces, manages the Dead Letter Queue (DLQ) for auto-retries, and provides a built-in Alert Center.

## What This Application Does

- Manages integration configurations per organization (`orgId` scoped).
- Delivers outbound events with retries and dead-letter handling.
- Exposes inbound integration endpoints with auth, transformation, and optional response streaming.
- Supports scheduled integrations and scheduled jobs (cron/interval).
- Tracks logs, execution traces, audit trails, alert center, and daily reporting.
- Includes AI features for transformation generation, documentation analysis, mapping suggestions, diagnostics, and assistant chat.

## Implemented Feature Set (Code-Verified)

### Integrations and Delivery

- Outbound integrations (`/api/v1/outbound-integrations`)
  - CRUD, duplicate, bulk update/delete, test delivery, cURL generation.
  - Script and simple transformation modes.
  - Delivery mode support: `IMMEDIATE`, `DELAYED`, `RECURRING`.
  - Signing secret rotation/removal endpoints.
- Inbound/runtime integrations (`/api/v1/integrations`)
  - Runtime trigger endpoints (`GET/POST /api/v1/integrations/:type`).
  - Inbound auth checks (`NONE`, `API_KEY`, `BEARER`, `BASIC`).
  - Outbound auth support in delivery path (`NONE`, `API_KEY`, `BASIC`, `BEARER`, `OAUTH1`, `OAUTH2`, `CUSTOM`, `CUSTOM_HEADERS`).
  - Optional streamed upstream response forwarding.
  - Per-integration rate limit checks.

### Scheduling

- Scheduled integrations (`/api/v1/scheduled-integrations`) for delayed/recurring webhook execution.
- Scheduled jobs (`/api/v1/scheduled-jobs`)
  - Cron and interval scheduling.
  - Manual execute endpoint.
  - Job logs and per-job log detail endpoints.
  - Data source types currently handled: `SQL`, `MONGODB`, `API`.

### Event Sources

- Per-org event source configuration (`/api/v1/event-sources`).
- Supported types in code: `mysql`, `kafka`, `http_push`.
- Important:
  - MySQL is optional and should only be configured for tenants that use MySQL as their event source.
  - Global `eventSource.type` can be left empty.
  - `http_push` adapter is present but currently marked Phase 2 (registered, not full polling loop yet).
  - MySQL safety limits are enforced server-side to prevent overload:
    - Shared pool: `connectionLimit` 1..20, `queueLimit` 0..200
    - Dedicated pool: `connectionLimit` 1..5, `queueLimit` 0..50
    - Source tuning: `pollIntervalMs` 1000..300000, `batchSize` 1..100, `dbTimeoutMs` 1000..120000

### Operations and Observability

- Delivery logs, execution logs, system logs, event audit, DLQ endpoints.
- Alert center and analytics/dashboard routes.
- Audit logs and user activity tracking.
- Daily report configuration/test/status endpoints.
- Health endpoint: `GET /health`.

### RBAC and Multi-Tenancy

- Role/feature permission system with org-scoped access control.
- Built-in roles include `SUPER_ADMIN`, `ADMIN`, `ORG_ADMIN`, `INTEGRATION_EDITOR`, `VIEWER`, `ORG_USER`, `API_KEY`.
- Org context is passed via JWT claims or `orgId` query param.

### AI Features

- AI assistant and AI config routes:
  - `/api/v1/ai`
  - `/api/v1/ai-config`
- Supported providers in code:
  - OpenAI
  - Anthropic Claude
  - Kimi (Moonshot)
  - Z.ai (GLM)
- AI operations implemented:
  - `GET /ai/status`, `GET /ai/usage`
  - `POST /ai/generate-transformation`
  - `POST /ai/analyze-documentation`
  - `POST /ai/suggest-mappings`
  - `POST /ai/generate-test-payload`
  - `POST /ai/generate-scheduling-script`
  - `POST /ai/analyze-error`
  - `POST /ai/diagnose-log-fix`
  - `POST /ai/apply-log-fix`
  - `POST /ai/chat`
  - `POST /ai/explain-transformation`
  - AI interactions/log stats endpoints
- AI config operations:
  - Get/save org config
  - Test provider connection
  - Delete API key
  - List providers/models

## Repository Layout

```text
backend/                    # Express API, workers, adapters, data layer
frontend/                   # React + TypeScript admin console
docs/                       # Guides and architecture docs
docker-compose.yml          # Production-ish local stack (Mongo + backend + frontend)
docker-compose.dev.yml      # Dev stack with hot reload
```

## Runtime Requirements

- Docker + Docker Compose (for containerized run), or:
  - Node.js 18+ for local development
  - MongoDB 6+ (required)
- Optional, only if your use case needs them:
  - MySQL (tenant-specific event source or scheduled SQL source)
  - Kafka (tenant-specific event source)

## Run With Docker (Recommended)

1. Clone and prepare config.

```bash
git clone https://github.com/varaprasadreddy9676/integration-control-plane.git
cd integration-control-plane
cp backend/config.example.json backend/config.json
```

2. Edit `backend/config.json` before startup.

- Required:
  - `port`: keep `3545` (matches compose port mapping).
  - `mongodb.uri`: use Docker service hostname, for example:
    - `mongodb://mongodb:27017/integration_gateway`
  - `security.apiKey`: set a strong random value.
  - `security.jwtSecret`: set a strong random value.
- Recommended:
  - Keep `eventSource.type` empty unless you intentionally want a global default source.
- Optional:
  - `db.*` only if you want shared/global MySQL connectivity.

3. Start services.

```bash
docker compose up -d --build
```

4. Verify.

```bash
docker compose ps
curl http://localhost:3545/health
```

5. Create first admin user.

```bash
docker compose exec backend node scripts/create-user.js \
  --email admin@example.com \
  --password 'ChangeMe123!' \
  --role ADMIN
```

6. Access app.

- Frontend: `http://localhost`
- Backend API base: `http://localhost:3545/api/v1`

## Local Development

### Backend

```bash
cd backend
npm install
cp config.example.json config.json
```

For local (non-Docker), set in `backend/config.json`:

- `mongodb.uri` -> `mongodb://localhost:27017/integration_gateway`
- secure `security.apiKey` and `security.jwtSecret`

Start:

```bash
npm run dev
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Default local values in `frontend/.env`:

- `VITE_API_BASE_URL=http://localhost:3545/api/v1`
- `VITE_API_KEY=<same value as backend security.apiKey>` (used by frontend API client)

## Configuration Notes

- MongoDB is mandatory. App startup fails without MongoDB.
- MySQL is optional.
  - Do not hardcode it unless required.
  - Prefer per-org event source config via API/UI.
- Kafka is optional and only needed for orgs configured with Kafka source.
- Global event source default (`eventSource.type`) is optional.
  - Leave empty for fully dynamic per-org source setup.

## Current UI Areas

The frontend includes routes/pages for:

- Dashboard
- Integrations (all, inbound detail, optional flow builder)
- Scheduled integrations and scheduled jobs
- Logs, event audit, DLQ, alert center, system logs
- Event catalog, templates, lookup tables, bulk operations, versions
- AI assistant and AI settings
- Organization settings and event source settings
- Admin org directory, users, roles, rate limits, audit logs, user activity, permissions

## API Route Groups

Mounted in backend under `config.api.basePrefix` (default `/api/v1`):

- `/auth`, `/users`, `/admin`
- `/outbound-integrations`, `/inbound-integrations`, `/integrations`
- `/scheduled-integrations`, `/scheduled-jobs`
- `/events`, `/event-sources`, `/lookups`, `/templates`, `/bulk`, `/versions`
- `/logs`, `/execution-logs`, `/system-logs`, `/alert-center`, `/dashboard`, `/analytics`, `/dlq`
- `/ai`, `/ai-config`
- `/config`, `/tenant`, `/daily-reports`, `/field-schemas`, `/import-export`

## Security and Open-Source Hygiene

- Do not commit real secrets, `.env` files, private keys, or production data exports.
- Keep `backend/config.example.json` as template values only.
- Configure AI provider keys per organization in AI settings/API (encrypted at rest in Mongo).

## How ICPlane Compares

See the full [comparison with Svix, Convoy, Hookdeck, and building it yourself](docs/comparison.md).

| | **ICPlane** | **Svix** | **Convoy** | **Hookdeck** |
|---|---|---|---|---|
| Outbound + Inbound + Scheduled | All three | Outbound + Ingest | Both | Both (core is SaaS-only) |
| Self-hosted | Yes (AGPL v3) | Yes (MIT, reduced) | Yes (Elastic, not OSI) | Outpost only |
| Multi-tenant RBAC | 7 roles, org-scoped | Basic | Basic | Basic |
| AI-assisted transforms | 4 providers | Single button | No | No |
| Visual field mapping | Yes | No | No | No |
| DLQ auto-retry | Yes | Manual only | Manual only | Manual only |
| Paid tier starts at | Free | $490/mo | $99/mo | $39/mo |

## Documentation

- [docs/README.md](docs/README.md)
- [docs/guides/GETTING-STARTED.md](docs/guides/GETTING-STARTED.md)
- [docs/guides/DOCKER.md](docs/guides/DOCKER.md)
- [docs/guides/RBAC-GUIDE.md](docs/guides/RBAC-GUIDE.md)
- [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md)
- [docs/architecture/SCHEDULED_JOBS.md](docs/architecture/SCHEDULED_JOBS.md)
- [docs/comparison.md](docs/comparison.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

If you discover a vulnerability, follow [SECURITY.md](SECURITY.md) and avoid posting sensitive details in public issues.

## Support and Community

- Website: [icplane.com](https://icplane.com)
- Email: founder@icplane.com
- Documentation: [docs/README.md](docs/README.md)
- Issues: [GitHub Issues](https://github.com/varaprasadreddy9676/integration-control-plane/issues)
- Discussions: [GitHub Discussions](https://github.com/varaprasadreddy9676/integration-control-plane/discussions)

## License

GNU Affero General Public License v3.0. See [LICENSE](LICENSE).
