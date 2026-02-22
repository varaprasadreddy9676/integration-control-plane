# Security Policy

## Reporting a Vulnerability

We take the security of Integration Gateway seriously. If you discover a security vulnerability, we appreciate your help in disclosing it to us in a responsible manner.

### Private Disclosure Process

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them via email to:
- **Email:** founder@icplane.com
- **Subject:** [SECURITY] Brief description of the vulnerability

### What to Include in Your Report

To help us triage and fix the issue quickly, please include:

1. **Description** - Clear description of the vulnerability
2. **Impact** - What an attacker could do with this vulnerability
3. **Reproduction Steps** - Step-by-step instructions to reproduce the issue
4. **Affected Versions** - Which versions are affected (if known)
5. **Suggested Fix** - If you have ideas on how to fix it (optional)
6. **Your Contact Info** - How we can reach you for follow-up questions

### Example Report Format

```
Subject: [SECURITY] SQL Injection in Integration Query Parameter

Description:
The integration endpoint allows SQL injection through the 'orgId' parameter.

Impact:
An attacker could read sensitive data from the database or modify records.

Reproduction Steps:
1. Send a request to /api/v1/integrations?orgId=1' OR '1'='1
2. Observe that all integrations are returned regardless of orgId

Affected Versions:
v1.0.0 and earlier

Contact:
researcher@security.com
```

---

## Response Timeline

We are committed to responding quickly to security reports:

| Timeframe | Action |
|-----------|--------|
| **24 hours** | Initial acknowledgment of your report |
| **72 hours** | Preliminary assessment and severity classification |
| **7 days** | Regular updates on investigation progress |
| **30 days** | Target fix deployment for critical vulnerabilities |
| **90 days** | Public disclosure (coordinated with reporter) |

### Severity Classification

We use the following severity levels:

- **Critical** - Remote code execution, authentication bypass, data breach
- **High** - Privilege escalation, SQL injection, XSS with significant impact
- **Medium** - CSRF, information disclosure, denial of service
- **Low** - Minor information leaks, configuration issues

---

## Supported Versions

We provide security updates for the following versions:

| Version | Supported          | Notes |
| ------- | ------------------ | ----- |
| 1.0.x   | :white_check_mark: | Current stable release |
| < 1.0.0 | :x:                | Please upgrade to 1.0.x |

**Recommendation:** Always run the latest stable version to receive security updates.

---

## Security Best Practices for Deployment

### 1. Environment Configuration

#### JWT Secret
- **Generate strong secrets** - Use at least 256 bits of entropy
- **Never commit secrets** to version control
- **Rotate regularly** - Change JWT secrets every 90 days
- **Use environment variables** - Never hardcode in config files

```bash
# Generate a secure JWT secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Set in environment
export JWT_SECRET="your_generated_secret_here"
```

#### API Keys
- **Unique per environment** - Different keys for dev/staging/production
- **Restrict by IP** - Whitelist trusted IPs when possible
- **Monitor usage** - Track API key usage for anomalies
- **Revoke unused keys** - Remove old or unused API keys

```javascript
// In config.json or environment
{
  "security": {
    "jwtSecret": "${JWT_SECRET}",
    "apiKey": "${API_KEY}"
  }
}
```

### 2. Database Security

#### MongoDB
- **Enable authentication** - Never run MongoDB without auth in production
- **Use strong passwords** - Minimum 16 characters, mixed case, numbers, symbols
- **Restrict network access** - Bind to localhost or private network only
- **Enable encryption at rest** - Use MongoDB Enterprise encryption
- **Regular backups** - Automated daily backups with encryption

```javascript
// MongoDB connection with authentication
mongodb://username:password@localhost:27017/medics_integration_gateway?authSource=admin
```

#### MySQL (for event sources)
- **Least privilege** - Grant only necessary permissions
- **Use prepared statements** - Prevent SQL injection
- **Encrypt connections** - Use TLS/SSL for database connections
- **Audit logging** - Enable audit logs for compliance

