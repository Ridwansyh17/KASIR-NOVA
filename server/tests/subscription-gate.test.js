/**
 * Tes integrasi Fase 10 — Langganan & Pembatasan Akses.
 *
 * Kriteria selesai:
 *   - Bisnis yang langganannya kedaluwarsa (status aktif habis) TIDAK bisa
 *     membuat transaksi baru, produk, maupun kategori (409 di server).
 *   - Operasi korektif (void) tetap berjalan agar Owner bisa membereskan.
 *   - Bisnis aktif tetap normal.
 *   - Permintaan ulang transaksi yang sudah jadi (idempoten) tetap
 *     dikembalikan meski langganan sudah kedaluwarsa sesudahnya.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import request from './helpers/request.js';
import { query } from '../src/config/db.js';
import { hashPassword } from '../src/utils/hash.js';
import { signAccessToken } from '../src/utils/token.js';

const PASSWORD = 'LanggananUji123!';
const EMAIL = 'uji-sub-a@nova.test';

let ownerAId;
let tokenA;
let businessA, outletA1;
let productId, cashierAToken;
let completedTxId = null;

const auth = (token) => ({ headers: { Authorization: `Bearer ${token}` } });
const ownerPost = (token, path, body) => request.post(`/api/owner${path}`, body, auth(token));
const ownerPatch = (token, path, body) => request.patch(`/api/owner${path}`, body, auth(token));
const ownerPath = (biz, tail) => `/businesses/${biz}${tail}`;

const DAY = 24 * 3600 * 1000;

const setSubscription = async (patch = {}) => {
  const sets = [];
  const values = [];
  if (patch.status) {
    values.push(patch.status);
    sets.push(`status = $${values.length}`);
  }
  if (patch.expiresAt) {
    values.push(patch.expiresAt);
    sets.push(`expires_at = $${values.length}`);
  }
  assert.ok(sets.length, 'setSubscription butuh minimal satu kolom');
  values.push(businessA);
  await query(
    `UPDATE subscriptions SET ${sets.join(', ')}
      WHERE business_id = $${values.length}`,
    values
  );
};

const sell = (clientRef) =>
  request.post(
    '/api/cashier/transactions',
    { items: [{ productId, qty: 1 }], payment: { method: 'cash', amount: 50000 }, clientRef },
    auth(cashierAToken)
  );

before(async () => {
  const leftovers = (await query(`SELECT id FROM owners WHERE email = $1`, [EMAIL])).rows;
  if (leftovers.length) {
    await query('DELETE FROM refresh_tokens WHERE user_role = $1 AND user_id = ANY($2::uuid[])', [
      'owner',
      leftovers.map((r) => r.id),
    ]);
    await query('DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])', [
      leftovers.map((r) => r.id),
    ]);
    await query('DELETE FROM owners WHERE id = ANY($1::uuid[])', [leftovers.map((r) => r.id)]);
  }

  const owner = await query(
    `INSERT INTO owners (email, password_hash, full_name, status)
     VALUES ($1, $2, 'Owner Langganan', 'active') RETURNING id`,
    [EMAIL, await hashPassword(PASSWORD)]
  );
  ownerAId = owner.rows[0].id;
  tokenA = signAccessToken({ userId: ownerAId, role: 'owner' });

  businessA = (await ownerPost(tokenA, '/businesses', { name: 'Bisnis Langganan' })).body.business
    .id;
  outletA1 = (await ownerPost(tokenA, ownerPath(businessA, '/outlets'), { name: 'Outlet GL1' }))
    .body.outlet.id;
  const product = (
    await ownerPost(tokenA, ownerPath(businessA, '/products'), {
      name: 'Menu Gerbang',
      price: 15000,
      trackStock: true,
    })
  ).body.product;
  productId = product.id;
  await ownerPatch(tokenA, ownerPath(businessA, `/products/${productId}/stocks/${outletA1}`), {
    quantity: 50,
  });
  await ownerPost(tokenA, ownerPath(businessA, '/cashiers'), {
    fullName: 'Kasir Gerbang',
    email: 'kgerbang@nova.test',
    password: PASSWORD,
    outletId: outletA1,
  });
  cashierAToken = (await request.post('/api/auth/login', {
    role: 'cashier',
    email: 'kgerbang@nova.test',
    password: PASSWORD,
  })).body.accessToken;
});

after(async () => {
  await query('DELETE FROM refresh_tokens WHERE user_id = $1', [ownerAId]);
  await query('DELETE FROM audit_logs WHERE actor_id = $1', [ownerAId]);
  await query('DELETE FROM owners WHERE id = $1', [ownerAId]);
});

test('Bisnis aktif: transaksi, produk, kategori berjalan normal', async () => {
  const cat = await ownerPost(tokenA, ownerPath(businessA, '/categories'), { name: 'Kategori G' });
  assert.strictEqual(cat.status, 201, 'kategori boleh dibuat saat langganan aktif');

  const prod = await ownerPost(tokenA, ownerPath(businessA, '/products'), {
    name: 'Menu Aktif',
    price: 10000,
    trackStock: false,
  });
  assert.strictEqual(prod.status, 201, 'produk boleh dibuat saat langganan aktif');

  const sale = await sell();
  assert.strictEqual(sale.status, 201, 'transaksi boleh dibuat saat langganan aktif');
  completedTxId = sale.body.transaction.id;
  assert.ok(completedTxId, 'id transaksi baseline tersimpan untuk uji void');
});

test('Langganan kedaluwarsa: transaksi, produk & kategori diblokir; void tetap jalan', async () => {
  await setSubscription({ expiresAt: new Date(Date.now() - DAY) });

  const sale = await sell();
  assert.strictEqual(sale.status, 409, 'transaksi baru diblokir saat kedaluwarsa');
  assert.match(sale.body.error.message, /kedaluwarsa/, 'pesan menyebut kedaluwarsa');

  const prod = await ownerPost(tokenA, ownerPath(businessA, '/products'), {
    name: 'Menu Terlarang',
    price: 1000,
    trackStock: false,
  });
  assert.strictEqual(prod.status, 409, 'produk baru diblokir saat kedaluwarsa');

  const cat = await ownerPost(tokenA, ownerPath(businessA, '/categories'), { name: 'Kategori X' });
  assert.strictEqual(cat.status, 409, 'kategori baru diblokir saat kedaluwarsa');

  assert.ok(completedTxId, 'butuh transaksi baseline untuk uji void');
  const voided = await request.post(
    `/api/owner/businesses/${businessA}/transactions/${completedTxId}/void`,
    {},
    auth(tokenA)
  );
  assert.strictEqual(voided.status, 200, `void tetap boleh untuk membereskan data`);
});

test('Status past_due juga memblokir transaksi baru', async () => {
  await setSubscription({ status: 'past_due', expiresAt: new Date(Date.now() + 30 * DAY) });
  const sale = await sell();
  assert.strictEqual(sale.status, 409, 'past_due memblokir transaksi baru');
  assert.match(sale.body.error.message, /tidak aktif/, 'pesan menyebut langganan tidak aktif');
});

test('Idempotensi: retry transaksi yang sudah jadi tetap dikembalikan setelah kedaluwarsa', async () => {
  await setSubscription({ status: 'active', expiresAt: new Date(Date.now() + 30 * DAY) });
  const clientRef = randomUUID();
  const first = await sell(clientRef);
  assert.strictEqual(first.status, 201, 'transaksi awal dibuat saat aktif');
  const txId = first.body.transaction.id;

  await setSubscription({ expiresAt: new Date(Date.now() - DAY) });
  const retry = await sell(clientRef);
  assert.strictEqual(retry.status, 200, 'retry mengembalikan transaksi yang sama (idempoten)');
  assert.strictEqual(retry.body.idempotent, true);
  assert.strictEqual(retry.body.transaction.id, txId, 'bukan transaksi baru, tidak ada potong stok ganda');
});

test('Setelah diaktifkan kembali, transaksi normal lagi', async () => {
  await setSubscription({ status: 'active', expiresAt: new Date(Date.now() + 30 * DAY) });
  const sale = await sell();
  assert.strictEqual(sale.status, 201, 'transaksi kembali normal setelah langganan diaktifkan');
});
