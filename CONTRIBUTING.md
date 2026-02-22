# Contributing to Integration Control Plane

Thank you for considering contributing to Integration Control Plane! This guide will help you get started.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## How Can I Contribute?

### Reporting Bugs

Before creating a bug report, check existing issues to avoid duplicates. Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.yml) and include:

- Clear, descriptive title
- Steps to reproduce
- Expected vs actual behavior
- Environment details (Node version, MongoDB version, Docker/bare metal)
- Relevant logs or screenshots

### Suggesting Features

Use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.yml) and explain:

- The problem you're trying to solve
- Your proposed solution
- Who benefits from this feature

### Pull Requests

1. **Fork the repo** and create your branch from `main`:
   ```bash
   git checkout -b feature/my-new-feature
   ```

2. **Make your changes** following the code style guidelines below

3. **Add tests** for any new code (see [Testing](#testing) below)

4. **Ensure CI passes locally**:
   ```bash
   # Backend
   cd backend && npm run check && npm test

   # Frontend
   cd frontend && npm run check && npm test
   ```

5. **Write clear commit messages** using [Conventional Commits](https://www.conventionalcommits.org/):
   ```
   type(scope): subject
   ```
   Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`

   Examples:
   ```
   feat(integrations): add GraphQL webhook support
   fix(auth): resolve JWT token expiration issue
   test(dlq): add bulk retry route tests
   ```

6. **Push to your fork** and open a pull request to `main`

## Development Setup

### Prerequisites

- Node.js 18+
- MongoDB 6.0+
- Docker 20.10+ (optional)
- Git

### Local Development

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/integration-control-plane.git
cd integration-control-plane

# Backend
cd backend
npm install
cp config.example.json config.json   # Edit with your local settings

# Frontend
cd ../frontend
npm install
cp .env.example .env

# Start development servers
cd ../backend && npm run dev   # Terminal 1
cd ../frontend && npm run dev  # Terminal 2
```

### Pre-commit Hooks

This project uses [Husky](https://typicode.github.io/husky/) with lint-staged. After `npm install` in `backend/`, Biome will auto-format staged files on every commit. No setup required — it runs automatically.

## Code Style

We use **[Biome](https://biomejs.dev/)** for formatting and linting (not ESLint/Prettier):

```bash
# Check for issues
npm run check

# Auto-fix
npm run check:fix
```

All code must pass `npm run check` before merging. The pre-commit hook handles this automatically for staged files.

## Testing

### Backend Tests (Jest + Supertest)

```bash
cd backend
npm test                    # Run all tests
npm run test:ci             # CI mode with coverage

# Run specific test files
cd test
npx jest --testPathPattern=routes-dlq
npx jest --testPathPattern=routes-users
```

**Coverage thresholds** are enforced in CI — new code in PRs should aim for 50%+ coverage.

#### Writing Backend Route Tests

All route tests follow a consistent pattern. Here's a minimal example:

```javascript
'use strict';

const express = require('express');
const request = require('supertest');

// Mock dependencies before requiring route
jest.mock('../../src/mongodb', () => ({
  getDb: jest.fn(),
  getDbSafe: jest.fn(),
  isConnected: jest.fn(() => true)
}));

jest.mock('../../src/db', () => ({
  isConfigured: jest.fn(() => false),
  ping: jest.fn(async () => false)
}));

jest.mock('../../src/data/store', () => ({
  initStore: jest.fn(async () => {}),
  getTenant: jest.fn(() => null),
  findTenantByChildRid: jest.fn(() => null)
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
  logError: jest.fn(),
  requestLogger: (_req, _res, next) => next(),
  setDb: jest.fn(),
  closeLogStreams: jest.fn()
}));

jest.mock('../../src/config', () => ({
  api: { basePrefix: '/api/v1' },
  security: { jwtSecret: 'test-secret' },
  worker: {}
}));

jest.mock('../../src/middleware/rate-limit', () => (_req, _res, next) => next());
jest.mock('../../src/middleware/request-id', () => (req, _res, next) => {
  req.id = 'req-test-id';
  next();
});

// Mock your data layer
const mockData = {
  listItems: jest.fn(async () => []),
};
jest.mock('../../src/data', () => mockData);

function buildApp() {
  const app = express();
  app.use(express.json());

  // Inject auth context
  app.use((req, _res, next) => {
    req.orgId = 1;
    req.user = { id: 'user-123' };
    next();
  });

  const router = require('../../src/routes/your-route');
  const errorHandler = require('../../src/middleware/error-handler');

  app.use('/api/v1/your-route', router);
  app.use(errorHandler);
  return app;
}

describe('Your Route', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  it('returns 200 with items', async () => {
    const res = await request(app).get('/api/v1/your-route');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('items');
  });
});
```

Key patterns:
- **Always mock** `mongodb`, `db`, `data/store`, `logger`, `config`, `rate-limit`, `request-id`
- **Use `buildApp()`** in `beforeEach` so each test gets a fresh Express app
- **Call `jest.clearAllMocks()`** in `beforeEach` to reset all mock call counts
- **Mock the data layer**, not MongoDB collections directly (tests should exercise route logic, not DB queries)
- **Use exact assertions** — `toBe(200)`, not `toBeOneOf([200, 201])`
- **Test both success and error paths** — 200, 400, 404, etc.
- Routes using `ObjectId` from mongodb require **valid 24-character hex strings** as test IDs (e.g., `'507f1f77bcf86cd799439011'`)

### Frontend Tests (Vitest + Testing Library)

```bash
cd frontend
npm test                    # Run all tests
npm run test:watch          # Watch mode
npm run test:coverage       # With coverage report
```

Frontend tests use [Vitest](https://vitest.dev/) with [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/). Place test files in `src/tests/` or colocate them with components as `*.test.tsx`.

## Multi-Tenancy

All data is scoped by `orgId`. The middleware extracts this from JWT/API key context and injects it into every query. **Always include `orgId`** when writing new data layer queries — never query across tenants.

## Project Structure

```
integration-control-plane/
├── backend/
│   ├── src/
│   │   ├── routes/        # Express routers (20+ files)
│   │   ├── data/          # MongoDB data access (domain modules)
│   │   ├── services/      # Business logic + AI providers
│   │   ├── middleware/     # Auth, RBAC, rate-limit, error handling
│   │   ├── workers/       # Background processes
│   │   └── rbac/          # Role/permission definitions
│   └── test/              # Jest test suite
├── frontend/
│   ├── src/
│   │   ├── features/      # Domain feature modules
│   │   ├── components/    # Shared UI components
│   │   ├── services/      # API client (Axios)
│   │   └── tests/         # Vitest test suite
├── .github/
│   ├── workflows/         # CI + Docker build pipelines
│   └── ISSUE_TEMPLATE/    # Bug report + feature request forms
└── docker-compose.yml
```

## Branching Strategy

- `main` — Production-ready code
- `feature/*` — New features
- `fix/*` — Bug fixes
- `docs/*` — Documentation updates
- `refactor/*` — Code refactoring

## Pull Request Process

1. Fill out the [PR template](.github/PULL_REQUEST_TEMPLATE.md) completely
2. Ensure all CI checks pass (tests, linting, build)
3. Maintainers will review within 48-72 hours on weekdays
4. Address any requested changes and push updates
5. Maintainers will merge once approved

## Release Process

Releases follow [Semantic Versioning](https://semver.org/):
- **MAJOR**: Breaking changes
- **MINOR**: New features (backwards compatible)
- **PATCH**: Bug fixes (backwards compatible)

## License

By contributing, you agree that your contributions will be licensed under the [GNU Affero General Public License v3.0](LICENSE).
