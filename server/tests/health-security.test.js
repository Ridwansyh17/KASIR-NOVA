/**
 * Tes keamanan endpoint health check.
 *
 * Memverifikasi bahwa GET /api/health TIDAK membocorkan detail koneksi
 * (host/port/user/DSN) ke klien publik saat database bermasalah.
 *
 * Memakai dependency injection `createHealthRouter({ query, logger })` sehingga
 * dapat mensimulasikan DB mati tanpa mengganggu pool nyata.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import { createHealthRouter } from '../src/modules/health/routes.js';

const BOCOR =
  'password authentication failed for user "postgres" at 127.0.0.1:5433 (database nova_kasir_dev)';

const startWith = async (router) => {
  const app = express();
  app.use('/api/health', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

test('health (DB down) → 503 tanpa membocorkan detail koneksi', async () => {
  const router = createHealthRouter({
    query: async () => {
      const e = new Error(BOCOR);
      e.code = '28P01';
      throw e;
    },
    logger: { error() {} },
  });

  const s = await startWith(router);
  try {
    const res = await fetch(`${s.base}/api/health`);
    const body = await res.json();

    assert.strictEqual(res.status, 503);
    assert.strictEqual(body.status, 'degraded');
    assert.strictEqual(body.services.database, 'down');
    assert.ok(!('error' in body), 'body tidak boleh memuat field error');
    assert.ok(!('error' in body.services), 'services tidak boleh memuat detail error');

    const text = JSON.stringify(body);
    for (const rahasia of ['postgres', '127.0.0.1', '5433', 'nova_kasir_dev', 'password']) {
      assert.ok(!text.includes(rahasia), `respons membocorkan "${rahasia}"`);
    }
  } finally {
    await s.close();
  }
});

test('health (DB up) → 200 ok', async () => {
  const router = createHealthRouter({
    query: async () => ({ rows: [{ ok: 1 }] }),
    logger: { error() {} },
  });

  const s = await startWith(router);
  try {
    const res = await fetch(`${s.base}/api/health`);
    const body = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.status, 'ok');
    assert.strictEqual(body.services.database, 'up');
    assert.ok(!JSON.stringify(body).includes('error'), 'tidak boleh ada detail error');
  } finally {
    await s.close();
  }
});
