# Production Deployment Guide

Integration Control Plane (ICPlane) is designed to be highly available, scalable, and secure in production environments. This guide covers the recommended topology and configuration for a true production deployment, moving beyond the simple `docker-compose.yml` evaluation setup.

## 1. System Topology

In production, you should **never** run the database and the application on the same single node. The recommended topology is:

### The Application Tier (Stateless)
The `backend` container (API and background workers) and the `frontend` container (Nginx serving React) are completely stateless.
- **Horizontal Scaling**: You can spin up multiple instances of the `backend` container behind a load balancer.
- **Background Workers**: Workers use MongoDB state/checkpoint collections. Multi-instance operation is supported, but you should validate duplicate-handling semantics for your workload before scaling aggressively.

### The Database Tier (Stateful)
- **MongoDB**: This is the **mandatory** primary datastore. In production, use a **MongoDB Replica Set** (minimum 3 nodes) or a managed service like MongoDB Atlas.
- **MySQL/Kafka (Optional)**: If you use these as event sources, they should also be managed clusters.

## 2. Environment Variables & Configuration

In production, avoid mounting a local `config.json` file if possible. Instead, utilize environment variables for sensitive overrides or inject the configuration via Kubernetes Secrets / AWS Secrets Manager.

### Critical Production Secrets
These must be securely generated and injected into the backend container:

| Variable | Description | Example |
|----------|-------------|---------|
| `API_KEY` | API key expected by backend middleware. | `generate_a_long_random_string` |
| `JWT_SECRET` | Secret used to sign JWT tokens. | `generate_an_even_long_random_string` |
| `MONGODB_URI` | Connection string to your MongoDB cluster. | `mongodb+srv://user:pass@cluster.mongodb.net/integration_gateway` |

### Important URL Configurations
The backend needs to know where it is hosted and where the frontend is hosted for links and magic URLs to generate correctly:

| Variable | Description |
|----------|-------------|
| `FRONTEND_URL` | The public-facing URL of the frontend UI (e.g., `https://gateway.yourdomain.com`). Used for alert emails and embedded portal links. |

### Environment File Resolution

Backend env resolution is deterministic:

1. repository root `.env`
2. optional `backend/.env` override

Startup behavior no longer depends on whether the service is launched from repo root or from `backend/`.

## 3. High Availability (HA) Guidelines

### Load Balancing
Place a Layer 7 Load Balancer (like AWS ALB, Nginx, or HAProxy) in front of the application.
- Terminate SSL/TLS at the load balancer.
- Route `/api/*` traffic to the `backend` containers (port 3545).
- Route all other traffic to the `frontend` containers (port 80).

### Health Checks
Configure your orchestrator (Kubernetes, ECS, Docker Swarm) to use the built-in health endpoints:
- **Backend liveness**: `HTTP GET /` (expect non-5xx)
- **Backend dependency health**: `HTTP GET /health` (may return non-200 when degraded)
- **Backend runtime status**: `HTTP GET /api/v1/system-status?orgId=<orgId>`
- **Frontend**: `HTTP GET /health` (expect 200)

Use `/` for restart/liveness decisions and `/health` for monitoring/alerting.

## 4. Resource Limits & Tuning

### Node.js Memory Limits
The Docker image runs Node.js. By default, V8 memory limits might not match your container limits.
- Set the `NODE_OPTIONS="--max-old-space-size=X"` environment variable where X is ~80% of your container's RAM limit in MB.
- Example: If your container has 2GB RAM, set `NODE_OPTIONS="--max-old-space-size=1638"`

### Application Tuning (`config.json` parameters)
Adjust these in your `config.json` for high-throughput environments:

```json
{
  "mongodb": {
    "options": {
      "maxPoolSize": 200, // Increase if running high API traffic
      "minPoolSize": 20
    }
  },
  "worker": {
    "intervalMs": 2000,    // Poll event source more frequently (default 5000)
    "batchSize": 20,       // Process more events per cycle (default 5)
    "retryIntervalMs": 30000 // Process DLQ retries faster (default 60000)
  }
}
```

## 5. Security Checklist

- [ ] **Network Isolation**: MongoDB should be in a private subnet, accessible only by the backend containers.
- [ ] **TLS/SSL**: All external traffic must go over HTTPS. Enable `"enforceHttps": true` in the security config if the Node.js process itself is directly exposed (otherwise handled by your Load Balancer).
- [ ] **Inbound Request Policy**: Configure per-integration IP allowlists / browser origins / per-integration rate limits for public inbound routes.
- [ ] **Rate Limiting**: The app has built-in soft rate limiting, but you should configure hardware/WAF rate limiting at your load balancer/Cloudflare level for DDoS protection.
- [ ] **Audit Logs**: Ensure you configure a log aggregator (like Datadog, Splunk, or CloudWatch) to ingest the standard out (stdout) logs from the backend containers for audit and compliance.
- [ ] **Operator Surface Protection**: Restrict `/api/v1/system-status` and `/api/v1/system-logs` to trusted admin/operator access paths.

## Example: Production Docker Run Command

```bash
docker run -d \
  --name icplane-backend \
  --restart always \
  -p 3545:3545 \
  -e NODE_ENV=production \
  -e MONGODB_URI="mongodb+srv://admin:pass@prod-cluster.xyz.mongodb.net/integration_gateway" \
  -e API_KEY="super_secret_api_key" \
  -e JWT_SECRET="super_secret_jwt_signature_key" \
  -e FRONTEND_URL="https://icplane.yourcompany.com" \
  -e MONGODB_DATABASE="integration_gateway" \
  -e NODE_OPTIONS="--max-old-space-size=2048" \
  ghcr.io/varaprasadreddy9676/integration-control-plane-backend:main
```

## 6. URL Path Configuration

By default, the Docker image serves the SPA at root and supports `/integration-gateway/` asset pathing.

- **Why?** This is the most portable setting for modern Docker environments and reverse proxies.
- **Custom Subpaths**: If you must serve from a different prefix (e.g., `yourdomain.com/portal/`), handle rewrite/routing at your reverse proxy.

## 7. Apache SPA Troubleshooting

If you deploy the frontend behind Apache using symlinks under `/var/www/html`, see:

- [APACHE-SPA-TROUBLESHOOTING.md](/Users/sai/Documents/GitHub/integration-control-plane/docs/guides/APACHE-SPA-TROUBLESHOOTING.md)

This covers:

- `403 Forbidden` caused by broken symlinks or inaccessible symlink targets
- `404 Not Found` on deep-route refresh when SPA fallback is missing
- the recommended `Alias` + `FallbackResource` Apache configuration for `/integration-gateway/`

## 8. Operator Endpoints

Useful operator endpoints in production:

- `GET /health`
- `GET /api/v1/system-status?orgId=<orgId>`
- `GET /api/v1/system-logs?source=app`
- `GET /api/v1/system-logs?source=access`
- `GET /api/v1/system-logs/process-tail?lines=200`