### 3. Multi-Tenant Isolation

#### Organization (Tenant) Separation
- **Strict orgId enforcement** - Every query must filter by orgId
- **Row-level security** - Database queries automatically scope to tenant
- **No cross-tenant access** - Users can only access their own organization's data
- **Audit all access** - Log every data access with orgId context

```javascript
// CORRECT: Filtering by orgId
const integrations = await db.collection('integrations').find({
  orgId: req.orgId  // Always include orgId filter
}).toArray();

// INCORRECT: Missing orgId filter (security vulnerability!)
const integrations = await db.collection('integrations').find().toArray();
```

### 4. Authentication & Authorization

#### JWT Tokens
- **Short expiration** - Set token expiry to 24 hours or less
- **Secure storage** - Store tokens in httpOnly cookies (frontend)
- **Validate on every request** - Never trust expired or malformed tokens
- **Include role and orgId** - Embed authorization context in token

```javascript
// JWT payload structure
{
  "sub": "user_id",
  "email": "user@example.com",
  "role": "MANAGER",
  "orgId": 100,
  "iat": 1234567890,
  "exp": 1234654290  // 24 hours later
}
```

#### Role-Based Access Control (RBAC)
- **Least privilege principle** - Grant minimum necessary permissions
- **Regular audits** - Review user roles and permissions quarterly
- **Separate admin accounts** - Use different accounts for admin vs regular work
- **Require MFA for admins** - (Coming in v1.1.0)

See [RBAC Guide](backend/RBAC-GUIDE.md) for detailed permission management.

### 5. Webhook Security

#### Webhook Signing
- **Always enable signing** - Use HMAC-SHA256 signatures
- **Unique secrets per endpoint** - Don't reuse webhook secrets
- **Verify signatures** - Receivers must validate webhook authenticity
- **Protect against replay** - Use timestamp validation (5-minute window)

```javascript
// Webhook signature verification (receiver side)
const crypto = require('crypto');

function verifyWebhook(secret, headers, rawBody) {
  const messageId = headers['x-integration-id'];
  const timestamp = headers['x-integration-timestamp'];
  const signature = headers['x-integration-signature'];

  // 1. Validate timestamp (prevent replay attacks)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 300) {
    throw new Error('Webhook timestamp is too old');
  }

  // 2. Verify signature
  const signedContent = `${messageId}.${timestamp}.${rawBody}`;
  const secretBytes = Buffer.from(secret.split('_')[1], 'base64');
  const expectedSig = crypto
    .createHmac('sha256', secretBytes)
    .update(signedContent, 'utf8')
    .digest('base64');

  const expectedSignature = `v1,${expectedSig}`;
  return signature.split(' ').includes(expectedSignature);
}
```

#### Secret Rotation
- **Zero-downtime rotation** - Support multiple active secrets
- **Gradual rollout** - Phase out old secrets over 24-48 hours
- **Notify customers** - Inform webhook receivers before rotation
- **Emergency rotation** - Have process for immediate secret changes

### 6. JavaScript Transformation Security

#### Secure VM Sandbox
Integration Gateway uses a secure VM sandbox for custom JavaScript transformations:

- **No eval() or Function()** - Code generation disabled
- **No process or require** - No access to Node.js internals
- **60-second timeout** - Scripts automatically terminated
- **Memory limits** - Prevents memory exhaustion attacks
- **Frozen prototypes** - Prevents prototype pollution

```javascript
// SAFE: Allowed transformation script
function transform(event) {
  return {
    userId: event.patient_id,
    timestamp: new Date().toISOString()
  };
}

// BLOCKED: Dangerous operations prevented
function malicious(event) {
  process.exit(1);           // ❌ No access to process
  require('fs').readFile();  // ❌ No require function
  eval('malicious code');    // ❌ eval disabled
}
```

