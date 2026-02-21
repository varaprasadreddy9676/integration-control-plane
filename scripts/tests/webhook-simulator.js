const express = require('express');

const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

function ok(res, req, auth) {
  return res.status(200).json({
    status: 'ok',
    auth,
    body: req.body || {},
    receivedAt: new Date().toISOString()
  });
}

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'up' });
});

app.post('/webhook/none', (req, res) => ok(res, req, 'NONE'));

app.post('/webhook/api-key', (req, res) => {
  const apiKey = req.get('X-API-Key');
  if (apiKey !== 'test_api_key') {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  return ok(res, req, 'API_KEY');
});

app.post('/webhook/bearer', (req, res) => {
  const authorization = req.get('Authorization') || '';
  if (authorization !== 'Bearer test_bearer_token') {
    return res.status(401).json({ error: 'Invalid bearer token' });
  }
  return ok(res, req, 'BEARER');
});

app.post('/webhook/basic', (req, res) => {
  const authorization = req.get('Authorization') || '';
  if (!authorization.startsWith('Basic ')) {
    return res.status(401).json({ error: 'Missing basic auth' });
  }

  const encoded = authorization.slice('Basic '.length);
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  if (decoded !== 'user:pass') {
    return res.status(401).json({ error: 'Invalid basic auth credentials' });
  }

  return ok(res, req, 'BASIC');
});

app.post('/token/oauth2', (req, res) => {
  const auth = req.get('Authorization') || '';
  let clientId = req.body?.client_id || req.body?.clientId;

  if (!clientId && auth.startsWith('Basic ')) {
    const decoded = Buffer.from(auth.slice('Basic '.length), 'base64').toString('utf8');
    clientId = decoded.split(':')[0];
  }

  return res.status(200).json({
    access_token: `simulated_oauth_token_${clientId || 'client'}`,
    token_type: 'Bearer',
    expires_in: 3600
  });
});

app.post('/token/custom', (req, res) => {
  const token = req.body?.token || req.body?.access_token || 'simulated_custom_token';
  return res.status(200).json({
    data: {
      token
    }
  });
});

module.exports = app;

if (require.main === module) {
  const port = Number(process.env.PORT || 5055);
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Webhook simulator listening on http://localhost:${port}`);
  });
}
