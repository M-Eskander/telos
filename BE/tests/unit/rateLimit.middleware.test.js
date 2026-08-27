const express = require('express');
const request = require('supertest');
const createTokenBucketRateLimiter = require('../../src/middleware/rateLimit.middleware');

describe('token bucket rate limiter', () => {
  test('limits only configured endpoint prefixes and refills tokens', async () => {
    const limiter = createTokenBucketRateLimiter(['/api/limited'], {
      capacity: 2,
      refillRate: 10
    });
    const app = express();
    app.use(limiter);
    app.get('/api/limited', (req, res) => res.sendStatus(200));
    app.get('/other', (req, res) => res.sendStatus(200));

    expect((await request(app).get('/other')).status).toBe(200);
    expect((await request(app).get('/api/limited')).status).toBe(200);
    expect((await request(app).get('/api/limited')).status).toBe(200);
    const rejected = await request(app).get('/api/limited');
    expect(rejected.status).toBe(429);
    expect(rejected.headers['retry-after']).toBeDefined();

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect((await request(app).get('/api/limited')).status).toBe(200);
  });

  test('does not treat a similar prefix as a match', async () => {
    const limiter = createTokenBucketRateLimiter(['/api/auth'], { capacity: 1, refillRate: 1 });
    const app = express();
    app.use(limiter);
    app.get('/api/authenticate', (req, res) => res.sendStatus(200));

    expect((await request(app).get('/api/authenticate')).status).toBe(200);
    expect((await request(app).get('/api/authenticate')).status).toBe(200);
  });
});