**Migration Note:** We replaced the vulnerable `vm2` library with a custom secure VM wrapper in v1.0.0 to address CVE-2023-37466.

### 7. Rate Limiting

#### Per-Integration Rate Limits
- **Configure limits** - Set reasonable rate limits per integration
- **Sliding window** - Use time-based sliding window algorithm
- **429 responses** - Return proper HTTP status codes
- **Exponential backoff** - Implement backoff for rate-limited requests

```javascript
// Example rate limit configuration
{
  "name": "Payment Webhook",
  "rateLimit": {
    "enabled": true,
    "maxRequests": 100,
    "windowMs": 60000  // 100 requests per minute
  }
}
```

#### DDoS Protection
- **Reverse proxy** - Use Nginx or CloudFlare in front
- **Connection limits** - Limit concurrent connections
- **Request size limits** - Maximum 10MB payload size
- **IP-based throttling** - Rate limit by source IP

### 8. HTTPS/TLS Configuration

#### Production Requirements
- **Enforce HTTPS** - Redirect all HTTP to HTTPS
- **TLS 1.2 minimum** - Disable older SSL/TLS versions
- **Strong cipher suites** - Use modern, secure ciphers
- **HSTS headers** - Enable HTTP Strict Transport Security

```nginx
# Nginx configuration example
server {
  listen 443 ssl http2;
  ssl_certificate /path/to/cert.pem;
  ssl_certificate_key /path/to/key.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_ciphers HIGH:!aNULL:!MD5;

  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  add_header X-Frame-Options "DENY" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-XSS-Protection "1; mode=block" always;
}
```

### 9. Logging and Monitoring

#### Security Events to Log
- **Failed login attempts** - Track brute force attacks
- **Permission denials** - Detect privilege escalation attempts
- **Configuration changes** - Audit all settings modifications
- **Unusual access patterns** - Large data exports, off-hours access
- **Integration failures** - Potential security issues in integrations

#### Log Security
- **No sensitive data** - Never log passwords, tokens, or API keys
- **Sanitize payloads** - Redact PII from logs
- **Secure storage** - Encrypt logs at rest
- **Access controls** - Restrict who can view logs
- **Retention policy** - Keep logs for 90 days minimum for security analysis

```javascript
// GOOD: Sanitized logging
log('info', 'User login successful', {
  userId: user.id,
  email: user.email,
  role: user.role
});

// BAD: Logging sensitive data
log('info', 'User login', {
  password: user.password,  // ❌ Never log passwords
  apiKey: config.apiKey     // ❌ Never log secrets
});
```

### 10. Dependency Management

#### Regular Updates
- **Weekly checks** - Monitor for security advisories
- **Automated scanning** - Use `npm audit` in CI/CD
- **Test before upgrading** - Verify functionality after updates
- **Pin versions** - Use exact versions in package.json

```bash
# Check for vulnerabilities
npm audit

# Fix automatically (review changes first)
npm audit fix

# Review specific advisory
npm audit fix --force  # Only if needed
```

#### Known Vulnerabilities Addressed
- **CVE-2023-37466** - vm2 sandbox escape (fixed in v1.0.0 by replacing with secure VM)

### 11. Docker Security

#### Container Best Practices
- **Non-root user** - Run containers as unprivileged user
- **Minimal base image** - Use Alpine or distroless images
- **No secrets in images** - Use environment variables or secret management
- **Resource limits** - Set memory and CPU limits
- **Regular updates** - Rebuild images for security patches

```dockerfile
# Example secure Dockerfile
FROM node:18-alpine

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Set working directory
WORKDIR /app

# Copy files
COPY --chown=nodejs:nodejs . .

# Install dependencies
RUN npm ci --only=production

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3004

CMD ["node", "src/index.js"]
```

#### Docker Compose Security
- **Use secrets** - Docker secrets for sensitive data
- **Private networks** - Isolate services on bridge networks
- **Read-only root** - Mount filesystems as read-only when possible

