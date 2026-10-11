/**
 * Tes unit middleware auth & rate limiter (Fase 1).
 *
 * Tidak memerlukan DB: hanya menguji jalur penolakan token & otorisasi peran,
 * serta mekanisme pembatasan laju login.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import { createServer } from 'node:http';
import jwt from 'jsonwebtoken';
import env from '../src/config/env.js';
import { requireAuth, requireRole } from '../src/middleware/auth.js';
import { loginLimiter } from '../src/middleware/rateLimit.js';

// Jalankan satu middleware dengan req tiruan, tangkap error dari next(err).
const runMiddleware = (mw) => (req) =>
  new Promise((resolve) => {
    mw(req, {}, (err) => resolve(err ?? null));
  });

test('requireAuth menolak request tanpa header Authorization (401)', async () => {
  const err = await runMiddleware(requireAuth)({ headers: {} });
  assert.ok(err);
  assert.strictEqual(err.statusCode, 401);
});

test('requireAuth menolak skema non-Bearer (401)', async () => {
  const err = await runMiddleware(requireAuth)({ headers: { authorization: 'Basic abc' } });
  assert.ok(err);
  assert.strictEqual(err.statusCode, 401);
});

test('requireAuth menolak token kedaluwarsa (401)', async () => {
  const expired = jwt.sign({ sub: 'x', role: 'owner' }, env.jwt.accessSecret, {
    expiresIn: '-10s',
  });
  const err = await runMiddleware(requireAuth)({
    headers: { authorization: `Bearer ${expired}` },
  });
  assert.ok(err);
  assert.strictEqual(err.statusCode, 401);
  assert.match(err.message, /kedaluwarsa/i);
});

test('requireAuth menolak token tidak valid (401)', async () => {
  const err = await runMiddleware(requireAuth)({
    headers: { authorization: 'Bearer bukan.token.valid' },
  });
  assert.ok(err);
  assert.strictEqual(err.statusCode, 401);
});

test('requireRole mengizinkan peran yang cocok', async () => {
  const err = await runMiddleware(requireRole('owner'))({ user: { role: 'owner' } });
  assert.strictEqual(err, null);
});

test('requireRole menolak peran lain (403)', async () => {
  const err = await runMiddleware(requireRole('platform_admin'))({ user: { role: 'owner' } });
  assert.ok(err);
  assert.strictEqual(err.statusCode, 403);
});

test('requireRole menolak bila belum terautentikasi (401)', async () => {
  const err = await runMiddleware(requireRole('owner'))({});
  assert.ok(err);
  assert.strictEqual(err.statusCode, 401);
});

test('loginLimiter memblokir setelah batas percobaan (429)', async () => {
  const app = express();
  app.use(express.json());
  app.post('/login', loginLimiter, (req, res) => res.json({ ok: true }));

  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/login`;

  const statuses = [];
  for (let i = 0; i < 11; i++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    statuses.push(res.status);
  }
  await new Promise((resolve) => server.close(resolve));

  assert.strictEqual(statuses[0], 200);
  assert.strictEqual(statuses[9], 200, 'percobaan ke-10 masih boleh');
  assert.strictEqual(statuses[10], 429, 'percobaan ke-11 diblokir');
});
