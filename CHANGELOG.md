# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing pending.

---

## [2.1.0] - 2026-02-24

### Added
- Inbound integration detail page enhancements with improved UX
- Admin panel storage statistics (`StorageStatsRoute.tsx`)
- MySQL pool settings configuration UI (`MysqlPoolSettingsRoute.tsx`) — runtime-configurable pool limits without restart
- Server offline detection in frontend — surfaces unavailability to users clearly
- Event source status indicators and configuration improvements
- Open source–ready testing framework:
  - CI/CD pipeline: Docker image builds now gated on test suite passing
  - Backend coverage thresholds (50% global, 60% patch) via Jest
  - `.codecov.yml` with project and patch coverage targets
  - GitHub community files: `CODE_OF_CONDUCT.md`, PR template, bug/feature issue templates, `CODEOWNERS`
  - Husky + lint-staged pre-commit hooks (Biome auto-format on staged files)
  - Frontend Vitest setup with React Testing Library and smoke tests

### Changed
- Breadcrumb navigation improvements across inbound integration pages
- Event source handling more robust with better error boundaries

---

## [2.0.0] - 2026-02

### Added
- **Embeddable webhook portal** — Super Admin can generate magic links for iframe embedding in partner portals
- **Visual flow builder** — drag-and-drop workflow creation with ReactFlow
- **Integration versioning** — semantic version history with full diff view for all config changes
- **Bulk operations** — import/export via XLSX, bulk enable/disable integrations, bulk DLQ retry
- **HMAC signing** — webhook authenticity via rotating signing secrets per outbound integration
- **Daily reports** — configurable scheduled email summaries with analytics
- **AI assistant** — chat interface with 4 provider support (OpenAI, Claude, GLM, Kimi) per org
- **AI-powered field mapping, error analysis, test payload generation, transformation suggestions**
- **Alert center** — categorized system alerts with statistics and trend views
- **Analytics routes** — time-series performance metrics, event analytics, latency breakdowns
- **Audit trail** — comprehensive logging for all configuration and admin operations
- **Field schemas** — event field definitions for schema validation
- **Import/export** — full data import/export with validation and progress tracking
- **Templates** — reusable integration templates with one-click deploy
- **Lookup tables** — import/export via XLSX, reverse lookup, usage statistics
- Shadcn/RadixUI component library integrated alongside Ant Design
- TailwindCSS utility styling system
- Framer Motion and GSAP animations
- Dark mode with complete design system tokens
- Multi-architecture Docker builds (amd64 + arm64) published to GHCR

### Changed
- Data layer decomposed: `data/index.js` split from 5,189-line monolith into 18 domain-specific modules — all callers unchanged via thin re-export aggregator
- Workers moved to `backend/src/processor/` (from monolithic `worker.js`) — modular delivery engine, scheduler, DLQ worker, scheduled job worker
- Event source adapters moved to `backend/src/adapters/` (MySQL, Kafka, HTTP Push)
- Frontend org-centric naming migration (removed legacy entityRid/entityParentRid)
- Backend now runs at 8GB memory in production with GC optimizations (`start:production` script)
- Route count expanded from ~20 to 30 route files

### Security
- **CRITICAL**: Replaced vulnerable vm2 package with custom `secure-vm.js` wrapper (CVE-2023-37466)
- Script-created timers now cancelled on `SecureVM.finish()` — no leakage between executions
- SSRF protection: private network blocking on all webhook target URLs
- Rate limiting at three levels: per-integration, per-org, global

---

## [1.0.0] - 2026-Q1

### Added
- Initial production release
- Outbound webhook delivery engine (event-driven, with retries and exponential backoff)
- Inbound API proxy with request/response transformation
- Scheduled integrations (DELAYED, RECURRING cron-based)
- Scheduled batch jobs with SQL, MongoDB, and HTTP data sources
- Dead Letter Queue with auto-retry and bulk manual retry
- Multi-tenancy with full org isolation (orgId scoping at every layer)
- RBAC: 7 built-in roles, 80+ granular permissions (`src/rbac/`)
- JWT + API Key dual authentication
- Per-integration and per-org rate limiting (sliding window)
- Biome linting for both backend and frontend (replaces ESLint/Prettier)
- Docker + Docker Compose deployment support (docker-compose.yml, docker-compose.dev.yml)
- MongoDB as primary required store; MySQL and Kafka as optional event sources
- React 18 + TypeScript frontend with Ant Design 5
- TanStack Query 5 for server state management
- Monaco Editor for SQL, JS, and MongoDB query editing in browser
- Delivery logs, execution logs, system logs, and DLQ management UI
- Dashboard with KPI cards and analytics charts (Recharts)
- User activity tracking and memory monitoring
