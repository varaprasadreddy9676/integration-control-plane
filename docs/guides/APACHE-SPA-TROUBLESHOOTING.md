# Apache SPA Troubleshooting Guide

This guide documents the two most common Apache deployment failures for frontend SPAs served from `/var/www/html` via symlink:

1. `403 Forbidden` with `AH00037: Symbolic link not allowed or link target not accessible`
2. `404 Not Found` on browser refresh for deep routes like `/integration-gateway/admin/orgs`

Use this guide for release-time diagnosis and rollback-safe fixes.

## 1. Symptom: `403 Forbidden`

Typical browser error:

```text
Forbidden
You don't have permission to access this resource.
```

Typical Apache log entry:

```text
AH00037: Symbolic link not allowed or link target not accessible: /var/www/html/integration-gateway
```

### Root cause

Apache is trying to serve a symlink under `/var/www/html`, but:

- the symlink points to a non-existent directory, or
- the symlink target exists but Apache cannot access the real target path

### Diagnosis

Run:

```bash
ls -lah /var/www/html
ls -lah /var/www/html/integration-gateway
readlink -f /var/www/html/integration-gateway
namei -l /var/www/html/integration-gateway
```

What to look for:

- `readlink -f` must print a real path
- `namei -l` must resolve every parent directory without `No such file or directory`
- every directory in the target path must be traversable by Apache (`www-data`)

### Safe fix

Do not delete anything immediately. Rename the broken symlink first, then recreate it.

Example:

```bash
sudo mv /var/www/html/integration-gateway /var/www/html/integration-gateway.broken
sudo ln -s /data/node-js-apps/medics-integration-gateway-server/frontend/dist /var/www/html/integration-gateway
```

Verify:

```bash
readlink -f /var/www/html/integration-gateway
namei -l /var/www/html/integration-gateway
ls -lah /var/www/html/integration-gateway
```

Reload Apache:

```bash
sudo systemctl reload apache2
```

## 2. Symptom: `404 Not Found` on refresh for deep routes

Typical browser error:

```text
Not Found
The requested URL was not found on this server.
```

Example failing route:

```text
https://medicsprime.in/integration-gateway/admin/orgs?orgId=812
```

Usually:

- `/integration-gateway/` works
- refreshing `/integration-gateway/...deep-route...` fails

### Root cause

Apache is serving the built frontend files, but deep SPA routes are being treated as real filesystem paths instead of being rewritten back to `index.html`.

For a React/Vite SPA, Apache must serve:

```text
/integration-gateway/index.html
```

for any non-file request under `/integration-gateway/*`.

### Required checks

#### 1. `.htaccess` exists in the built frontend directory

```bash
ls -lah /var/www/html/integration-gateway/.htaccess
cat /var/www/html/integration-gateway/.htaccess
```

Expected:

```apache
RewriteEngine On
RewriteBase /integration-gateway/
RewriteRule ^index\.html$ - [L]
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule . /integration-gateway/index.html [L]
```

#### 2. `mod_rewrite` is enabled

```bash
sudo apachectl -M | grep rewrite
```

Expected:

```text
rewrite_module (shared)
```

If missing:

```bash
sudo a2enmod rewrite
sudo systemctl reload apache2
```

#### 3. Apache allows overrides and SPA fallback on the real target directory

If the frontend is served through a symlink, Apache must be configured for the real target directory too, not only `/var/www/html`.

### Recommended Apache config

Add this inside the relevant `<VirtualHost *:80>` block:

```apache
Alias /integration-gateway /data/node-js-apps/medics-integration-gateway-server/frontend/dist

<Directory /data/node-js-apps/medics-integration-gateway-server/frontend/dist>
    Options Indexes FollowSymLinks
    AllowOverride All
    Require all granted
    DirectoryIndex index.html
    FallbackResource /integration-gateway/index.html
</Directory>
```

Why both matter:

- `AllowOverride All` lets Apache apply `.htaccess`
- `FallbackResource` gives a direct SPA fallback even if rewrite behavior is inconsistent across symlinked paths

### Verify config

```bash
sudo apachectl configtest
sudo systemctl reload apache2
curl -I "http://localhost/integration-gateway/admin/orgs?orgId=812"
```

Expected:

```text
HTTP/1.1 200 OK
```

## 3. Release checklist for symlinked SPAs

Use this checklist for every Apache-hosted SPA release:

1. Build frontend

```bash
npm --prefix frontend run build
```

2. Confirm the built folder contains:

```bash
ls -lah frontend/dist
```

Required:

- `index.html`
- `assets/`
- `.htaccess`

3. Confirm Vite base path matches deployed URL prefix

Check:

- `frontend/vite.config.ts`
- `frontend/vite.config.js`

Example:

```ts
base: '/integration-gateway/'
```

4. Confirm the Apache symlink target exists

```bash
readlink -f /var/www/html/integration-gateway
```

5. Confirm Apache can traverse the full target path

```bash
namei -l /var/www/html/integration-gateway
```

6. Confirm rewrite module is enabled

```bash
sudo apachectl -M | grep rewrite
```

7. Confirm vhost has SPA fallback config for the real dist directory

Check for:

- `Alias /integration-gateway ...`
- `<Directory /real/path/to/dist>`
- `AllowOverride All`
- `FallbackResource /integration-gateway/index.html`

8. Syntax check and reload Apache

```bash
sudo apachectl configtest
sudo systemctl reload apache2
```

9. Smoke test both root and deep route

```bash
curl -I "http://localhost/integration-gateway/"
curl -I "http://localhost/integration-gateway/admin/orgs?orgId=812"
```

Expected for both:

- `200 OK`

## 4. Quick triage commands

When a release breaks, run these first:

```bash
sudo tail -n 100 /var/log/apache2/error.log
sudo apachectl -S
sudo apachectl -M | grep rewrite
ls -lah /var/www/html
ls -lah /var/www/html/integration-gateway
readlink -f /var/www/html/integration-gateway
namei -l /var/www/html/integration-gateway
curl -I "http://localhost/integration-gateway/"
curl -I "http://localhost/integration-gateway/admin/orgs?orgId=812"
```

## 5. Decision table

| Symptom | Likely Cause | Fix |
|---|---|---|
| `403 Forbidden` | broken symlink or inaccessible target | repair symlink / directory access |
| `AH00037` in Apache log | symlink target missing or unreadable | fix target path and Apache access |
| root route works, refresh route gives `404` | SPA fallback not applied | add `FallbackResource` and `AllowOverride All` on real target dir |
| `readlink -f` prints nothing | symlink target missing | recreate symlink to correct `dist` |
| deep route curl returns `404` | Apache sees path as static file path | configure SPA alias + fallback |
