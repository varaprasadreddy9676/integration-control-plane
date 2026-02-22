──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ Plan to implement                                                                                                                                                    │
│                                                                                                                                                                      │
│ Plan: Open Source–Ready Testing Framework                                                                                                                            │
│                                                                                                                                                                      │
│ Context                                                                                                                                                              │
│                                                                                                                                                                      │
│ The project is going open source. The CI pipeline (docker-image.yml) only builds and pushes Docker images — it never runs tests or linting, meaning broken code can  │
│ be published. There are no coverage thresholds, no GitHub community health files (CODE_OF_CONDUCT, issue templates, PR template), no pre-commit hooks, and only 6 of │
│  32 route files have dedicated test files. Frontend has zero test infrastructure. This plan hardens everything so contributors can submit PRs with confidence and    │
│ maintainers can enforce quality automatically.                                                                                                                       │
│                                                                                                                                                                      │
│ Current gaps discovered:                                                                                                                                             │
│ - CI runs Docker build only — no test/lint gate before image publish                                                                                                 │
│ - No coverageThreshold in jest config — 0% coverage allowed                                                                                                          │
│ - Missing: CODE_OF_CONDUCT.md, PR template, issue templates, CODEOWNERS                                                                                              │
│ - 26 of 32 backend route files have no dedicated test file                                                                                                           │
│ - Frontend has no test framework, no test scripts, no test files                                                                                                     │
│ - No pre-commit hooks (husky/lint-staged)                                                                                                                            │
│                                                                                                                                                                      │
│ ---                                                                                                                                                                  │
│ Part 1: CI/CD — Proper Test Gate                                                                                                                                     │
│                                                                                                                                                                      │
│ New file: .github/workflows/ci.yml                                                                                                                                   │
│                                                                                                                                                                      │
│ Triggers on every push and PR to main, separate from the Docker build:                                                                                               │
│                                                                                                                                                                      │
│ jobs:                                                                                                                                                                │
│   backend-tests:                                                                                                                                                     │
│     # node 20, install deps in backend/test/, run test:ci                                                                                                            │
│     # uploads coverage lcov to Codecov (flags: backend)                                                                                                              │
│                                                                                                                                                                      │
│   backend-lint:                                                                                                                                                      │
│     # runs: npm run check (biome) in backend/                                                                                                                        │
│                                                                                                                                                                      │
│   frontend-lint:                                                                                                                                                     │
│     # runs: npm run check (biome) in frontend/                                                                                                                       │
│                                                                                                                                                                      │
│   security-audit:                                                                                                                                                    │
│     # runs: npm audit --audit-level=high in backend/ and frontend/                                                                                                   │
│     # continue-on-error: true (advisory, non-blocking initially)                                                                                                     │
│                                                                                                                                                                      │
│ Update: .github/workflows/docker-image.yml                                                                                                                           │
│                                                                                                                                                                      │
│ Add to both build-and-push-backend and build-and-push-frontend jobs:                                                                                                 │
│ needs: [backend-tests, backend-lint, frontend-lint]                                                                                                                  │
│ Images are never published from code that fails tests or linting.                                                                                                    │
│                                                                                                                                                                      │
│ Update: backend/test/package.json                                                                                                                                    │
│                                                                                                                                                                      │
│ Add test:ci script:                                                                                                                                                  │
│ "test:ci": "jest --ci --forceExit --coverage --testPathIgnorePatterns='clevertap-live|comprehensive-live|real-delivery|workers-integration-real'"                    │
│ - --ci — disables interactive watch mode, fails on unexpected snapshot changes                                                                                       │
│ - --forceExit — prevents the pre-existing worker process teardown hang from transformer-advanced                                                                     │
│ - --testPathIgnorePatterns — skips live/e2e tests that require real infrastructure                                                                                   │
│                                                                                                                                                                      │
│ Update: backend/package.json                                                                                                                                         │
│                                                                                                                                                                      │
│ Add test:ci script:                                                                                                                                                  │
│ "test:ci": "cd test && npm install --prefer-offline && npm run test:ci"                                                                                              │
│                                                                                                                                                                      │
│ ---                                                                                                                                                                  │
│ Part 2: Coverage Enforcement + Reporting                                                                                                                             │
│                                                                                                                                                                      │
│ Update: backend/test/package.json — add coverageThreshold                                                                                                            │
│                                                                                                                                                                      │
│ "coverageThreshold": {                                                                                                                                               │
│   "global": {                                                                                                                                                        │
│     "branches": 40,                                                                                                                                                  │
│     "functions": 50,                                                                                                                                                 │
│     "lines": 50,                                                                                                                                                     │
│     "statements": 50                                                                                                                                                 │
│   }                                                                                                                                                                  │
│ },                                                                                                                                                                   │
│ "coverageReporters": ["text", "lcov", "json-summary"]                                                                                                                │
│                                                                                                                                                                      │
│ Starting conservative (realistic for current state). Raised incrementally as contributors add tests. The lcov reporter enables Codecov upload.                       │
│                                                                                                                                                                      │
│ New file: .codecov.yml (repo root)                                                                                                                                   │
│                                                                                                                                                                      │
│ coverage:                                                                                                                                                            │
│   status:                                                                                                                                                            │
│     project:                                                                                                                                                         │
│       default:                                                                                                                                                       │
│         target: 50%                                                                                                                                                  │
│         threshold: 2%     # allow 2% drop without failing PR                                                                                                         │
│     patch:                                                                                                                                                           │
│       default:                                                                                                                                                       │
│         target: 60%       # new code in PRs must be 60%+ covered                                                                                                     │
│ comment:                                                                                                                                                             │
│   layout: "reach,diff,flags,tree"                                                                                                                                    │
│   behavior: default                                                                                                                                                  │
│ flags:                                                                                                                                                               │
│   backend:                                                                                                                                                           │
│     paths: [backend/]                                                                                                                                                │
│   frontend:                                                                                                                                                          │
│     paths: [frontend/]                                                                                                                                               │
│                                                                                                                                                                      │
│ ---                                                                                                                                                                  │
│ Part 3: GitHub Community Files                                                                                                                                       │
│                                                                                                                                                                      │
│ New: CODE_OF_CONDUCT.md (repo root)                                                                                                                                  │
│                                                                                                                                                                      │
│ Contributor Covenant v2.1 (industry standard). References founder@icplane.com for enforcement contact (already in SECURITY.md).                                      │
│                                                                                                                                                                      │
│ New: .github/PULL_REQUEST_TEMPLATE.md                                                                                                                                │
│                                                                                                                                                                      │
│ ## Summary                                                                                                                                                           │
│ <!-- What does this PR do and why? -->                                                                                                                               │
│                                                                                                                                                                      │
│ ## Type of Change                                                                                                                                                    │
│ - [ ] Bug fix                                                                                                                                                        │
│ - [ ] New feature                                                                                                                                                    │
│ - [ ] Refactor / code cleanup                                                                                                                                        │
│ - [ ] Tests                                                                                                                                                          │
│ - [ ] Documentation                                                                                                                                                  │
│ - [ ] Breaking change (requires migration note)                                                                                                                      │
│                                                                                                                                                                      │
│ ## Testing                                                                                                                                                           │
│ - [ ] Added/updated tests for this change                                                                                                                            │
│ - [ ] `npm test` passes locally                                                                                                                                      │
│ - [ ] `npm run check` (linting) passes locally                                                                                                                       │
│                                                                                                                                                                      │
│ ## Breaking Changes                                                                                                                                                  │
│ <!-- List any breaking changes and migration steps, or write "None" -->                                                                                              │
│                                                                                                                                                                      │
│ ## Related Issues                                                                                                                                                    │
│ Closes #                                                                                                                                                             │
│                                                                                                                                                                      │
│ New: .github/ISSUE_TEMPLATE/bug_report.yml                                                                                                                           │
│                                                                                                                                                                      │
│ YAML form with fields: description, steps to reproduce, expected behavior, actual behavior, environment (Node version, MongoDB version, Docker/bare metal), relevant │
│  logs.                                                                                                                                                               │
│                                                                                                                                                                      │
│ New: .github/ISSUE_TEMPLATE/feature_request.yml                                                                                                                      │
│                                                                                                                                                                      │
│ YAML form with fields: problem description, proposed solution, alternatives considered, use case / who benefits, willing to implement checkbox.                      │
│                                                                                                                                                                      │
│ New: .github/CODEOWNERS                                                                                                                                              │
│                                                                                                                                                                      │
│ # Global owner                                                                                                                                                       │
│ *                        @OWNER_PLACEHOLDER                                                                                                                          │
│                                                                                                                                                                      │
│ # Backend data layer (high impact, needs careful review)                                                                                                             │
│ /backend/src/data/       @OWNER_PLACEHOLDER                                                                                                                          │
│                                                                                                                                                                      │
│ # CI/CD pipeline                                                                                                                                                     │
│ /.github/                @OWNER_PLACEHOLDER                                                                                                                          │
│                                                                                                                                                                      │
│ ---                                                                                                                                                                  │
│ Part 4: Pre-commit Hooks (Husky + lint-staged)                                                                                                                       │
│                                                                                                                                                                      │
│ Update: backend/package.json                                                                                                                                         │
│                                                                                                                                                                      │
│ Add to devDependencies:                                                                                                                                              │
│ "husky": "^9.0.0",                                                                                                                                                   │
│ "lint-staged": "^15.0.0"                                                                                                                                             │
│                                                                                                                                                                      │
│ Add lint-staged config:                                                                                                                                              │
│ "lint-staged": {                                                                                                                                                     │
│   "src/**/*.js": ["biome check --write"]                                                                                                                             │
│ }                                                                                                                                                                    │
│                                                                                                                                                                      │
│ Add prepare script (runs husky install after npm install):                                                                                                           │
│ "prepare": "husky || true"                                                                                                                                           │
│                                                                                                                                                                      │
│ New: .husky/pre-commit                                                                                                                                               │
│                                                                                                                                                                      │
│ #!/usr/bin/env sh                                                                                                                                                    │
│ . "$(dirname "$0")/_/husky.sh"                                                                                                                                       │
│ cd backend && npx lint-staged                                                                                                                                        │
│                                                                                                                                                                      │
│ Runs biome auto-fix on staged backend JS files before every commit.                                                                                                  │
│                                                                                                                                                                      │
│ ---                                                                                                                                                                  │
│ Part 5: More Backend Route Tests (5 new files)                                                                                                                       │
│                                                                                                                                                                      │
│ Following the exact established pattern (mock-mongodb.js helper, jest.mock for deps, supertest, beforeEach clearAllMocks):                                           │
│                                                                                                                                                                      │
│ ┌───────────────────────────────┬──────────────────────────┬───────────────────────────────────────────────────────────────────┐                                     │
│ │           Test File           │        Route File        │                           Key Scenarios                           │                                     │
│ ├───────────────────────────────┼──────────────────────────┼───────────────────────────────────────────────────────────────────┤                                     │
│ │ routes-users.test.js          │ routes/users.js          │ list users (200), create (201), update (200), auth required (401) │                                     │
│ ├───────────────────────────────┼──────────────────────────┼───────────────────────────────────────────────────────────────────┤                                     │
│ │ routes-templates.test.js      │ routes/templates.js      │ list (200), create (201), update (200), delete (200/404)          │                                     │
│ ├───────────────────────────────┼──────────────────────────┼───────────────────────────────────────────────────────────────────┤                                     │
│ │ routes-dashboard.test.js      │ routes/dashboard.js      │ dashboard stats (200), auth required (401)                        │                                     │
│ ├───────────────────────────────┼──────────────────────────┼───────────────────────────────────────────────────────────────────┤                                     │
│ │ routes-scheduled-jobs.test.js │ routes/scheduled-jobs.js │ list (200), create (201), delete (200/404)                        │                                     │
│ ├───────────────────────────────┼──────────────────────────┼───────────────────────────────────────────────────────────────────┤                                     │
│ │ routes-dlq.test.js            │ routes/dlq.js            │ list dead-letter items (200), retry (200)                         │                                     │
│ └───────────────────────────────┴──────────────────────────┴───────────────────────────────────────────────────────────────────┘                                     │
│                                                                                                                                                                      │
│ Before writing each test, read the corresponding route file to understand its exact request/response contract.                                                       │
│                                                                                                                                                                      │
│ ---                                                                                                                                                                  │
│ Part 6: Frontend Test Infrastructure                                                                                                                                 │
│                                                                                                                                                                      │
│ No tests exist. Set up infrastructure + 2 smoke tests so contributors have a working starting point.                                                                 │
│                                                                                                                                                                      │
│ Update: frontend/package.json                                                                                                                                        │
│                                                                                                                                                                      │
│ Add to devDependencies:                                                                                                                                              │
│ "@testing-library/react": "^14.0.0",                                                                                                                                 │
│ "@testing-library/jest-dom": "^6.0.0",                                                                                                                               │
│ "@testing-library/user-event": "^14.0.0",                                                                                                                            │
│ "vitest": "^2.0.0",                                                                                                                                                  │
│ "@vitest/coverage-v8": "^2.0.0",                                                                                                                                     │
│ "jsdom": "^24.0.0"                                                                                                                                                   │
│                                                                                                                                                                      │
│ Add scripts:                                                                                                                                                         │
│ "test": "vitest run",                                                                                                                                                │
│ "test:watch": "vitest",                                                                                                                                              │
│ "test:coverage": "vitest run --coverage"                                                                                                                             │
│                                                                                                                                                                      │
│ Update: frontend/vite.config.ts                                                                                                                                      │
│                                                                                                                                                                      │
│ Add test block inside defineConfig:                                                                                                                                  │
│ test: {                                                                                                                                                              │
│   globals: true,                                                                                                                                                     │
│   environment: 'jsdom',                                                                                                                                              │
│   setupFiles: ['./src/tests/setup.ts'],                                                                                                                              │
│   exclude: ['node_modules', 'dist'],                                                                                                                                 │
│   coverage: {                                                                                                                                                        │
│     provider: 'v8',                                                                                                                                                  │
│     reporter: ['text', 'lcov'],                                                                                                                                      │
│     exclude: ['node_modules/', 'dist/', 'src/tests/']                                                                                                                │
│   }                                                                                                                                                                  │
│ }                                                                                                                                                                    │
│                                                                                                                                                                      │
│ New: frontend/src/tests/setup.ts                                                                                                                                     │
│                                                                                                                                                                      │
│ import '@testing-library/jest-dom';                                                                                                                                  │
│                                                                                                                                                                      │
│ New: frontend/src/tests/smoke.test.tsx                                                                                                                               │
│                                                                                                                                                                      │
│ A minimal smoke test verifying the React app renders without crashing (mocks router and auth context).                                                               │
│                                                                                                                                                                      │
│ Add to ci.yml: frontend-tests job                                                                                                                                    │
│                                                                                                                                                                      │
│ frontend-tests:                                                                                                                                                      │
│   - npm ci in frontend/                                                                                                                                              │
│   - npm test                                                                                                                                                         │
│   - upload coverage lcov to Codecov (flags: frontend)                                                                                                                │
│ Add frontend-tests to Docker build needs: list.                                                                                                                      │
│                                                                                                                                                                      │
│ ---                                                                                                                                                                  │
│ Execution Order                                                                                                                                                      │
│                                                                                                                                                                      │
│ 1. Create .github/workflows/ci.yml (highest impact)                                                                                                                  │
│ 2. Update .github/workflows/docker-image.yml (add needs:)                                                                                                            │
│ 3. Update backend/test/package.json (test:ci + coverageThreshold + reporters)                                                                                        │
│ 4. Update backend/package.json (test:ci + husky + lint-staged)                                                                                                       │
│ 5. Create .codecov.yml                                                                                                                                               │
│ 6. Create CODE_OF_CONDUCT.md                                                                                                                                         │
│ 7. Create .github/PULL_REQUEST_TEMPLATE.md                                                                                                                           │
│ 8. Create .github/ISSUE_TEMPLATE/bug_report.yml                                                                                                                      │
│ 9. Create .github/ISSUE_TEMPLATE/feature_request.yml                                                                                                                 │
│ 10. Create .github/CODEOWNERS                                                                                                                                        │
│ 11. Create .husky/pre-commit                                                                                                                                         │
│ 12. Read each route file, then write corresponding test (5 new test files)                                                                                           │
│ 13. Update frontend/package.json (add vitest + testing-library)                                                                                                      │
│ 14. Update frontend/vite.config.ts (add test block)                                                                                                                  │
│ 15. Create frontend/src/tests/setup.ts and frontend/src/tests/smoke.test.tsx                                                                                         │
│                                                                                                                                                                      │
│ Verification                                                                                                                                                         │
│                                                                                                                                                                      │
│ # Confirm backend test:ci passes                                                                                                                                     │
│ cd backend/test && npm run test:ci                                                                                                                                   │
│                                                                                                                                                                      │
│ # Confirm backend lint passes                                                                                                                                        │
│ cd backend && npm run check                                                                                                                                          │
│                                                                                                                                                                      │
│ # Confirm frontend lint passes                                                                                                                                       │
│ cd frontend && npm run check                                                                                                                                         │
│                                                                                                                                                                      │
│ # Confirm frontend tests pass                                                                                                                                        │
│ cd frontend && npm test                                                                                                                                              │
│                                                                                                                                                                      │
│ Critical Files                                                                                                                                                       │
│                                                                                                                                                                      │
│ - .github/workflows/ci.yml — new, most important                                                                                                                     │
│ - .github/workflows/docker-image.yml — add needs:                                                                                                                    │
│ - backend/test/package.json — test:ci script + coverageThreshold + reporters                                                                                         │
│ - backend/package.json — test:ci script + husky devDeps + lint-staged                                                                                                │
│ - frontend/package.json — vitest devDeps + test scripts                                                                                                              │
│ - frontend/vite.config.ts — add test config block                                                                                                                    │
│ - backend/test/tests/helpers/mock-mongodb.js — reused by all 5 new route tests                                                                                       │
│                                                                                                                                                                      │
│ ---                                                                                                                                                                  │
│ Previously Completed (do not redo)                                                                                                                                   │
│                                                                                                                                                                      │
│ The following was completed in the previous session:                                                                                                                 │
│                                                                                                                                                                      │
│ Part X: Break up data/index.js                                                                                                                                       │
│                                                                                                                                                                      │
│ Strategy                                                                                                                                                             │
│                                                                                                                                                                      │
│ Extract domain sections into new files. Make index.js a thin aggregator that imports and re-exports everything. All existing consumers of require('../data')         │
│ continue to work with zero changes.                                                                                                                                  │
│                                                                                                                                                                      │
│ Shared dependency: helpers.js (create first)                                                                                                                         │
│                                                                                                                                                                      │
│ File: backend/src/data/helpers.js                                                                                                                                    │
│                                                                                                                                                                      │
│ Extract from index.js (lines 1–46, 145–149):                                                                                                                         │
│ - normalizeOrgId                                                                                                                                                     │
│ - buildOrgScopeQuery / addOrgScope / integrationOrgQuery / scheduledOrgQuery                                                                                         │
│ - fallbackDisabledError                                                                                                                                              │
│ - getCollection                                                                                                                                                      │
│ - isPlainObject, mergeConfigs, stripUiConfig                                                                                                                         │
│ - All mapper functions: mapIntegrationFromMongo, mapScheduledIntegrationFromMongo, mapLogFromMongo, mapAlertCenterLog, mapLookupFromMongo, mapOrgUnitDoc,            │
│ mapOrganizationToTenant, mapOrganizationSummary                                                                                                                      │
│                                                                                                                                                                      │
│ This file imports only: mongodb, config, logger, utils/time, utils/org-context                                                                                       │
│ No other data modules import it circularly.                                                                                                                          │
│                                                                                                                                                                      │
│ New domain modules to create                                                                                                                                         │
│                                                                                                                                                                      │
│ File: data/integrations.js                                                                                                                                           │
│ Functions extracted from index.js: listIntegrations, listIntegrationsForDelivery, getIntegration, getIntegrationById, getIntegrationByTypeAndDirection,              │
│ addIntegration,                                                                                                                                                      │
│   updateIntegration, deleteIntegration, bulkUpdateIntegrations, bulkDeleteIntegrations, listEventTypes, getParentRidForEntity, getAllowedParentRids,                 │
│   allowedParentsCache                                                                                                                                                │
│ Approx lines: ~510                                                                                                                                                   │
│ ────────────────────────────────────────                                                                                                                             │
│ File: data/logs.js                                                                                                                                                   │
│ Functions extracted from index.js: buildLogsQuery, listLogs, countLogs, getLogStatsSummary, streamLogsForExport, getLogById, recordLog, bulkRetryLogs,               │
│ bulkDeleteLogs                                                                                                                                                       │
│ Approx lines: ~288                                                                                                                                                   │
│ ────────────────────────────────────────                                                                                                                             │
│ File: data/alert-center.js                                                                                                                                           │
│ Functions extracted from index.js: listAlertCenterLogs, recordAlertCenterLog, mapAlertCenterLog                                                                      │
│ Approx lines: ~137                                                                                                                                                   │
│ ────────────────────────────────────────                                                                                                                             │
│ File: data/ui-config.js                                                                                                                                              │
│ Functions extracted from index.js: getUiConfigForEntity, getUiConfigOverride, upsertUiConfigOverride, clearUiConfigOverride, getUiConfigDefault,                     │
│ updateUiConfigDefault,                                                                                                                                               │
│   getSchedulerIntervalMinutes, getFailureReportSchedulerStatus                                                                                                       │
│ Approx lines: ~102                                                                                                                                                   │
│ ────────────────────────────────────────                                                                                                                             │
│ File: data/dashboard.js                                                                                                                                              │
│ Functions extracted from index.js: getDashboardSummary, getPendingEvents, markEventComplete, getTenant, getWorkerCheckpoint, setWorkerCheckpoint, listEventTypes     │
│ Approx lines: ~662                                                                                                                                                   │
│ ────────────────────────────────────────                                                                                                                             │
│ File: data/delivery.js                                                                                                                                               │
│ Functions extracted from index.js: getFailedLogsForRetry, markLogAsAbandoned, cleanupOldData, cleanupStuckRetryingLogs, checkCircuitState, recordDeliverySuccess,    │
│   recordDeliveryFailure                                                                                                                                              │
│ Approx lines: ~430                                                                                                                                                   │
│ ────────────────────────────────────────                                                                                                                             │
│ File: data/scheduled-integrations.js                                                                                                                                 │
│ Functions extracted from index.js: createScheduledIntegration, listScheduledIntegrations, getPendingScheduledIntegrations, updateScheduledIntegrationStatus,         │
│   resetStuckProcessingIntegrations, cancelScheduledIntegrationsByMatch, updateScheduledIntegration, deleteScheduledIntegration + scheduled aliases                   │
│ Approx lines: ~500                                                                                                                                                   │
│ ────────────────────────────────────────                                                                                                                             │
│ File: data/event-audit.js                                                                                                                                            │
│ Functions extracted from index.js: recordEventAudit, updateEventAudit, listEventAudit, getEventAuditById, getEventAuditStats, updateSourceCheckpoint,                │
│   getSourceCheckpoints, getSourceGaps, hashPayload, extractSafePayload, getBucketTimestamp, extractSourceMetadata, resolveOrgIdFromEvent, getSourceIdentifier,       │
│   getEventTypeSamplePayload, saveProcessedEvent, isEventAlreadyProcessed                                                                                             │
│ Approx lines: ~1118                                                                                                                                                  │
│ ────────────────────────────────────────                                                                                                                             │
│ File: data/users.js                                                                                                                                                  │
│ Functions extracted from index.js: getUserByEmail, getUserById, createUser, updateUser, setUserLastLogin, listUsers, countUsers                                      │
│ Approx lines: ~147                                                                                                                                                   │
│ ────────────────────────────────────────                                                                                                                             │
│ File: data/organizations.js                                                                                                                                          │
│ Functions extracted from index.js: listOrganizations, getOrganization, createOrganization, updateOrganization, deleteOrganization, listOrgUnits, createOrgUnit,      │
│   updateOrgUnit, deleteOrgUnit, listTenantIds, listTenantSummaries                                                                                                   │
│ Approx lines: ~264                                                                                                                                                   │
│ ────────────────────────────────────────                                                                                                                             │
│ File: data/lookups.js                                                                                                                                                │
│ Functions extracted from index.js: listLookups, getLookup, addLookup, updateLookup, deleteLookup, bulkCreateLookups, bulkDeleteLookups, resolveLookup,               │
│ reverseLookup,                                                                                                                                                       │
│   getLookupStats, getLookupTypes                                                                                                                                     │
│ Approx lines: ~606                                                                                                                                                   │
│                                                                                                                                                                      │
│ Updated index.js (thin aggregator)                                                                                                                                   │
│                                                                                                                                                                      │
│ Keeps only:                                                                                                                                                          │
│ - initDataLayer (MongoDB connect, TTL index setup, logger injection)                                                                                                 │
│ - MySQL availability management (isMysqlAvailable, attemptMysqlReconnect, startMysqlReconnection, stopMysqlReconnection, mysqlAvailable state)                       │
│                                                                                                                                                                      │
│ Then re-exports everything:                                                                                                                                          │
│ const helpers = require('./helpers');                                                                                                                                │
│ const integrations = require('./integrations');                                                                                                                      │
│ // ... all modules                                                                                                                                                   │
│                                                                                                                                                                      │
│ module.exports = {                                                                                                                                                   │
│   initDataLayer,                                                                                                                                                     │
│   isMysqlAvailable,                                                                                                                                                  │
│   // spread all domain modules                                                                                                                                       │
│   ...integrations,                                                                                                                                                   │
│   ...logs,                                                                                                                                                           │
│   // etc — preserving exact same public API                                                                                                                          │
│ };                                                                                                                                                                   │
│                                                                                                                                                                      │
│ Each module file structure                                                                                                                                           │
│                                                                                                                                                                      │
│ // data/integrations.js                                                                                                                                              │
│ const { getCollection, fallbackDisabledError, normalizeOrgId, mapIntegrationFromMongo, ... } = require('./helpers');                                                 │
│ const { log, logError } = require('../logger');                                                                                                                      │
│ const mongodb = require('../mongodb');                                                                                                                               │
│                                                                                                                                                                      │
│ async function listIntegrations(orgId) { ... }                                                                                                                       │
│ // ...                                                                                                                                                               │
│                                                                                                                                                                      │
│ module.exports = { listIntegrations, ... };                                                                                                                          │
│                                                                                                                                                                      │
│ Key cross-module call to handle                                                                                                                                      │
│                                                                                                                                                                      │
│ listIntegrationsForDelivery calls listIntegrations and getParentRidForEntity — both stay in integrations.js, so no cross-module issue.                               │
│ dashboard.js calls getTenant and getPendingEvents which reference the queue — keep these together in dashboard.js.                                                   │
│                                                                                                                                                                      │
│ Files NOT changed                                                                                                                                                    │
│                                                                                                                                                                      │
│ All existing data files (dlq.js, event-sources.js, execution-logs.js, templates.js, store.js, ai-config.js, system-config.js, queue.js) are untouched.               │
│ All route files, workers, middleware — untouched.                                                                                                                    │
│                                                                                                                                                                      │
│ ---                                                                                                                                                                  │
│ Part 2: Integration Tests                                                                                                                                            │
│                                                                                                                                                                      │
│ Test files to create in backend/test/tests/                                                                                                                          │
│                                                                                                                                                                      │
│ Follow existing patterns: jest.mock('../../src/mongodb', ...), supertest for HTTP, beforeEach(() => jest.clearAllMocks()).                                           │
│                                                                                                                                                                      │
│ 1. routes-health.test.js                                                                                                                                             │
│ - GET /health → 200 with { status: 'ok' }                                                                                                                            │
│ - Tests app boots and responds                                                                                                                                       │
│                                                                                                                                                                      │
│ 2. routes-auth.test.js (replace/extend existing thin auth test)                                                                                                      │
│ - POST /api/v1/auth/login with valid credentials → 200 + accessToken                                                                                                 │
│ - POST /api/v1/auth/login with wrong password → 401                                                                                                                  │
│ - POST /api/v1/auth/login with missing fields → 400                                                                                                                  │
│ - GET /api/v1/auth/me without token → 401                                                                                                                            │
│                                                                                                                                                                      │
│ 3. routes-outbound-integrations.test.js                                                                                                                              │
│ - GET /api/v1/outbound-integrations with API key → 200 + array                                                                                                       │
│ - GET /api/v1/outbound-integrations without auth → 401                                                                                                               │
│ - POST /api/v1/outbound-integrations with valid body → 201                                                                                                           │
│ - POST /api/v1/outbound-integrations with missing targetUrl → 400                                                                                                    │
│ - DELETE /api/v1/outbound-integrations/:id → 200                                                                                                                     │
│                                                                                                                                                                      │
│ 4. routes-logs.test.js                                                                                                                                               │
│ - GET /api/v1/logs with auth → 200 + { logs, total }                                                                                                                 │
│ - GET /api/v1/logs?status=FAILED → 200 + filtered results                                                                                                            │
│ - GET /api/v1/logs without auth → 401                                                                                                                                │
│                                                                                                                                                                      │
│ 5. routes-lookups.test.js                                                                                                                                            │
│ - GET /api/v1/lookups → 200 + array                                                                                                                                  │
│ - POST /api/v1/lookups with valid body → 201                                                                                                                         │
│ - PUT /api/v1/lookups/:id → 200                                                                                                                                      │
│ - DELETE /api/v1/lookups/:id → 200                                                                                                                                   │
│                                                                                                                                                                      │
│ Mock setup pattern (reuse across all tests)                                                                                                                          │
│                                                                                                                                                                      │
│ Create backend/test/tests/helpers/mock-mongodb.js:                                                                                                                   │
│ // Shared mock factory — imported by all route tests                                                                                                                 │
│ function createMockCollection(overrides = {}) {                                                                                                                      │
│   return {                                                                                                                                                           │
│     find: jest.fn().mockReturnValue({                                                                                                                                │
│       sort: jest.fn().mockReturnThis(),                                                                                                                              │
│       limit: jest.fn().mockReturnThis(),                                                                                                                             │
│       skip: jest.fn().mockReturnThis(),                                                                                                                              │
│       toArray: jest.fn().mockResolvedValue([])                                                                                                                       │
│     }),                                                                                                                                                              │
│     findOne: jest.fn().mockResolvedValue(null),                                                                                                                      │
│     insertOne: jest.fn().mockResolvedValue({ insertedId: 'mock_id' }),                                                                                               │
│     updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),                                                                                                    │
│     deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),                                                                                                     │
│     countDocuments: jest.fn().mockResolvedValue(0),                                                                                                                  │
│     aggregate: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) })                                                                               │
│   };                                                                                                                                                                 │
│ }                                                                                                                                                                    │
│ module.exports = { createMockCollection };                                                                                                                           │
│                                                                                                                                                                      │
│ Running tests                                                                                                                                                        │
│                                                                                                                                                                      │
│ cd backend && npm test                    # runs cd test && npm install && npm test                                                                                  │
│ cd backend/test && npm test -- --testPathPattern=routes-  # run only new route tests                                                                                 │
│ cd backend/test && npm run test:coverage  # coverage report                                                                                                          │
│                                                                                                                                                                      │
│ ---                                                                                                                                                                  │
│ Execution Order                                                                                                                                                      │
│                                                                                                                                                                      │
│ 1. Create data/helpers.js (shared foundation — must be first)                                                                                                        │
│ 2. Create domain modules one at a time, verifying each compiles                                                                                                      │
│ 3. Update data/index.js to be the thin aggregator                                                                                                                    │
│ 4. Run node -e "require('./src/data')" from backend/ to verify no import errors                                                                                      │
│ 5. Create test/tests/helpers/mock-mongodb.js                                                                                                                         │
│ 6. Create the 5 route test files                                                                                                                                     │
│ 7. Run npm test from backend/ to verify all tests pass                                                                                                               │
│                                                                                                                                                                      │
│ Critical Files                                                                                                                                                       │
│                                                                                                                                                                      │
│ - backend/src/data/index.js — being split (5,189 lines)                                                                                                              │
│ - backend/src/mongodb.js — imported by every new module                                                                                                              │
│ - backend/src/logger.js — imported by every new module                                                                                                               │
│ - backend/src/config.js — imported by several modules                                                                                                                │
│ - backend/test/package.json — test runner config                                                                                                                     │
│ - backend/test/tests/auth.test.js — reference pattern for mocking                                                                                                    │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