---

## Known Security Considerations

### JWT Token Management
- **Token storage** - Tokens are stored in localStorage (consider httpOnly cookies for enhanced security)
- **Token refresh** - Manual re-login required after expiry (automatic refresh coming in v1.1.0)
- **Impersonation** - SUPER_ADMIN can impersonate users (audit logged)

### API Key Authentication
- **Single API key** - One global API key per environment (per-org keys coming in v1.1.0)
- **No IP restrictions** - API key works from any IP (whitelist feature coming in v1.1.0)

### OAuth 2.0 Token Expiration
- **Automatic refresh** - System detects expired tokens and refreshes automatically
- **Token caching** - Tokens cached in memory (consider Redis for multi-instance deployments)

### Webhook Secrets
- **Plaintext storage** - Webhook secrets stored unencrypted in MongoDB (encryption at rest recommended)
- **Visible to admins** - Admins can view webhook secrets in UI (consider masking in v1.1.0)

### JavaScript Transformation
- **CPU limits** - 60-second timeout may allow resource exhaustion with many concurrent transformations
- **Memory limits** - Node.js memory limits apply, but no per-script memory limit

---

## Security Headers

Integration Gateway should be deployed behind a reverse proxy (Nginx/Apache) that sets security headers:

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
X-XSS-Protection: 1; mode=block
Content-Security-Policy: default-src 'self'
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
```

---

## Compliance Considerations

### GDPR (General Data Protection Regulation)
- **Data minimization** - Only collect necessary data
- **Right to erasure** - Support data deletion requests
- **Data portability** - Export user data in JSON format
- **Audit logging** - Track all data access and modifications

### HIPAA (for healthcare deployments)
- **Encryption at rest** - Enable MongoDB encryption
- **Encryption in transit** - Enforce HTTPS/TLS
- **Access controls** - RBAC with audit logging
- **Business Associate Agreement** - Required for covered entities

### SOC 2
- **Access reviews** - Quarterly user access audits
- **Change management** - Track configuration changes
- **Incident response** - Document security incident procedures
- **Vendor management** - Assess third-party integrations

---

## Security Checklist for Production

Use this checklist before deploying to production:

- [ ] Strong JWT secret generated and configured
- [ ] Unique API key per environment
- [ ] MongoDB authentication enabled with strong password
- [ ] HTTPS/TLS configured with valid certificate
- [ ] Reverse proxy (Nginx) configured with security headers
- [ ] Rate limiting enabled on all public endpoints
- [ ] Webhook signing enabled for all integrations
- [ ] Non-root user for Docker containers
- [ ] Resource limits set in Docker Compose
- [ ] Environment variables used for all secrets (no hardcoding)
- [ ] Firewall rules restrict database access
- [ ] Audit logging enabled
- [ ] Regular backups configured and tested
- [ ] Monitoring and alerting configured
- [ ] Security contact email configured
- [ ] Incident response plan documented
- [ ] User roles and permissions reviewed
- [ ] Dependencies scanned with `npm audit`

---

## Security Contact

For security-related questions or concerns:

- **Email:** founder@icplane.com
- **PGP Key:** (Coming soon)
- **Response Time:** Within 24 hours

For general support:
- **Website:** https://icplane.com
- **GitHub Issues:** https://github.com/varaprasadreddy9676/integration-control-plane/issues
- **Documentation:** https://github.com/varaprasadreddy9676/integration-control-plane/docs

---

## Acknowledgments

We thank the security researchers who have responsibly disclosed vulnerabilities:

- (No vulnerabilities reported yet)

If you report a security vulnerability that we fix, we'll acknowledge you here (with your permission).

---

## Updates to This Policy

This security policy is reviewed and updated quarterly. Last updated: 2026-02-21

**Version History:**
- v1.0.0 (2026-02-21) - Initial security policy
