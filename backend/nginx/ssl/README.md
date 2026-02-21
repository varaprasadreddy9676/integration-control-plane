# SSL Certificates (Local Only)

Do not commit private keys or real certificates to this repository.

For local testing, generate a self-signed cert inside this directory:

```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout private.key \
  -out certificate.crt \
  -subj "/C=US/ST=State/L=City/O=IntegrationGateway/CN=localhost"
```

Then update your nginx config paths if needed.
