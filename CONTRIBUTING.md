# Contributing to Integration Gateway

First off, thank you for considering contributing to Integration Gateway! It's people like you that make Integration Gateway such a great tool.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the existing issues to see if the problem has already been reported. When you are creating a bug report, please include as many details as possible:

* **Use a clear and descriptive title**
* **Describe the exact steps to reproduce the problem**
* **Provide specific examples** (code snippets, screenshots, logs)
* **Describe the behavior you observed and what you expected**
* **Include your environment details** (OS, Node version, MongoDB version, Docker version)

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, please include:

* **Use a clear and descriptive title**
* **Provide a step-by-step description** of the suggested enhancement
* **Provide specific examples** to demonstrate the enhancement
* **Explain why this enhancement would be useful** to most users

### Pull Requests

1. **Fork the repo** and create your branch from `main`:
   ```bash
   git checkout -b feature/my-new-feature
   ```

2. **Make your changes** following our code style guidelines

3. **Add tests** if you've added code that should be tested

4. **Ensure the test suite passes**:
   ```bash
   cd backend && npm test
   cd frontend && npm test
   ```

5. **Update documentation** if you've changed APIs or added features

6. **Write clear commit messages** following the format:
   ```
   type(scope): subject

   body (optional)

   footer (optional)
   ```
   Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

7. **Push to your fork** and submit a pull request to the `main` branch

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

# Install backend dependencies
cd backend
npm install
cp config.example.json config.json
# Edit config.json with your local settings

# Install frontend dependencies
cd ../frontend
npm install
cp .env.example .env

# Start development servers
cd ../backend && npm run dev  # Terminal 1
cd ../frontend && npm run dev # Terminal 2
```

### Running Tests

```bash
# Backend tests
cd backend
npm test

# Frontend tests
cd frontend
npm test

# Integration tests
cd backend
npm run test:integration
```

### Code Style

We use **Biome** for code formatting and linting:

```bash
# Format code
npm run format

# Lint code
npm run lint

# Auto-fix linting issues
npm run lint:fix
```

**Important**: All code must pass linting before being merged.

## Project Structure

```
integration-gateway/
├── backend/               # Node.js backend
│   ├── src/
│   │   ├── routes/       # API route handlers
│   │   ├── services/     # Business logic
│   │   ├── data/         # Data access layer
│   │   ├── middleware/   # Express middleware
│   │   ├── processor/    # Background workers
│   │   └── utils/        # Utility functions
│   └── test/             # Backend tests
├── frontend/              # React frontend
│   ├── src/
│   │   ├── features/     # Feature modules
│   │   ├── components/   # Reusable components
│   │   ├── services/     # API clients
│   │   └── hooks/        # Custom React hooks
│   └── tests/            # Frontend tests
├── docs/                  # Documentation
├── scripts/               # Utility scripts
└── docker-compose.yml     # Docker setup
```

## Branching Strategy

- `main` - Production-ready code
- `develop` - Integration branch for features (if adopted)
- `feature/*` - New features
- `fix/*` - Bug fixes
- `docs/*` - Documentation updates
- `refactor/*` - Code refactoring

## Commit Message Guidelines

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, missing semicolons, etc.)
- `refactor`: Code refactoring (neither fixes a bug nor adds a feature)
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `chore`: Build process or auxiliary tool changes

**Examples:**
```
feat(integrations): add support for GraphQL webhooks
fix(auth): resolve JWT token expiration issue
docs(readme): update quick start guide
refactor(delivery): extract retry logic into separate service
```

## Testing Guidelines

### Backend Tests

- Write unit tests for all business logic in `services/`
- Write integration tests for API endpoints in `routes/`
- Use meaningful test descriptions
- Aim for >80% code coverage

**Example:**
```javascript
describe('Integration Service', () => {
  describe('createIntegration', () => {
    it('should create integration with valid data', async () => {
      // Test implementation
    });

    it('should reject integration with invalid URL', async () => {
      // Test implementation
    });
  });
});
```

### Frontend Tests

- Write component tests using React Testing Library
- Test user interactions and edge cases
- Mock API calls appropriately

## Documentation

- Update README.md for user-facing changes
- Update relevant docs under `docs/` for endpoint or behavior changes
- Add inline JSDoc comments for complex functions
- Update architecture docs in `docs/architecture/` for system design changes

## Pull Request Process

1. **Update the README.md** with details of changes to the interface (if applicable)
2. **Update the CHANGELOG.md** following the [Keep a Changelog](https://keepachangelog.com/) format
3. **Ensure all CI checks pass** (tests, linting, build)
4. **Get at least one review** from a maintainer
5. **Squash commits** before merge if requested
6. **Merge** will be done by maintainers once approved

## Review Process

Maintainers will review your PR and may:
- Approve and merge
- Request changes (address feedback and push updates)
- Close (if not aligned with project goals - rare)

**Timeline**: Expect initial feedback within 48-72 hours on weekdays.

## Release Process

Releases follow [Semantic Versioning](https://semver.org/):

- **MAJOR** (v2.0.0): Breaking changes
- **MINOR** (v1.1.0): New features (backwards compatible)
- **PATCH** (v1.0.1): Bug fixes (backwards compatible)

Releases are managed by maintainers and published to GitHub Releases.

## Community Guidelines

- **Be respectful** and inclusive
- **Be patient** with new contributors
- **Give constructive feedback**
- **Assume good intentions**
- **Focus on the code**, not the person

## Getting Help

- **Documentation**: Check [docs/](docs/) first
- **GitHub Issues**: Search existing issues or create a new one
- **Discussions**: Use GitHub Discussions for questions

## Recognition

Contributors will be recognized in:
- The project's README.md (Contributors section)
- GitHub's contribution graph
- Release notes for significant contributions

## License

By contributing, you agree that your contributions will be licensed under the GNU Affero General Public License v3.0.

---

Thank you for contributing to Integration Gateway! 🎉
