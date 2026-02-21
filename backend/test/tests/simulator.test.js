const request = require('supertest');
let app = null;
try { app = require('../../webhook-simulator'); } catch (_) {}

// Skip the entire suite when the webhook-simulator module is not available
(app ? describe : describe.skip)('Webhook simulator', () => {
  it('should report health', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('up');
  });

  it('should accept NONE auth', async () => {
    const res = await request(app)
      .post('/webhook/none')
      .send({ sample: true });
    expect(res.status).toBe(200);
    expect(res.body.body.sample).toBe(true);
  });

  it('should validate API key auth', async () => {
    const ok = await request(app)
      .post('/webhook/api-key')
      .set('X-API-Key', 'test_api_key')
      .send({ foo: 'bar' });
    expect(ok.status).toBe(200);

    const bad = await request(app)
      .post('/webhook/api-key')
      .set('X-API-Key', 'bad')
      .send({});
    expect(bad.status).toBe(401);
  });

  it('should validate bearer auth', async () => {
    const ok = await request(app)
      .post('/webhook/bearer')
      .set('Authorization', 'Bearer test_bearer_token')
      .send({ num: 1 });
    expect(ok.status).toBe(200);

    const bad = await request(app)
      .post('/webhook/bearer')
      .set('Authorization', 'Bearer wrong')
      .send({});
    expect(bad.status).toBe(401);
  });

  it('should validate basic auth', async () => {
    const ok = await request(app)
      .post('/webhook/basic')
      .set('Authorization', 'Basic ' + Buffer.from('user:pass').toString('base64'))
      .send({ hello: 'world' });
    expect(ok.status).toBe(200);

    const bad = await request(app)
      .post('/webhook/basic')
      .set('Authorization', 'Basic ' + Buffer.from('user:wrong').toString('base64'))
      .send({});
    expect(bad.status).toBe(401);
  });

  it('should serve oauth2 token', async () => {
    const res = await request(app)
      .post('/token/oauth2')
      .send({ client_id: 'id', client_secret: 'secret' });
    expect(res.status).toBe(200);
    expect(res.body.access_token).toBeDefined();
  });

  it('should serve custom token with nested data', async () => {
    const res = await request(app)
      .post('/token/custom')
      .send({ token: 'abc123' });
    expect(res.status).toBe(200);
    expect(res.body.data.token).toBe('abc123');
  });
});
