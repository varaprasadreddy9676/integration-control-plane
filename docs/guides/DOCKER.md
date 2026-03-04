# Docker Guide

This guide covers running Integration Gateway with Docker Compose.

## Stack

`docker-compose.yml` runs:

- `mongodb` (required)
- `backend` (Express API + workers)
- `frontend` (Nginx serving built React app)

`docker-compose.dev.yml` runs the same stack with hot reload for backend/frontend.

## Prerequisites

- Docker 20.10+
- Docker Compose v2 (`docker compose`)

## Production-Style Local Run

1. (Optional) create root `.env` overrides.

```bash
cat > .env <<'EOF'
API_KEY=change_me_dev_key
JWT_SECRET=change_me_dev_secret
MONGODB_URI=mongodb://mongodb:27017/integration_gateway
MONGODB_DATABASE=integration_gateway
EOF
```

2. Start services.

```bash
docker compose up -d --build
```

3. Verify.

```bash
docker compose ps
curl http://localhost:3545/
curl http://localhost:3545/health
```

4. Open app.

- Frontend: `http://localhost/integration-gateway/` (root `http://localhost` also works)
- API: `http://localhost:3545/api/v1`

Health semantics:
- `GET /` -> liveness endpoint (used by container health checks)
- `GET /health` -> dependency/system health and may return non-200 when degraded

## Development Run (Hot Reload)

1. Prepare frontend env (optional).

```bash
cp frontend/.env.example frontend/.env
```

2. Start dev stack.

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

3. Open dev URLs.

- Frontend (Vite): `http://localhost:5175`
- API: `http://localhost:3545/api/v1`
- Node inspect port: `localhost:9229`

## Common Commands

```bash
# Start/stop
docker compose up -d
docker compose down

# Logs
docker compose logs -f
docker compose logs -f backend
docker compose logs -f frontend

# Shell access
docker compose exec backend sh
docker compose exec mongodb mongosh integration_gateway

# Rebuild
docker compose build --no-cache
```

## MySQL Notes

MySQL is optional.

- For org-specific MySQL event sources, configure via Event Source settings/API.
- For a shared/global MySQL source, configure through runtime config/admin APIs or provide config file overrides only when needed.
- Backend enforces MySQL safety caps to prevent overload:
  - Shared pool: `connectionLimit` 1..20, `queueLimit` 0..200
  - Dedicated pool: `connectionLimit` 1..5, `queueLimit` 0..50
  - Source tuning: `pollIntervalMs` 1000..300000, `batchSize` 1..100, `dbTimeoutMs` 1000..120000

## Troubleshooting

- Port already in use:

```bash
lsof -nP -iTCP:3545 -sTCP:LISTEN
lsof -nP -iTCP:80 -sTCP:LISTEN
lsof -nP -iTCP:27017 -sTCP:LISTEN
```

- Backend cannot reach MongoDB:
  - Confirm `MONGODB_URI` uses `mongodb` hostname inside Docker network.
  - Check `docker compose logs mongodb`.

- Frontend cannot call API:
  - Confirm backend is healthy on `http://localhost:3545/health`.
  - Confirm frontend is up and `VITE_API_BASE_URL` points to `http://localhost:3545/api/v1`.
