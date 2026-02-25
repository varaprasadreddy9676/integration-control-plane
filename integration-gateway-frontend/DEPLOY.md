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
