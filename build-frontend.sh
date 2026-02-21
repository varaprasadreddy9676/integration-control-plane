#!/bin/bash

# =============================================================================
# Integration Gateway - Frontend Build Script
# =============================================================================
# This script builds the frontend for production deployment.
# It handles environment configuration, dependency installation, and build.
#
# Usage:
#   ./build-frontend.sh [environment]
#
# Arguments:
#   environment: Optional. One of: local, validation, production
#                If not provided, uses existing .env or defaults to local
#
# Examples:
#   ./build-frontend.sh validation    # Build for validation environment
#   ./build-frontend.sh production    # Build for production environment
#   ./build-frontend.sh               # Build with existing .env
# =============================================================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
BUILD_OUTPUT_DIR="$FRONTEND_DIR/dist"
PACKAGE_DIR="$SCRIPT_DIR/integration-gateway-frontend"

# Environment argument
ENVIRONMENT="${1:-existing}"

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}Integration Gateway - Frontend Build${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

# =============================================================================
# 1. Check Prerequisites
# =============================================================================
echo -e "${YELLOW}[1/6] Checking prerequisites...${NC}"

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}✗ Node.js is not installed${NC}"
    echo "  Please install Node.js 16+ from https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node --version)
echo -e "${GREEN}✓ Node.js: $NODE_VERSION${NC}"

# Check npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}✗ npm is not installed${NC}"
    exit 1
fi

NPM_VERSION=$(npm --version)
echo -e "${GREEN}✓ npm: $NPM_VERSION${NC}"

# Check frontend directory
if [ ! -d "$FRONTEND_DIR" ]; then
    echo -e "${RED}✗ Frontend directory not found: $FRONTEND_DIR${NC}"
    exit 1
fi

echo -e "${GREEN}✓ All prerequisites met${NC}"
echo ""

# =============================================================================
# 2. Configure Environment
# =============================================================================
echo -e "${YELLOW}[2/6] Configuring environment...${NC}"

cd "$FRONTEND_DIR"

# Set environment variables based on argument
case "$ENVIRONMENT" in
    local)
        echo -e "${BLUE}Building for LOCAL environment${NC}"
        API_URL="http://localhost:4000/api/v1"
        NODE_ENV="development"
        ;;
    validation)
        echo -e "${BLUE}Building for VALIDATION environment${NC}"
        API_URL="https://validation.example.com/integration-gateway/api/v1"
        NODE_ENV="production"
        ;;
    production)
        echo -e "${BLUE}Building for PRODUCTION environment${NC}"
        API_URL="https://example.com/integration-gateway/api/v1"
        NODE_ENV="production"
        ;;
    existing)
        echo -e "${BLUE}Using existing .env configuration${NC}"
        if [ ! -f ".env" ]; then
            echo -e "${YELLOW}No .env file found, creating from .env.example...${NC}"
            if [ -f ".env.example" ]; then
                cp .env.example .env
                echo -e "${GREEN}✓ Created .env from .env.example${NC}"
            else
                echo -e "${RED}✗ No .env.example found${NC}"
                exit 1
            fi
        fi
        echo -e "${GREEN}✓ Using existing .env file${NC}"
        ;;
    *)
        echo -e "${RED}Invalid environment: $ENVIRONMENT${NC}"
        echo "Valid options: local, validation, production"
        exit 1
        ;;
esac

# Create .env file if environment was specified
if [ "$ENVIRONMENT" != "existing" ]; then
    cat > .env << EOF
# API Configuration
VITE_API_BASE_URL=$API_URL
VITE_API_KEY=mdcs_dev_key_1f4a

# Application Configuration
VITE_APP_NAME=Integration Gateway
VITE_APP_VERSION=2.0.0

# Environment
NODE_ENV=$NODE_ENV
EOF
    echo -e "${GREEN}✓ Created .env for $ENVIRONMENT environment${NC}"
fi

# Display current configuration
echo ""
echo -e "${BLUE}Current Configuration:${NC}"
if [ -f ".env" ]; then
    while IFS= read -r line; do
        # Skip empty lines and comments
        if [[ -n "$line" ]] && [[ ! "$line" =~ ^#.* ]]; then
            echo "  $line"
        fi
    done < .env
else
    echo -e "${RED}  No .env file found${NC}"
fi
echo ""

# =============================================================================
# 3. Install Dependencies
# =============================================================================
echo -e "${YELLOW}[3/6] Installing dependencies...${NC}"

if [ ! -d "node_modules" ]; then
    echo "Installing npm packages (first time)..."
    npm install
else
    echo "Updating npm packages..."
    npm install
fi

echo -e "${GREEN}✓ Dependencies installed${NC}"
echo ""

# =============================================================================
# 4. Clean Previous Build
# =============================================================================
echo -e "${YELLOW}[4/6] Cleaning previous build...${NC}"

if [ -d "$BUILD_OUTPUT_DIR" ]; then
    rm -rf "$BUILD_OUTPUT_DIR"
    echo -e "${GREEN}✓ Removed previous build directory${NC}"
else
    echo -e "${BLUE}No previous build found${NC}"
fi
echo ""

# =============================================================================
# 5. Build Frontend
# =============================================================================
echo -e "${YELLOW}[5/6] Building frontend...${NC}"
echo ""

# Run build command
npm run build

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✓ Build completed successfully${NC}"
else
    echo ""
    echo -e "${RED}✗ Build failed${NC}"
    exit 1
fi
echo ""

# =============================================================================
# 6. Create Deployment Package
# =============================================================================
echo -e "${YELLOW}[6/6] Creating deployment package...${NC}"

# Remove old package directory if exists
if [ -d "$PACKAGE_DIR" ]; then
    rm -rf "$PACKAGE_DIR"
fi

# Create package structure
mkdir -p "$PACKAGE_DIR"

# Copy build output
cp -r "$BUILD_OUTPUT_DIR" "$PACKAGE_DIR/"

# Create deployment instructions
cat > "$PACKAGE_DIR/DEPLOY.md" << 'EOF'
# Integration Gateway - Frontend Deployment Instructions

## Package Contents

- `dist/` - Production build files (HTML, CSS, JS, assets)
- `DEPLOY.md` - This file
- `.env.production` - Environment configuration for reference

## Deployment Steps

### Option 1: Static File Server (Nginx/Apache)

1. **Copy files to web server**:
   ```bash
   # Copy dist folder contents to web root
   sudo cp -r dist/* /var/www/html/integration-gateway/
   ```

2. **Configure Nginx** (if using Nginx):
   ```nginx
   server {
       listen 80;
       server_name your-domain.com;
       root /var/www/html/integration-gateway;
       index index.html;

       # Handle client-side routing
       location / {
           try_files $uri $uri/ /index.html;
       }

       # API proxy (optional - if backend is on same server)
       location /api/ {
           proxy_pass http://localhost:4000;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
       }

       # Gzip compression
       gzip on;
       gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript;
   }
   ```

3. **Reload Nginx**:
   ```bash
   sudo nginx -t
   sudo systemctl reload nginx
   ```

### Option 2: Docker Deployment

Create a `Dockerfile` in the package directory:

```dockerfile
FROM nginx:alpine

# Copy built files
COPY dist/ /usr/share/nginx/html/

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
```

Build and run:
```bash
docker build -t integration-gateway-frontend .
docker run -d -p 80:80 integration-gateway-frontend
```

### Option 3: PM2 with serve

```bash
# Install serve globally
npm install -g serve

# Serve the dist folder
cd dist
serve -s . -p 80
```

## Important Notes

1. **Backend URL**: Ensure the frontend is configured to point to the correct backend API
   - Check `dist/assets/*.js` files contain correct API URL
   - Or configure API proxy in your web server

2. **HTTPS**: Always use HTTPS in production
   - Configure SSL certificates in Nginx/Apache
   - Use Let's Encrypt for free SSL certificates

3. **Caching**: Configure proper cache headers for static assets
   ```nginx
   location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf)$ {
       expires 1y;
       add_header Cache-Control "public, immutable";
   }
   ```

4. **Security Headers**: Add security headers in web server config
   ```nginx
   add_header X-Frame-Options "SAMEORIGIN" always;
   add_header X-Content-Type-Options "nosniff" always;
   add_header X-XSS-Protection "1; mode=block" always;
   ```

## Verification

After deployment, verify:
1. Open the application in a browser
2. Check browser console for errors
3. Verify API connectivity (check Network tab)
4. Test key features:
   - Login/Authentication
   - Webhook configuration
   - Event logs
   - Dashboard

## Rollback

To rollback to previous version:
```bash
# Restore from backup
sudo cp -r /var/www/html/integration-gateway.backup/* /var/www/html/integration-gateway/
sudo systemctl reload nginx
```

## Support

For issues or questions, contact the development team.
EOF

# Copy environment file for reference
cp .env "$PACKAGE_DIR/.env.$ENVIRONMENT"

# Create a basic nginx config template
cat > "$PACKAGE_DIR/nginx.conf" << 'EOF'
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    # Handle client-side routing
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/xml+rss application/json;

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
}
EOF

echo -e "${GREEN}✓ Deployment package created${NC}"
echo ""

# Get build statistics
if [ -d "$BUILD_OUTPUT_DIR" ]; then
    BUILD_SIZE=$(du -sh "$BUILD_OUTPUT_DIR" | cut -f1)
    FILE_COUNT=$(find "$BUILD_OUTPUT_DIR" -type f | wc -l | tr -d ' ')
    echo -e "${BLUE}Build Statistics:${NC}"
    echo "  Size: $BUILD_SIZE"
    echo "  Files: $FILE_COUNT"
    echo ""
fi

# =============================================================================
# Build Complete
# =============================================================================
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}Build completed successfully!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "${BLUE}Deployment Package Location:${NC}"
echo "  $PACKAGE_DIR"
echo ""
echo -e "${BLUE}Package Contents:${NC}"
echo "  - dist/              Production build files"
echo "  - DEPLOY.md          Deployment instructions"
echo "  - nginx.conf         Nginx configuration template"
echo "  - .env.$ENVIRONMENT  Environment configuration"
echo ""
echo -e "${BLUE}Next Steps:${NC}"
echo "  1. Review deployment instructions in DEPLOY.md"
echo "  2. Copy the package to your deployment server:"
echo "     ${YELLOW}scp -r $PACKAGE_DIR user@server:/path/to/destination/${NC}"
echo "  3. Follow the deployment steps in DEPLOY.md"
echo ""
echo -e "${BLUE}Quick Deploy (if web server is configured):${NC}"
echo "  ${YELLOW}sudo cp -r $PACKAGE_DIR/dist/* /var/www/html/integration-gateway/${NC}"
echo "  ${YELLOW}sudo systemctl reload nginx${NC}"
echo ""
