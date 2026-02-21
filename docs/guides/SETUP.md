# Setup Guide

Complete installation and configuration guide for Integration Gateway.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
  - [Backend Setup](#backend-setup)
  - [Frontend Setup](#frontend-setup)
  - [Database Setup](#database-setup)
- [Configuration Reference](#configuration-reference)
  - [Backend Configuration](#backend-configuration)
  - [Frontend Configuration](#frontend-configuration)
  - [Environment Variables](#environment-variables)
- [Production Deployment](#production-deployment)
- [Advanced Configuration](#advanced-configuration)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Software

| Software | Minimum Version | Recommended Version | Purpose |
|----------|----------------|---------------------|---------|
| Node.js  | 18.0.0         | 20.x LTS            | Backend runtime |
| npm      | 8.0.0          | 10.x                | Package manager |
| MongoDB  | 4.4            | 6.x                 | Primary database |
| MySQL    | 5.7            | 8.0                 | Event source (optional) |

### System Requirements

**Development:**
- CPU: 2 cores
- RAM: 4 GB
- Disk: 10 GB free space

**Production:**
- CPU: 4+ cores
- RAM: 8+ GB
- Disk: 50+ GB (depends on log retention)
- Network: Stable internet connection for external API calls

---

## Installation

### Backend Setup

#### 1. Install Dependencies

```bash
cd backend
npm install
```

This installs all required packages:
- express (4.21.2)
- mongodb (4.17.2)
- mysql2 (3.15.3)
- axios (1.13.4)
- vm2 (3.10.0)
- jsonwebtoken (9.0.2)
- bcryptjs (2.4.3)
- node-cron (4.2.1)
- and more...

#### 2. Create Configuration File

```bash
cp config.example.json config.json
```

Or create `config.json` from scratch:

```json
{
  "port": 3545,
  "mongodb": {
    "uri": "mongodb://localhost:27017",
    "database": "integration_gateway",
    "maxPoolSize": 100
  },
  "db": {
    "host": "",
    "port": 3306,
    "user": "",
    "password": "",
    "database": "",
    "connectionLimit": 10,
    "queueLimit": 50
  },
  "security": {
    "apiKey": "your-secret-api-key-change-me",
    "jwtSecret": "your-jwt-secret-change-me-min-32-chars",
    "enforceHttps": false,
    "blockPrivateNetworks": false
  },
  "worker": {
    "enabled": true,
    "intervalMs": 5000,
    "batchSize": 5,
    "multiActionDelayMs": 1000,
    "maxEventAgeDays": 1,
    "retryIntervalMs": 60000,
    "retryBatchSize": 3
  },
  "scheduler": {
    "enabled": true,
    "intervalMs": 60000,
    "batchSize": 10
  },
  "eventSource": {
    "type": ""
  }
}
```

Notes:

- MongoDB is required.
- MySQL is optional. Leave `db.*` empty unless you need a shared MySQL source.
- Per-org MySQL can be configured later via Event Source settings/API.

#### 3. Create Admin User

```bash
node scripts/create-user.js --email admin@example.com --password 'ChangeMe123!' --role ADMIN
```

#### 4. Start Backend

**Development mode (with auto-reload):**
```bash
npm run dev
```

**Production mode:**
```bash
npm start
```

**With process manager (recommended for production):**
```bash
npm install -g pm2
pm2 start src/index.js --name integration-gateway
pm2 save
pm2 startup
```

Verify backend is running:
```bash
curl http://localhost:3545/health
```

Expected response (shape may vary by build/config):
```json
{
  "status": "healthy",
  "timestamp": "2026-01-15T10:00:00.000Z"
}
```

---

### Frontend Setup

#### 1. Install Dependencies

```bash
cd frontend
npm install
```

This installs:
- react (18.2.0)
- react-router-dom (6.22.0)
- antd (5.15.2)
- @tanstack/react-query (5.37.1)
- recharts (2.10.3)
- axios (1.6.8)
- and more...

#### 2. Create Environment File

```bash
cp .env.example .env
```

Or create `.env` file:

```bash
# API Configuration
VITE_API_BASE_URL_local=http://localhost:3545/api/v1
VITE_API_BASE_URL_prod=https://api.yourdomain.com/api/v1
VITE_API_KEY=your-secret-api-key-change-me

# App Configuration
VITE_APP_NAME=Integration Gateway
VITE_APP_VERSION=2.0.0
```

#### 3. Start Frontend

**Development mode:**
```bash
npm run dev
```

Frontend runs on `http://localhost:5173`

**Production build:**
```bash
npm run build
```

Build output goes to `dist/` directory.

**Preview production build:**
```bash
npm run preview
```

---

### Database Setup

#### MongoDB Setup

**Option 1: Local MongoDB**

1. Install MongoDB:
```bash
# macOS (Homebrew)
brew install mongodb-community@6.0

# Ubuntu/Debian
sudo apt-get install mongodb-org

# Start MongoDB
sudo systemctl start mongod
```

2. Verify connection:
```bash
mongosh
use integration_gateway
db.stats()
```

**Option 2: MongoDB Atlas (Cloud)**

1. Create free cluster at https://www.mongodb.com/cloud/atlas
2. Get connection string:
   ```
   mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/integration_gateway
   ```
3. Update `config.json`:
   ```json
   {
     "mongodb": {
       "uri": "mongodb+srv://username:password@cluster0.xxxxx.mongodb.net",
       "database": "integration_gateway"
     }
   }
   ```

#### MySQL Setup (Optional - For Event Source)

**If you have an existing MySQL event source:**

1. Verify MySQL connection:
```bash
mysql -h localhost -u your_user -p
```

2. Grant read permissions:
```sql
GRANT SELECT ON your_database.notification_queue TO 'gateway_user'@'%';
GRANT SELECT ON your_database.u_entity TO 'gateway_user'@'%';
FLUSH PRIVILEGES;
```

3. Test connection from backend:
```bash
cd backend
node -e "
const mysql = require('mysql2/promise');
(async () => {
  const conn = await mysql.createConnection({
    host: 'localhost',
    user: 'your_user',
    password: 'your_password',
    database: 'your_database'
  });
  const [rows] = await conn.query('SELECT 1');
  console.log('MySQL connected:', rows);
})();
"
```

**If you don't have MySQL (standalone mode):**

Leave MySQL empty in `config.json`:
```json
{
  "db": {
    "host": "",
    "port": 3306,
    "user": "",
    "password": "",
    "database": ""
  }
}
```

The backend still runs normally. MySQL adapters are only started for orgs that configure MySQL sources.

---

## Configuration Reference

### Backend Configuration

Full `config.json` reference:

```json
{
  // HTTP server port
  "port": 3545,

  // MongoDB (primary database)
  "mongodb": {
    "uri": "mongodb://localhost:27017",
    "database": "integration_gateway",
    "maxPoolSize": 100,
    "minPoolSize": 10,
    "maxIdleTimeMS": 30000,
    "connectTimeoutMS": 10000
  },

  // MySQL (optional - event source)
  "db": {
    "host": "localhost",
    "port": 3306,
    "user": "your_user",
    "password": "your_password",
    "database": "your_database",
    "connectionLimit": 10,
    "queueLimit": 50,
    "waitForConnections": true,
    "keepAliveInitialDelay": 300000
  },

  // Security settings
  "security": {
    // API key for external clients (change this!)
    "apiKey": "your-secret-api-key-change-me",

    // JWT secret for user authentication (min 32 chars)
    "jwtSecret": "your-jwt-secret-change-me-min-32-chars",

    // Enforce HTTPS for all requests (production)
    "enforceHttps": false,

    // Block requests to private networks (127.0.0.1, 192.168.x.x, etc.)
    "blockPrivateNetworks": false,

    // CORS allowed origins
    "cors": {
      "origin": ["http://localhost:5173", "https://yourdomain.com"],
      "credentials": true
    }
  },

  // Delivery worker configuration
  "worker": {
    // Enable/disable worker
    "enabled": true,

    // Polling interval (milliseconds)
    "intervalMs": 5000,

    // Batch size (events per cycle)
    "batchSize": 5,

    // Delay between multi-action deliveries (milliseconds)
    "multiActionDelayMs": 1000,

    // Max event age (days) - skip older events
    "maxEventAgeDays": 1,

    // Retry interval (milliseconds)
    "retryIntervalMs": 60000,

    // Retry batch size
    "retryBatchSize": 3
  },

  // Scheduler worker configuration
  "scheduler": {
    // Enable/disable scheduler
    "enabled": true,

    // Polling interval (milliseconds)
    "intervalMs": 60000,

    // Batch size (scheduled deliveries per cycle)
    "batchSize": 10
  },

  // Event source adapter
  "eventSource": {
    // Type: "mysql" or "kafka"
    "type": "mysql"
  },

  // Kafka configuration (if using Kafka event source)
  "kafka": {
    "brokers": ["localhost:9092"],
    "clientId": "integration-gateway",
    "groupId": "integration-gateway-group",
    "topic": "events"
  },

  // AI assistant configuration (optional)
  "ai": {
    "enabled": false,
    "provider": "kimi",
    "apiKey": "your-ai-api-key"
  }
}
```

MySQL guardrails:

- Shared pool from `config.json` is clamped to `connectionLimit` 1..20 and `queueLimit` 0..200.
- Per-org dedicated pools are clamped to `connectionLimit` 1..5 and `queueLimit` 0..50.
- Per-org source tuning is clamped to:
  - `pollIntervalMs` 1000..300000
  - `batchSize` 1..100
  - `dbTimeoutMs` 1000..120000

### Frontend Configuration

`.env` file reference:

```bash
# API Configuration
# URL for local development
VITE_API_BASE_URL_local=http://localhost:3545/api/v1

# URL for production
VITE_API_BASE_URL_prod=https://api.yourdomain.com/api/v1

# API authentication key (must match backend config.json security.apiKey)
VITE_API_KEY=your-secret-api-key-change-me

# App Configuration
VITE_APP_NAME=Integration Gateway
VITE_APP_VERSION=2.0.0

# Feature Flags (optional)
VITE_ENABLE_AI_ASSISTANT=false
VITE_ENABLE_FLOW_BUILDER=false
```

### Environment Variables

**Backend (via system environment or .env):**

```bash
# Override port
PORT=3545

# Node environment
NODE_ENV=production

# MongoDB URI (overrides config.json)
MONGODB_URI=mongodb://localhost:27017/integration_gateway

# MySQL password (overrides config.json)
DB_PASSWORD=your-mysql-password

# API key (overrides config.json)
API_KEY=your-api-key

# JWT secret (overrides config.json)
JWT_SECRET=your-jwt-secret
```

**Frontend (VITE_ prefix):**

Vite automatically exposes variables starting with `VITE_` to the frontend.

---

## Production Deployment

### Option 1: Docker Compose (Recommended)

**1. Create `docker-compose.yml`:**

```yaml
version: '3.8'

services:
  mongodb:
    image: mongo:6
    container_name: integration-gateway-mongo
    restart: always
    ports:
      - "27017:27017"
    volumes:
      - mongo-data:/data/db
      - mongo-config:/data/configdb
    environment:
      MONGO_INITDB_ROOT_USERNAME: admin
      MONGO_INITDB_ROOT_PASSWORD: changeme
      MONGO_INITDB_DATABASE: integration_gateway
    networks:
      - gateway-network

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: integration-gateway-backend
    restart: always
    ports:
      - "3545:3545"
    environment:
      - NODE_ENV=production
      - MONGODB_URI=mongodb://admin:changeme@mongodb:27017/integration_gateway?authSource=admin
      - API_KEY=${API_KEY}
      - JWT_SECRET=${JWT_SECRET}
    volumes:
      - ./backend/config.json:/app/config.json:ro
      - backend-logs:/app/logs
    depends_on:
      - mongodb
    networks:
      - gateway-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3545/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    container_name: integration-gateway-frontend
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
    depends_on:
      - backend
    networks:
      - gateway-network

volumes:
  mongo-data:
  mongo-config:
  backend-logs:

networks:
  gateway-network:
    driver: bridge
```

**2. Create `.env` for Docker Compose:**

```bash
API_KEY=your-production-api-key-change-me
JWT_SECRET=your-production-jwt-secret-min-32-chars-change-me
```

**3. Start services:**

```bash
docker compose up -d
```

**4. View logs:**

```bash
docker compose logs -f backend
```

### Option 2: PM2 Process Manager

**1. Install PM2 globally:**

```bash
npm install -g pm2
```

**2. Create PM2 ecosystem file (`ecosystem.config.js`):**

```javascript
module.exports = {
  apps: [
    {
      name: 'integration-gateway-backend',
      script: './backend/src/index.js',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3545
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      max_memory_restart: '1G',
      autorestart: true,
      watch: false
    }
  ]
};
```

**3. Start with PM2:**

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

**4. Monitor:**

```bash
pm2 monit
pm2 logs integration-gateway-backend
```

### Option 3: Systemd Service (Linux)

**1. Create service file `/etc/systemd/system/integration-gateway.service`:**

```ini
[Unit]
Description=Integration Gateway Backend
After=network.target mongod.service

[Service]
Type=simple
User=your-user
WorkingDirectory=/opt/integration-gateway/backend
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=integration-gateway
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

**2. Enable and start:**

```bash
sudo systemctl daemon-reload
sudo systemctl enable integration-gateway
sudo systemctl start integration-gateway
sudo systemctl status integration-gateway
```

**3. View logs:**

```bash
sudo journalctl -u integration-gateway -f
```

---

## Advanced Configuration

### SSL/TLS Setup (HTTPS)

**Using Nginx as reverse proxy:**

**1. Install Nginx:**
```bash
sudo apt-get install nginx
```

**2. Create Nginx config (`/etc/nginx/sites-available/integration-gateway`):**

```nginx
upstream backend {
    server localhost:3545;
}

server {
    listen 80;
    server_name yourdomain.com;

    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # API proxy
    location /api/ {
        proxy_pass http://backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
    }

    # Frontend static files
    location / {
        root /var/www/integration-gateway;
        try_files $uri $uri/ /index.html;
    }
}
```

**3. Enable site:**
```bash
sudo ln -s /etc/nginx/sites-available/integration-gateway /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

**4. Get SSL certificate (Let's Encrypt):**
```bash
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

### MongoDB Replica Set (High Availability)

**1. Create replica set config:**

```yaml
replication:
  replSetName: "rs0"
```

**2. Initialize replica set:**

```javascript
rs.initiate({
  _id: "rs0",
  members: [
    { _id: 0, host: "mongo1:27017" },
    { _id: 1, host: "mongo2:27017" },
    { _id: 2, host: "mongo3:27017" }
  ]
})
```

**3. Update connection string:**

```json
{
  "mongodb": {
    "uri": "mongodb://mongo1:27017,mongo2:27017,mongo3:27017/integration_gateway?replicaSet=rs0"
  }
}
```

### Rate Limiting Configuration

**Global rate limits (backend `config.json`):**

```json
{
  "rateLimits": {
    "global": {
      "windowMs": 60000,
      "max": 1000
    },
    "perTenant": {
      "windowMs": 60000,
      "max": 100
    }
  }
}
```

**Per-integration rate limits:**

Configure via UI or API when creating/updating integrations.

---

## Troubleshooting

### Backend Issues

**Issue: Backend won't start**

```bash
# Check Node.js version
node --version  # Should be 18+

# Check config.json syntax
node -e "require('./config.json')"

# Check MongoDB connection
mongosh mongodb://localhost:27017/integration_gateway --eval "db.stats()"

# Check port availability
lsof -i :3545
```

**Issue: Worker not processing events**

```bash
# Check worker is enabled
cat config.json | grep -A5 '"worker"'

# Check MySQL connection
mysql -h <host> -u <user> -p -e "SELECT COUNT(*) FROM notification_queue"

# View worker logs
tail -f logs/backend.log | grep worker

# Check worker checkpoint
mongo integration_gateway --eval "db.worker_checkpoint.find().pretty()"
```

**Issue: High memory usage**

```bash
# Check MongoDB pool size
cat config.json | grep maxPoolSize

# Reduce worker batch size
# Edit config.json:
{
  "worker": {
    "batchSize": 3  // Reduce from 5
  }
}

# Restart backend
pm2 restart integration-gateway-backend
```

### Frontend Issues

**Issue: Can't connect to API**

```bash
# Check API URL in .env
cat .env | grep VITE_API_BASE_URL

# Check API key matches backend
cat .env | grep VITE_API_KEY
cat backend/config.json | grep apiKey

# Test API directly
curl -H "X-API-Key: your-api-key" http://localhost:3545/health

# Check CORS settings (browser console for errors)
```

**Issue: Build fails**

```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install

# Clear Vite cache
rm -rf node_modules/.vite

# Check Node/npm versions
node --version  # Should be 18+
npm --version   # Should be 8+
```

### Database Issues

**Issue: MongoDB connection refused**

```bash
# Check MongoDB is running
sudo systemctl status mongod

# Check MongoDB logs
sudo tail -f /var/log/mongodb/mongod.log

# Test connection
mongosh mongodb://localhost:27017

# Check network binding
netstat -an | grep 27017
```

**Issue: MySQL connection pool exhausted**

```bash
# Increase connection limit in config.json
{
  "db": {
    "connectionLimit": 20,  // Increase from 10
    "queueLimit": 100      // Increase from 50
  }
}

# Check active connections
mysql -u root -p -e "SHOW PROCESSLIST;"

# Restart backend
```

### Performance Issues

**Issue: Slow API responses**

```bash
# Check MongoDB indexes
mongo integration_gateway --eval "
  db.integration_configs.getIndexes();
  db.delivery_logs.getIndexes();
"

# Create missing indexes (if any)
mongo integration_gateway --eval "
  db.delivery_logs.createIndex({ orgId: 1, createdAt: -1 });
  db.delivery_logs.createIndex({ status: 1, orgId: 1 });
"

# Check slow queries
mongo integration_gateway --eval "db.setProfilingLevel(1, { slowms: 100 })"
```

**Issue: High CPU usage**

```bash
# Check worker interval (might be too aggressive)
# Edit config.json:
{
  "worker": {
    "intervalMs": 10000  // Increase from 5000
  }
}

# Check for infinite retry loops
mongo integration_gateway --eval "
  db.delivery_logs.find({ attemptCount: { $gt: 10 } }).count()
"
```

---

## Next Steps

- Read [ARCHITECTURE.md](./ARCHITECTURE.md) for system design details
- See [docs/API.md](./docs/API.md) for API reference
- Check [CONTRIBUTING.md](./CONTRIBUTING.md) to contribute

---

## Support

- **Issues**: https://github.com/your-org/integration-gateway/issues
- **Documentation**: https://github.com/your-org/integration-gateway/docs
