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

1. Prepare backend config.

```bash
cp backend/config.example.json backend/config.json
```

2. Edit `backend/config.json`.

- Set Mongo to Docker hostname:
  - `mongodb.uri: mongodb://mongodb:27017/integration_gateway`
- Set secure values:
  - `security.apiKey`
  - `security.jwtSecret`
- Keep `eventSource.type` empty unless you want a global default source.
- Configure `db.*` only if you need a shared MySQL source.

3. Start services.

```bash
docker compose up -d --build
```

4. Verify.

```bash
docker compose ps
curl http://localhost:3545/health
```

5. Open app.

- Frontend: `http://localhost`
- API: `http://localhost:3545/api/v1`

## Development Run (Hot Reload)

1. Prepare config files.

```bash
cp backend/config.example.json backend/config.json
cp frontend/.env.example frontend/.env
```

2. Ensure backend Mongo URI uses Docker hostname:

- `mongodb://mongodb:27017/integration_gateway`

3. Start dev stack.

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

4. Open dev URLs.

- Frontend (Vite): `http://localhost:5173`
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

- For tenant-specific MySQL event sources, configure via Event Source settings/API.
- For a shared/global MySQL source, set `db.*` in `backend/config.json`.
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
  - Confirm `mongodb.uri` uses `mongodb` hostname inside Docker config.
  - Check `docker compose logs mongodb`.

- Frontend cannot call API:
  - Confirm backend is healthy on `http://localhost:3545/health`.
  - Confirm frontend is up and `VITE_API_BASE_URL` points to `http://localhost:3545/api/v1`.
