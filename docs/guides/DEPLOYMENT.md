# Production Deployment Guide

Integration Control Plane (ICPlane) is designed to be highly available, scalable, and secure in production environments. This guide covers the recommended topology and configuration for a true production deployment, moving beyond the simple `docker-compose.yml` evaluation setup.

## 1. System Topology

In production, you should **never** run the database and the application on the same single node. The recommended topology is:

### The Application Tier (Stateless)
The `backend` container (API and background workers) and the `frontend` container (Nginx serving React) are completely stateless.
- **Horizontal Scaling**: You can spin up multiple instances of the `backend` container behind a load balancer.
- **Background Workers**: The workers (Delivery, Scheduler, DLQ) use MongoDB for checkpointing and state management, meaning it is **safe to run multiple backend containers simultaneously**. They will naturally distribute the load without processing the same event twice.

### The Database Tier (Stateful)
- **MongoDB**: This is the **mandatory** primary datastore. In production, you MUST use a **MongoDB Replica Set** (minimum 3 nodes) or a managed service like MongoDB Atlas. The application relies on MongoDB for high availability and ACID transactions during worker checkpointing.
- **MySQL/Kafka (Optional)**: If you use these as event sources, they should also be managed clusters.

## 2. Environment Variables & Configuration

In production, avoid mounting a local `config.json` file if possible. Instead, utilize environment variables for sensitive overrides or inject the configuration via Kubernetes Secrets / AWS Secrets Manager.

### Critical Production Secrets
These must be securely generated and injected into the backend container:

| Variable | Description | Example |
|----------|-------------|---------|
| `SECURITY_API_KEY` | The master API key for programmatic admin access. | `generate_a_long_random_string` |
| `SECURITY_JWT_SECRET` | Secret used to sign user and magic link tokens. | `generate_an_even_longer_random_string` |
| `MONGODB_URI` | Connection string to your MongoDB cluster. | `mongodb+srv://user:pass@cluster.mongodb.net/integration_gateway` |

### Important URL Configurations
The backend needs to know where it is hosted and where the frontend is hosted for links and magic URLs to generate correctly:

| Variable | Description |
|----------|-------------|
| `PUBLIC_URL` | The public-facing URL of the backend API (e.g., `https://api.gateway.yourdomain.com`). |
| `FRONTEND_URL` | The public-facing URL of the frontend UI (e.g., `https://gateway.yourdomain.com`). Used for alert emails and embedded portal links. |

## 3. High Availability (HA) Guidelines

### Load Balancing
Place a Layer 7 Load Balancer (like AWS ALB, Nginx, or HAProxy) in front of the application.
- Terminate SSL/TLS at the load balancer.
- Route `/api/*` traffic to the `backend` containers (port 3545).
- Route all other traffic to the `frontend` containers (port 80).

### Health Checks
Configure your orchestrator (Kubernetes, ECS, Docker Swarm) to use the built-in health endpoints:
- **Backend**: `HTTP GET /health` (Expect 200 OK)
- **Frontend**: `HTTP GET /health` (Expect 200 OK)

If the backend loses connection to MongoDB, the `/health` endpoint will start failing, and your orchestrator should restart or cycle the container.

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
- [ ] **Rate Limiting**: The app has built-in soft rate limiting, but you should configure hardware/WAF rate limiting at your load balancer/Cloudflare level for DDoS protection.
- [ ] **Audit Logs**: Ensure you configure a log aggregator (like Datadog, Splunk, or CloudWatch) to ingest the standard out (stdout) logs from the backend containers for audit and compliance.

## Example: Production Docker Run Command

```bash
docker run -d \
  --name icplane-backend \
  --restart always \
  -p 3545:3545 \
  -e NODE_ENV=production \
  -e MONGODB_URI="mongodb+srv://admin:pass@prod-cluster.xyz.mongodb.net/integration_gateway" \
  -e SECURITY_API_KEY="super_secret_api_key" \
  -e SECURITY_JWT_SECRET="super_secret_jwt_signature_key" \
  -e FRONTEND_URL="https://icplane.yourcompany.com" \
  -e PUBLIC_URL="https://api-icplane.yourcompany.com" \
  -e NODE_OPTIONS="--max-old-space-size=2048" \
  -v /path/to/your/custom-config.json:/app/config.json:ro \
  ghcr.io/varaprasadreddy9676/integration-control-plane-backend:main
```

## 6. URL Path Configuration

By default, the Docker image is built to serve the frontend from the **root path (`/`)**.

- **Why?** This is the most portable setting for modern Docker environments and reverse proxies.
- **Custom Subpaths**: If you MUST serve the app from a subpath (e.g., `yourdomain.com/portal/`), you should handle this routing at your **Load Balancer** or **Reverse Proxy** level by stripping the prefix before passing traffic to the container.
- **Legacy Note**: You may see a `.htaccess` file or old references to `/event-gateway/`. These are legacy Apache configurations and are **ignored** by the Docker Nginx setup.
