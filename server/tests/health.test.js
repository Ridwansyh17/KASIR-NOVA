/**
 * Tes integrasi fondasi (Fase 0).
 *
 * Memverifikasi:
 *  1. Server merespons di root
 *  2. /api/health melaporkan database up
 *  3. Koneksi pool DB bisa query
 *  4. Hash password scrypt berfungsi (hash + verify)
 *
 * Dijalankan: npm run test
 */
import { test } from 'node:test';
import assert from 'node:assert';
import request from './helpers/request.js';
import { query } from '../src/config/db.js';
import { hashPassword, verifyPassword } from '../src/utils/hash.js';

test('GET / mengembalikan info API', async () => {
  const res = await request.get('/');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.name, 'KASIR NOVA API');
  assert.strictEqual(res.body.status, 'ok');
});

test('GET /api/health melaporkan database up', async () => {
  const res = await request.get('/api/health');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.status, 'ok');
  assert.strictEqual(res.body.services.database, 'up');
});

test('pool DB bisa menjalankan query', async () => {
  const { rows } = await query('SELECT 1 + 1 AS result');
  assert.strictEqual(rows[0].result, 2);
});

test('hashPassword & verifyPassword scrypt', async () => {
  const password = 'rahasia_kuat_123';
  const hash = await hashPassword(password);

  // Format: scrypt:N:r:p:salt:hash
  assert.ok(hash.startsWith('scrypt:'), 'hash harus diawali scrypt:');
  assert.strictEqual(hash.split(':').length, 6);

  // Verifikasi benar
  const ok = await verifyPassword(password, hash);
  assert.strictEqual(ok, true, 'password benar harus terverifikasi');

  // Verifikasi salah
  const wrong = await verifyPassword('password_salah', hash);
  assert.strictEqual(wrong, false, 'password salah harus ditolak');
});

test('hashPassword menolak password pendek', async () => {
  await assert.rejects(() => hashPassword('pendek'), /minimal 8 karakter/);
});
