# Backend Service (Integration Gateway)

Express API and worker service for the Integration Gateway control plane.

## What It Runs

- REST API under `/api/v1`
- Outbound and inbound integration runtime
- Delivery worker, scheduler worker, DLQ worker
- Per-org event-source adapters (`mysql`, `kafka`, `http_push`)
- AI routes and provider integrations

## Prerequisites

- Node.js 18+
- MongoDB 6+ (required)
- Optional: MySQL and Kafka (only if used by tenant event-source configs)

## Quick Start

```bash
cd backend
npm install
cp config.example.json config.json
npm run dev
```

Health check:

```bash
curl http://localhost:3545/health
```

## Configuration

Main config file: `backend/config.json`.

Required:

- `port`
- `mongodb.uri`
- `security.apiKey`
- `security.jwtSecret`

Optional:

- `db.*` shared MySQL pool (only needed when using shared MySQL source)
- `eventSource.type` global default source type (leave empty for fully dynamic per-org source setup)

## MySQL Behavior (Important)

MySQL is optional and tenant-driven.

- Per-org dedicated MySQL credentials are configured via `POST/PUT /api/v1/event-sources`.
- Shared MySQL pool can be configured via `config.json` (`db.*`) if you want one common source.
- If MySQL is not configured, backend still starts and runs MongoDB-backed features.

Server-side safety guardrails now clamp MySQL settings:

- Shared pool: `connectionLimit` 1..20, `queueLimit` 0..200
- Dedicated pool: `connectionLimit` 1..5, `queueLimit` 0..50
- MySQL source tuning: `pollIntervalMs` 1000..300000, `batchSize` 1..100, `dbTimeoutMs` 1000..120000

These limits are enforced on save/test/runtime paths to prevent DB overload.

## Useful Commands

```bash
npm run dev
npm start
npm run start:cluster
npm run seed:schemas
npm run seed:ui-config
npm run check
npm run lint
```

## Docker

Use repository-level compose files:

- `docker-compose.yml`
- `docker-compose.dev.yml`

See `/docs/guides/DOCKER.md` for full instructions.
