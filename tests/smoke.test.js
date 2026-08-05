// Smoke test: verifica che il server Express abbia tutte le route critiche
const request = require('supertest');

// Mock del pool prima di importare l'app
jest.mock('../src/db/pool', () => ({
  query: jest.fn().mockResolvedValue([[]]),
  getConnection: jest.fn().mockResolvedValue({ query: jest.fn(), release: jest.fn() }),
}));

process.env.JWT_SECRET='***';
process.env.LOG_LEVEL = 'silent';

const { app } = require('../src/app');

describe('Smoke Tests', () => {
  test('GET /api/health → 200', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('POST /api/login without body → 400', async () => {
    const res = await request(app).post('/api/login').send({});
    expect(res.status).toBe(400);
  });

  test('GET / → 200 (landing page)', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
  });

  test('GET /pricing → 200', async () => {
    const res = await request(app).get('/pricing');
    expect(res.status).toBe(200);
  });

  test('GET /robots.txt → 200', async () => {
    const res = await request(app).get('/robots.txt');
    expect(res.status).toBe(200);
  });

  test('GET /sitemap.xml → 200', async () => {
    const res = await request(app).get('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('xml');
  });

  test('GET /nonexistent → 404 (falls through to pages)', async () => {
    const res = await request(app).get('/nonexistent-route');
    // Express default is 404 when no route matches
    expect(res.status).toBe(404);
  });
});
