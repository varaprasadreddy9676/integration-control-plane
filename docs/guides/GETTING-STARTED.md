# Getting Started (Quick Reference)

This quick guide covers the fastest way to run Integration Gateway with accurate current defaults.

---

## 1. Recommended: Docker

```bash
git clone https://github.com/varaprasadreddy9676/integration-control-plane.git
cd integration-control-plane
```

Optional `.env` overrides:

```bash
cat > .env <<'EOF'
API_KEY=change_me_dev_key
JWT_SECRET=change_me_dev_secret
MONGODB_URI=mongodb://mongodb:27017/integration_gateway
MONGODB_DATABASE=integration_gateway
FRONTEND_URL=http://localhost
EOF
```

Start stack:

```bash
docker compose up -d --build
```

Verify:

```bash
docker compose ps
curl http://localhost:3545/
curl http://localhost:3545/health
```

Open:

- UI: `http://localhost/integration-gateway/` (root URL also works)
- API base: `http://localhost:3545/api/v1`

Health semantics:

- `GET /` is liveness.
- `GET /health` reports dependency/system health and may return non-200 when degraded.

---

## 2. Local Development (Without Docker)

### Backend

```bash
cd backend
npm install
```

Configure either env vars or `config.json`:

```bash
export MONGODB_URI="mongodb://localhost:27017/integration_gateway"
export MONGODB_DATABASE="integration_gateway"
export API_KEY="change_me_dev_key"
export JWT_SECRET="change_me_dev_secret"
npm run dev
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Frontend dev server default: `http://localhost:5175`

Ensure `frontend/.env` contains:

- `VITE_API_BASE_URL=http://localhost:3545/api/v1`
- `VITE_API_KEY=<same as backend API_KEY>`

---

## 3. Useful Commands

Docker logs:

```bash
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f mongodb
```

Backend file logs (inside container):

```bash
docker compose exec backend sh -lc "ls -la /app/logs"
```

Create first admin user (Docker stack):

```bash
docker compose exec backend node scripts/create-user.js \
  --email admin@example.com \
  --password 'ChangeMe123!' \
  --role ADMIN
```
