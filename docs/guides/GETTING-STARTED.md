# Getting Started - Quick Reference

This guide shows you exactly where to configure everything for deployment.

---

## 📍 Where to Configure What

### Backend Configuration → `backend/config.json`

```json
{
  "port": 3545,                         // ← Line 8: Change your port here

  "db": {                               // ← Optional MySQL event-source config
    "host": "",
    "port": 3306,
    "user": "",
    "password": "",
    "database": ""
  },

  "mongodb": {                          // ← Lines 23-30: MongoDB configuration
    "uri": "mongodb://localhost:27017/integration_gateway"
  },

  "security": {                         // ← Lines 31-36: API keys
    "apiKey": "openssl_rand_hex_32",
    "jwtSecret": "openssl_rand_hex_64"
  },

  "kafka": {                            // ← Lines 64-75: Kafka (optional)
    "brokers": ["localhost:9092"]
  },

  "worker": {                           // ← Lines 76-89: Background jobs
    "enabled": true,
    "batchSize": 5
  }
}
```

### Frontend Configuration → `frontend/.env`

```bash
# Backend API URL (IMPORTANT!)
VITE_API_BASE_URL=http://localhost:3545/api/v1

# For production with your domain
VITE_API_BASE_URL=https://api.yourdomain.com/api/v1

# API Key (MUST match backend config.json)
VITE_API_KEY=same_as_backend_security_apiKey
```

---

## 🚀 Quick Start Commands

```bash
# 1. Setup Backend
cd backend
npm install
cp config.example.json config.json
nano config.json  # Edit port, mongodb, and security values (db is optional)
npm start

# 2. Setup Frontend
cd frontend
npm install
cp .env.example .env
nano .env  # Edit VITE_API_BASE_URL and VITE_API_KEY
npm run build
npm run preview

# 3. Verify
curl http://localhost:3545/health
```

---

## 🌐 Custom Domain Setup

### Backend Domain (api.yourdomain.com)

1. **DNS:** Point A record `api.yourdomain.com` → Your server IP

2. **Nginx:** `/etc/nginx/sites-available/backend`
```nginx
server {
    listen 80;
    server_name api.yourdomain.com;
    location / {
        proxy_pass http://localhost:3545;
    }
}
```

3. **SSL:**
```bash
sudo certbot --nginx -d api.yourdomain.com
```

### Frontend Domain (dashboard.yourdomain.com)

1. **DNS:** Point A record `dashboard.yourdomain.com` → Your server IP

2. **Build with production API:**
```bash
cd frontend
echo "VITE_API_BASE_URL=https://api.yourdomain.com/api/v1" > .env
echo "VITE_API_KEY=your_key" >> .env
npm run build
```

3. **Nginx:** `/etc/nginx/sites-available/frontend`
```nginx
server {
    listen 80;
    server_name dashboard.yourdomain.com;
    root /path/to/integration-control-plane/frontend/dist;
    location / {
        try_files $uri /index.html;
    }
}
```

4. **SSL:**
```bash
sudo certbot --nginx -d dashboard.yourdomain.com
```

---

## 📁 Logs

### Where are logs?
```
backend/logs/
├── gateway.log    ← Main application logs
├── access.log     ← HTTP access logs
└── error.log      ← Error logs
```

### View logs
```bash
tail -f backend/logs/gateway.log         # Real-time
grep -i error backend/logs/gateway.log   # Search errors
pm2 logs integration-gateway                  # If using PM2
docker compose logs -f gateway           # If using Docker
```

### Delete logs
```bash
rm -f backend/logs/*.log                 # Delete all
> backend/logs/gateway.log               # Clear content
find backend/logs/ -mtime +7 -delete     # Delete old logs
```

### Automatic rotation
Create `/etc/logrotate.d/integration-gateway`:
```bash
/path/to/integration-control-plane/backend/logs/*.log {
    daily
    rotate 7
    compress
    missingok
}
```

---

## 🔄 Restart Application

### PM2 (Recommended)
```bash
pm2 restart integration-gateway    # Restart
pm2 reload integration-gateway     # Zero-downtime reload
pm2 stop integration-gateway       # Stop
pm2 start integration-gateway      # Start
pm2 status                    # Check status
```

### Docker
```bash
docker compose restart gateway        # Restart backend
docker compose restart                # Restart all
docker compose down && docker compose up -d  # Full restart
```

### systemd
```bash
sudo systemctl restart integration-gateway
sudo systemctl stop integration-gateway
sudo systemctl start integration-gateway
sudo systemctl status integration-gateway
```

### Manual
```bash
# Kill existing process
lsof -i :3545 | grep LISTEN | awk '{print $2}' | xargs kill -9

# Start again
cd backend && npm start
```

---

## ✅ Pre-Deployment Checklist

**Backend:**
- [ ] `config.json` line 8 → Set port
- [ ] `config.json` db section → Configure only if you use MySQL as event source
- [ ] `config.json` lines 23-30 → Configure MongoDB
- [ ] `config.json` lines 31-36 → Generate secure keys
- [ ] MySQL database created (only for MySQL event-source tenants)
- [ ] MongoDB database created
- [ ] Test: `curl http://localhost:3545/health`

**Frontend:**
- [ ] `.env` → Set `VITE_API_BASE_URL` to backend URL
- [ ] `.env` → Set `VITE_API_KEY` (match backend)
- [ ] Build: `npm run build`
- [ ] Test: Visit frontend URL

**Production:**
- [ ] Domain DNS configured
- [ ] Nginx configured
- [ ] SSL certificates installed
- [ ] PM2 cluster mode enabled
- [ ] Log rotation setup
- [ ] Firewall configured

---

## 📞 Quick Help

**Problem:** Backend won't start
```bash
tail -f backend/logs/gateway.log  # Check logs
# mysql -u user -p                # Test MySQL (only if using MySQL source)
mongosh                           # Test MongoDB
```

**Problem:** Frontend can't connect to backend
```bash
curl http://localhost:3545/health  # Check backend running
cat frontend/.env                  # Check VITE_API_BASE_URL
```

**Problem:** Domain not working
```bash
sudo nginx -t                      # Test Nginx config
sudo certbot certificates          # Check SSL
```

---

## 📚 Full Documentation

- **Complete Guide:** `README.md` (root)
- **Backend Details:** `backend/README.md`
- **Frontend Details:** `frontend/README.md`

---

**That's it! You're ready to deploy.** 🚀
