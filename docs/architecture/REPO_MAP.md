# Repository Map

Practical repo reconnaissance for contributors working on inbound integrations, transformation, and lookups.

Last updated: 2026-03-17

## Recommended Starting Points

- [README.md](/Users/sai/Documents/GitHub/integration-control-plane/README.md)
- [backend/src/index.js](/Users/sai/Documents/GitHub/integration-control-plane/backend/src/index.js)
- [frontend/src/app/App.tsx](/Users/sai/Documents/GitHub/integration-control-plane/frontend/src/app/App.tsx)
- [backend/src/routes/integrations.js](/Users/sai/Documents/GitHub/integration-control-plane/backend/src/routes/integrations.js)
- [backend/src/services/transformer.js](/Users/sai/Documents/GitHub/integration-control-plane/backend/src/services/transformer.js)
- [backend/src/data/lookups.js](/Users/sai/Documents/GitHub/integration-control-plane/backend/src/data/lookups.js)

## Top-Level Structure

- `backend/`: Express API, workers, adapters, data layer, setup scripts, Jest tests.
- `frontend/`: React + Vite admin UI in TypeScript.
- `docs/`: architecture and feature guides.
- `scripts/`: repo-level helper scripts and utilities.
- `integration-gateway-frontend/`: appears to be an extra built frontend artifact, not the primary source tree.
- `artifacts/`: backups and operational outputs, not core source.

## Stack Summary

### Backend

- Node.js
- Express 4
- MongoDB
- Axios
- Jest
- Biome

### Frontend

- React 18
- TypeScript
- Vite
- React Router
- TanStack Query
- Ant Design

## How To Run

### Preferred First Boot

```bash
docker compose up -d --build
```

### Local Development

```bash
cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev
```

### Tests

```bash
cd backend && npm test
cd frontend && npm test
```

### Default Ports

- Backend: `3545`
- Frontend dev: `5175`
- Docker frontend: `80`

## Primary Code Areas

### Backend

- `backend/src/routes`: HTTP API and runtime entry points.
- `backend/src/processor`: delivery engine, scheduler, event handling, DLQ, worker orchestration.
- `backend/src/data`: Mongo-backed persistence and query logic.
- `backend/src/services`: transformations, lookups, auth, communication, AI, validation.
- `backend/src/adapters`: external event-source adapters such as MySQL and Kafka.

### Frontend

- `frontend/src/app/App.tsx`: route and menu aggregator.
- `frontend/src/features/integrations`: integration management UI.
- `frontend/src/features/inbound-integrations`: inbound integration screens.
- `frontend/src/features/lookups`: lookup management UI.
- `frontend/src/shared/integration-forms/transformation`: transformation form components.

## Inbound Integration Model

There are two separate inbound patterns in this repo.

### 1. Synchronous Inbound HTTP Runtime

The public and authenticated inbound runtime endpoints eventually funnel into [backend/src/routes/integrations.js](/Users/sai/Documents/GitHub/integration-control-plane/backend/src/routes/integrations.js).

Relevant files:

- [backend/src/index.js](/Users/sai/Documents/GitHub/integration-control-plane/backend/src/index.js)
- [backend/src/routes/inbound-runtime-public.js](/Users/sai/Documents/GitHub/integration-control-plane/backend/src/routes/inbound-runtime-public.js)
- [backend/src/routes/integrations.js](/Users/sai/Documents/GitHub/integration-control-plane/backend/src/routes/integrations.js)

Runtime behavior in `handleInboundRuntime`:

1. Resolve org and active inbound integration config from `integration_configs`.
2. Enforce configured HTTP method and content type.
3. Validate multipart PDF upload constraints when applicable.
4. Validate per-integration inbound authentication.
5. Evaluate request policy and rate limiting.
6. Apply request transformation and lookups.
7. Either enqueue async work for `COMMUNICATION` actions or call the upstream `targetUrl`.
8. Optionally transform the upstream response before returning it.
9. Persist execution logs and DLQ/replay metadata.

### 2. Event-Source Ingestion

This is a separate inbound model for systems that publish or expose events.

Relevant files:

- [backend/src/routes/event-sources.js](/Users/sai/Documents/GitHub/integration-control-plane/backend/src/routes/event-sources.js)
- [backend/src/processor/delivery-worker-manager.js](/Users/sai/Documents/GitHub/integration-control-plane/backend/src/processor/delivery-worker-manager.js)
- [backend/src/processor/event-handler.js](/Users/sai/Documents/GitHub/integration-control-plane/backend/src/processor/event-handler.js)
- [backend/src/processor/event-processor.js](/Users/sai/Documents/GitHub/integration-control-plane/backend/src/processor/event-processor.js)
- [backend/src/adapters/MysqlEventSource.js](/Users/sai/Documents/GitHub/integration-control-plane/backend/src/adapters/MysqlEventSource.js)
- [backend/src/adapters/KafkaEventSource.js](/Users/sai/Documents/GitHub/integration-control-plane/backend/src/adapters/KafkaEventSource.js)
- [backend/src/adapters/HttpPushAdapter.js](/Users/sai/Documents/GitHub/integration-control-plane/backend/src/adapters/HttpPushAdapter.js)
- [backend/src/data/event-sources.js](/Users/sai/Documents/GitHub/integration-control-plane/backend/src/data/event-sources.js)

Main flow:

1. Event source config is stored per org.
2. Worker manager loads configs and starts adapters.
3. Adapter normalizes external events into a shared event envelope.
4. Event handler validates, deduplicates, audits, and dispatches.
5. Event processor matches integrations and hands off to delivery.

### Push Events

[backend/src/routes/events.js](/Users/sai/Documents/GitHub/integration-control-plane/backend/src/routes/events.js) exposes `POST /events/push`, which enqueues into `pending_events`.

Important current limitation:

- [backend/src/adapters/HttpPushAdapter.js](/Users/sai/Documents/GitHub/integration-control-plane/backend/src/adapters/HttpPushAdapter.js) appears to be a stub, so queued push events may not currently be consumed.

## Transformation Model

The transformation engine is centralized in [backend/src/services/transformer.js](/Users/sai/Documents/GitHub/integration-control-plane/backend/src/services/transformer.js).

### Core Behavior

- `applyTransform()` runs standard transformation first, then lookup enrichment.
- `applyResponseTransform()` does the same for inbound HTTP responses.
- `SIMPLE` mode performs field mapping plus lightweight transforms such as trim, case normalization, defaults, date conversion, and inline lookup.
- `SCRIPT` mode executes JavaScript in the secure VM under [backend/src/utils/secure-vm](/Users/sai/Documents/GitHub/integration-control-plane/backend/src/utils/secure-vm).

### Where It Is Used

- Inbound HTTP runtime: [backend/src/routes/integrations.js](/Users/sai/Documents/GitHub/integration-control-plane/backend/src/routes/integrations.js)
- Event-driven processing: [backend/src/processor/event-processor.js](/Users/sai/Documents/GitHub/integration-control-plane/backend/src/processor/event-processor.js)
- Delivery execution: [backend/src/processor/delivery-engine.js](/Users/sai/Documents/GitHub/integration-control-plane/backend/src/processor/delivery-engine.js)
- Outbound testing/runtime: [backend/src/routes/outbound-integrations.js](/Users/sai/Documents/GitHub/integration-control-plane/backend/src/routes/outbound-integrations.js)

### Important Frontend Surfaces

- [frontend/src/shared/integration-forms/transformation/TransformationForm.tsx](/Users/sai/Documents/GitHub/integration-control-plane/frontend/src/shared/integration-forms/transformation/TransformationForm.tsx)
- [frontend/src/shared/integration-forms/transformation/SimpleTransformationMapping.tsx](/Users/sai/Documents/GitHub/integration-control-plane/frontend/src/shared/integration-forms/transformation/SimpleTransformationMapping.tsx)
- [frontend/src/features/integrations/routes/integrationDetail/hooks/useAvailableFields.ts](/Users/sai/Documents/GitHub/integration-control-plane/frontend/src/features/integrations/routes/integrationDetail/hooks/useAvailableFields.ts)
- [frontend/src/features/integrations/routes/integrationDetail/utils/fieldMapping.tsx](/Users/sai/Documents/GitHub/integration-control-plane/frontend/src/features/integrations/routes/integrationDetail/utils/fieldMapping.tsx)

## Lookup Model

Lookups are a dedicated subsystem, not just a helper function.

### Backend Files

- [backend/src/data/lookups.js](/Users/sai/Documents/GitHub/integration-control-plane/backend/src/data/lookups.js): persistence, forward lookup, reverse lookup, scope fallback, usage counters.
- [backend/src/services/lookup-service.js](/Users/sai/Documents/GitHub/integration-control-plane/backend/src/services/lookup-service.js): runtime application of configured lookups.
- [backend/src/services/lookup-validator.js](/Users/sai/Documents/GitHub/integration-control-plane/backend/src/services/lookup-validator.js): config validation.
- [backend/src/services/lookup-import-export.js](/Users/sai/Documents/GitHub/integration-control-plane/backend/src/services/lookup-import-export.js): XLSX/CSV import-export support.
- [backend/src/routes/lookups.js](/Users/sai/Documents/GitHub/integration-control-plane/backend/src/routes/lookups.js): CRUD, resolve, reverse, test, import, export.

### Frontend Files

- [frontend/src/features/lookups/routes/LookupsRoute.tsx](/Users/sai/Documents/GitHub/integration-control-plane/frontend/src/features/lookups/routes/LookupsRoute.tsx)
- [frontend/src/features/integrations/components/LookupConfigSection.tsx](/Users/sai/Documents/GitHub/integration-control-plane/frontend/src/features/integrations/components/LookupConfigSection.tsx)

### Runtime Semantics

- Lookup resolution supports org-unit scope with fallback to parent scope.
- Lookups can target scalar values, nested fields, array items, and templated composite keys.
- Results can return a specific field or a full target object.
- The main transformation path runs lookups after the standard transform stage.

## Inbound Request To Upstream Delivery Sequence

The inbound HTTP runtime path is:

1. Client hits `/integrations/:type` or `/public/integrations/:type`.
2. Route resolves tenant-scoped active config.
3. Route validates method, content type, inbound auth, and request policy.
4. Route builds request context from body, query, headers, and optional file.
5. Route calls `applyTransform()` when request transformation is configured.
6. Transformer runs standard transform.
7. Transformer runs `applyLookups()` if lookup config exists.
8. Route builds outbound auth headers.
9. Route either:
   - inserts a `pending_deliveries` job for `COMMUNICATION`, or
   - calls upstream via Axios.
10. For buffered HTTP responses, route optionally calls `applyResponseTransform()`.
11. Route logs success or failure and returns response to caller.

## Known Risks And Confusing Areas

- `backend/src/routes/integrations.js` mixes admin CRUD, runtime behavior, and testing concerns in one large file.
- “Inbound integrations” refers to both synchronous HTTP runtime integrations and event-source ingestion. The naming overlap is easy to misread.
- `HttpPushAdapter` appears incomplete, while push events can still be enqueued through the API.
- Inbound request transformation paths appear to check `requestTransformation.script` in some places even though the transformer supports `SIMPLE` mode.
- Similar gating inconsistency may exist for response transformations.
- `applySimpleTransform()` appears additive rather than a strict projection, so unmapped input fields may survive.
- Lookup docs may be ahead of implementation, especially around script helpers and API shape.
- No dedicated backend lookup cache was found; lookup-heavy runtime paths may be Mongo-bound.
- Some docs mention setup steps or Node versions that do not match the current codebase.
- The repo contains generated or backup-like material, including committed `node_modules`, built artifacts, and extra directories that add noise.

## Setup Drift To Watch

- Root and backend docs mention `config.example.json`, but actual config resolution appears to be driven by env vars plus optional `backend/config.json`.
- Node version requirements are inconsistent across docs and package metadata.

## Best Working Assumptions

- Treat `backend/` and `frontend/` as the authoritative app source trees.
- Use Docker for first boot if local setup behaves inconsistently.
- For runtime tracing, start at [backend/src/routes/integrations.js](/Users/sai/Documents/GitHub/integration-control-plane/backend/src/routes/integrations.js), then step into [backend/src/services/transformer.js](/Users/sai/Documents/GitHub/integration-control-plane/backend/src/services/transformer.js) and [backend/src/data/lookups.js](/Users/sai/Documents/GitHub/integration-control-plane/backend/src/data/lookups.js).
- For UI tracing, start at [frontend/src/app/App.tsx](/Users/sai/Documents/GitHub/integration-control-plane/frontend/src/app/App.tsx), then follow the relevant feature module.
