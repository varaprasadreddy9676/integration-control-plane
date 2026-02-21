#!/bin/bash

# Setup Docker Config Script
# Generates config.docker.json with passwords from .env file

set -e

echo "Setting up Docker production configuration..."

# Check if .env exists
if [ ! -f .env ]; then
    echo "Error: .env file not found!"
    echo "Please create .env from .env.example first"
    exit 1
fi

# Source environment variables
set -a
source .env
set +a

# Generate config.docker.json with actual passwords
cat > config.docker.json << EOF
{
  "app": {
    "name": "Integration Gateway",
    "shortName": "Gateway",
    "description": "A bi-directional integration platform for connecting systems via webhooks and real-time APIs",
    "version": "2.0.0"
  },
  "port": 4000,
  "api": {
    "basePrefix": "/api/v1"
  },
  "communicationServiceUrl": "https://your-domain.com/api/sendNotification",
  "frontendUrl": "https://your-domain.com/event-gateway",
  "db": {
    "host": "",
    "port": 3306,
    "user": "",
    "password": "",
    "database": "",
    "connectionLimit": 50,
    "comment": "Optional. Configure only if a tenant uses MySQL as event source."
  },
  "mongodb": {
    "uri": "mongodb://${MONGO_ROOT_USER}:${MONGO_ROOT_PASSWORD}@mongodb:27017/${MONGO_DATABASE}?authSource=admin",
    "database": "${MONGO_DATABASE}",
    "options": {
      "maxPoolSize": 100,
      "minPoolSize": 10
    }
  },
  "security": {
    "enforceHttps": false,
    "blockPrivateNetworks": false,
    "apiKey": "$(openssl rand -hex 32)",
    "jwtSecret": "$(openssl rand -hex 64)"
  },
  "worker": {
    "enabled": true,
    "batchSize": 50,
    "intervalMs": 1000,
    "maxConcurrentBatches": 5,
    "processingTimeout": 300000
  },
  "memory": {
    "heapThresholdMB": 5500,
    "checkIntervalMs": 60000,
    "gracefulShutdown": true
  },
  "logging": {
    "level": "info",
    "format": "json",
    "file": {
      "enabled": true,
      "path": "logs/gateway.log",
      "maxSize": "100m",
      "maxFiles": 10
    }
  },
  "httpClient": {
    "timeout": 30000,
    "maxRedirects": 5,
    "validateStatus": null
  }
}
EOF

echo "✓ config.docker.json generated successfully"
echo "✓ Database credentials synced from .env"
echo "✓ Secure API key and JWT secret generated"
