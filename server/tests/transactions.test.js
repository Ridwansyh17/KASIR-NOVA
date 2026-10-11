/**
 * Tes integrasi Fase 7 — Transaksi Penjualan.
 *
 * Kriteria selesai:
 *   - Satu penjualan mengurangi stok, mencatat item, pajak, dan total secara
 *     atomik; penjualan konkuren tidak menghasilkan stok negatif.
 *   - Server menghitung ulang total (klien tidak bisa override harga).
 *   - Diskon per transaksi (persen/nominal) sebelum pajak; pajak per outlet
 *     (eksklusif/inklusif).
 *   - Anti-duplikasi via clientRef; void oleh Owner mengembalikan stok.
 *   - Isolasi tenant & peran: kasir hanya outletnya, owner hanya bisnisnya.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import request from './helpers/request.js';
import { query } from '../src/config/db.js';
import { hashPassword } from '../src/utils/hash.js';
import { signAccessToken } from '../src/utils/token.js';

const PASSWORD = 'TransaksiUji123!';

let ownerAId, ownerBId, adminId;
let tokenA, tokenB, adminToken;
let businessA, businessB;
let outletA1, outletB1;
let cashierAId, cashierBId, cashierAToken, cashierBToken;
let productA, productB; // Nasi Goreng (A), Es Teh (B)

const auth = (token) => ({ headers: { Authorization: `Bearer ${token}` } });
const ownerPath = (businessId, tail = '') => `/businesses/${businessId}${tail}`;
const ownerGet = (token, path) => request.get(`/api/owner${path}`, auth(token));
const ownerPost = (token, path, body) => request.post(`/api/owner${path}`, body, auth(token));
const ownerPatch = (token, path, body) => request.patch(`/api/owner${path}`, body, auth(token));
const ownerDelete = (token, path) => request.del(`/api/owner${path}`, auth(token));
const cashierPost = (token, path, body) => request.post(`/api/cashier${path}`, body, auth(token));
const cashierGet = (token, path) => request.get(`/api/cashier${path}`, auth(token));

const sale = (token, body) => cashierPost(token, '/transactions', body);

const products = (biz) => ownerPath(biz, '/products');
const stockPath = (biz, productId, outletId) =>
  ownerPath(biz, `/products/${productId}/stocks/${outletId}`);
const transactions = (biz) => ownerPath(biz, '/transactions');

const getQuantity = async (productId, outletId) => {
  const { rows } = await query(
    `SELECT quantity FROM product_stocks WHERE product_id = $1 AND outlet_id = $2`,
    [productId, outletId]
  );
  return rows[0]?.quantity ?? 0;
};

before(async () => {
  // Bersihkan sisa data suite ini (email khusus; cascades ikut menghapus anak).
  const cls = ['uji-trx-a@nova.test', 'uji-trx-b@nova.test'];
  const leftovers = (await query(`SELECT id FROM owners WHERE email = ANY($1::text[])`, [cls])).rows;
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

  const insOwner = async (email, name) => {
    const r = await query(
      `INSERT INTO owners (email, password_hash, full_name, status)
       VALUES ($1, $2, $3, 'active') RETURNING id`,
      [email, await hashPassword(PASSWORD), name]
    );
    return r.rows[0].id;
  };

  ownerAId = await insOwner('uji-trx-a@nova.test', 'Owner Transaksi A');
  ownerBId = await insOwner('uji-trx-b@nova.test', 'Owner Transaksi B');
  tokenA = signAccessToken({ userId: ownerAId, role: 'owner' });
  tokenB = signAccessToken({ userId: ownerBId, role: 'owner' });

  const admin = await query(
    `INSERT INTO platform_admins (email, password_hash, full_name, status)
     VALUES ($1, $2, $3, 'active') RETURNING id`,
    ['uji-trx-admin@nova.test', await hashPassword(PASSWORD), 'Admin Transaksi Uji']
  );
  adminId = admin.rows[0].id;
  adminToken = signAccessToken({ userId: adminId, role: 'platform_admin' });

  // Bisnis A + outlet pajak 10% (eksklusif) + kasir.
  businessA = (await ownerPost(tokenA, '/businesses', { name: 'Bisnis Transaksi A' })).body.business.id;
  outletA1 = (
    await ownerPost(tokenA, ownerPath(businessA, '/outlets'), {
      name: 'Outlet TA1',
      taxRate: 10,
    })
  ).body.outlet.id;

  const ca = await ownerPost(tokenA, ownerPath(businessA, '/cashiers'), {
    fullName: 'Kasir Transaksi A',
    email: 'ktrx-a@nova.test',
    password: PASSWORD,
    outletId: outletA1,
  });
  cashierAId = ca.body.cashier.id;
  const la = await request.post('/api/auth/login', {
    role: 'cashier',
    email: 'ktrx-a@nova.test',
    password: PASSWORD,
  });
  cashierAToken = la.body.accessToken;

  productA = (
    await ownerPost(tokenA, products(businessA), {
      name: 'Nasi Goreng',
      price: 15000,
      trackStock: true,
    })
  ).body.product;
  await ownerPatch(tokenA, stockPath(businessA, productA.id, outletA1), { quantity: 10 });

  // Bisnis B + outlet pajak 0% + kasir.
  businessB = (await ownerPost(tokenB, '/businesses', { name: 'Bisnis Transaksi B' })).body.business.id;
  outletB1 = (await ownerPost(tokenB, ownerPath(businessB, '/outlets'), { name: 'Outlet TB1' }))
    .body.outlet.id;

  const cb = await ownerPost(tokenB, ownerPath(businessB, '/cashiers'), {
    fullName: 'Kasir Transaksi B',
    email: 'ktrx-b@nova.test',
    password: PASSWORD,
    outletId: outletB1,
  });
  cashierBId = cb.body.cashier.id;
  const lb = await request.post('/api/auth/login', {
    role: 'cashier',
    email: 'ktrx-b@nova.test',
    password: PASSWORD,
  });
  cashierBToken = lb.body.accessToken;

  productB = (
    await ownerPost(tokenB, products(businessB), {
      name: 'Es Teh',
      price: 5000,
      trackStock: true,
    })
  ).body.product;
  await ownerPatch(tokenB, stockPath(businessB, productB.id, outletB1), { quantity: 5 });
});

after(async () => {
  const ownerIds = [ownerAId, ownerBId];
  await query('DELETE FROM refresh_tokens WHERE user_id = ANY($1::uuid[])', [
    [...ownerIds, cashierAId, cashierBId],
  ]);
  await query('DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])', [
    [...ownerIds, adminId],
  ]);
  await query('DELETE FROM owners WHERE id = ANY($1::uuid[])', [ownerIds]);
  await query('DELETE FROM platform_admins WHERE id = $1', [adminId]);
});

// ------------------------------------------------------------ Otorisasi -----
test('Peran salah pada route transaksi (401/403)', async () => {
  assert.strictEqual(
    (await request.post('/api/cashier/transactions', { items: [{ productId: productA.id, qty: 1 }], payment: { method: 'cash', amount: 1 } })).status,
    401
  );

  // Owner tidak boleh memakai route kasir (transaksi).
  const asOwner = await sale(tokenA, {
    items: [{ productId: productA.id, qty: 1 }],
    payment: { method: 'cash', amount: 20000 },
  });
  assert.strictEqual(asOwner.status, 403);

  // Kasir tidak boleh memakai route void milik owner.
  const asCashier = await request.post(
    `/api/owner${transactions(businessA)}/fake-id/void`,
    {},
    auth(cashierAToken)
  );
  assert.strictEqual(asCashier.status, 403);
});

// --------------------------------------------------- Penjualan & pajak ------
test('Penjualan tunai: total dihitung server + stok berkurang atomik', async () => {
  const res = await sale(cashierAToken, {
    items: [{ productId: productA.id, qty: 1 }],
    payment: { method: 'cash', amount: 200000 },
  });
  assert.strictEqual(res.status, 201);
  const t = res.body.transaction;
  assert.match(t.invoice_no, /^INV-\d{8}-\d{4}$/);
  assert.strictEqual(t.status, 'completed');
  assert.strictEqual(Number(t.subtotal), 15000);
  assert.strictEqual(Number(t.discount_total), 0);
  assert.strictEqual(Number(t.tax_total), 1500); // 10% eksklusif
  assert.strictEqual(Number(t.total), 16500);
  assert.strictEqual(Number(t.paid_amount), 200000);
  assert.strictEqual(Number(t.change_amount), 183500);
  assert.strictEqual(t.items.length, 1);
  assert.strictEqual(Number(t.items[0].line_total), 16500);
  assert.strictEqual(Number(t.items[0].tax_amount), 1500);
  assert.strictEqual(await getQuantity(productA.id, outletA1), 9);
});

test('Diskon persen (12.5%) & item tanpa stok tidak mengurangi stok', async () => {
  const jasa = await ownerPost(tokenA, products(businessA), {
    name: 'Jasa Antar',
    price: 25000,
    trackStock: false,
  });
  const jasaId = jasa.body.product.id;

  const res = await sale(cashierAToken, {
    items: [
      { productId: productA.id, qty: 2 }, // 30000
      { productId: jasaId, qty: 1 }, // 25000 (tanpa stok)
    ],
    discount: { type: 'percent', value: 12.5 },
    payment: { method: 'cash', amount: 60000 },
  });
  assert.strictEqual(res.status, 201);
  const t = res.body.transaction;
  assert.strictEqual(Number(t.subtotal), 55000);
  assert.strictEqual(t.discount_type, 'percent');
  assert.strictEqual(Number(t.discount_value), 1250); // basis points
  assert.strictEqual(Number(t.discount_total), 6875); // 12.5% dari 55000
  assert.strictEqual(Number(t.tax_total), 4813); // 10% dari 48125
  assert.strictEqual(Number(t.total), 52938);
  assert.strictEqual(Number(t.paid_amount), 60000);
  assert.strictEqual(Number(t.change_amount), 7062);
  // Hanya Nasi Goreng yang stoknya berkurang (9 -> 7).
  assert.strictEqual(await getQuantity(productA.id, outletA1), 7);
});

test('Diskon nominal (Rp) diterapkan sebelum pajak', async () => {
  const res = await sale(cashierAToken, {
    items: [{ productId: productA.id, qty: 1 }],
    discount: { type: 'amount', value: 5000 },
    payment: { method: 'cash', amount: 20000 },
  });
  assert.strictEqual(res.status, 201);
  const t = res.body.transaction;
  assert.strictEqual(t.discount_type, 'amount');
  assert.strictEqual(Number(t.discount_total), 5000);
  assert.strictEqual(Number(t.tax_total), 1000); // 10% dari 10000
  assert.strictEqual(Number(t.total), 11000);
  assert.strictEqual(Number(t.change_amount), 9000);
  assert.strictEqual(await getQuantity(productA.id, outletA1), 6);
});

test('Diskon melebihi subtotal & uang tunai kurang ditolak (409)', async () => {
  const badDiscount = await sale(cashierAToken, {
    items: [{ productId: productA.id, qty: 1 }],
    discount: { type: 'amount', value: 20000 },
    payment: { method: 'cash', amount: 30000 },
  });
  assert.strictEqual(badDiscount.status, 409);
  assert.match(badDiscount.body.error.message, /Diskon melebihi/);

  const shortCash = await sale(cashierAToken, {
    items: [{ productId: productA.id, qty: 1 }],
    payment: { method: 'cash', amount: 5000 },
  });
  assert.strictEqual(shortCash.status, 409);
  assert.match(shortCash.body.error.message, /kurang/);
  assert.strictEqual(await getQuantity(productA.id, outletA1), 6);
});

test('Pembayaran non-tunai harus pas dengan total; produk nonaktif ditolak', async () => {
  const mismatch = await sale(cashierAToken, {
    items: [{ productId: productA.id, qty: 1 }],
    payment: { method: 'card', amount: 10000 },
  });
  assert.strictEqual(mismatch.status, 409);

  const ok = await sale(cashierAToken, {
    items: [{ productId: productA.id, qty: 1 }],
    payment: { method: 'qr', amount: 16500, reference: 'QR-123' },
  });
  assert.strictEqual(ok.status, 201);
  assert.strictEqual(ok.body.transaction.payments[0].method, 'qr');
  assert.strictEqual(Number(ok.body.transaction.total), 16500);

  // Produk nonaktif tidak bisa dijual.
  await query(`UPDATE products SET status = 'suspended' WHERE id = $1`, [productA.id]);
  const suspended = await sale(cashierAToken, {
    items: [{ productId: productA.id, qty: 1 }],
    payment: { method: 'cash', amount: 20000 },
  });
  assert.strictEqual(suspended.status, 409);
  assert.match(suspended.body.error.message, /nonaktif/);
  await query(`UPDATE products SET status = 'active' WHERE id = $1`, [productA.id]);

  assert.strictEqual(await getQuantity(productA.id, outletA1), 5);
});

test('Pajak inklusif per outlet: total tetap, pajak dipisahkan dari harga', async () => {
  await ownerPatch(tokenA, ownerPath(businessA, `/outlets/${outletA1}`), { taxInclusive: true });

  const res = await sale(cashierAToken, {
    items: [{ productId: productA.id, qty: 1 }],
    payment: { method: 'cash', amount: 20000 },
  });
  assert.strictEqual(res.status, 201);
  const t = res.body.transaction;
  assert.strictEqual(t.tax_inclusive, true);
  assert.strictEqual(Number(t.subtotal), 15000);
  assert.strictEqual(Number(t.total), 15000); // harga sudah termasuk pajak
  assert.strictEqual(Number(t.tax_total), 1364); // 15000 * 10/110
  assert.strictEqual(Number(t.change_amount), 5000);
  assert.strictEqual(await getQuantity(productA.id, outletA1), 4);

  // Kembalikan outlet ke eksklusif untuk tes berikutnya.
  await ownerPatch(tokenA, ownerPath(businessA, `/outlets/${outletA1}`), { taxInclusive: false });
});

test('Stok tidak mencukupi ditolak (409) dan stok tidak pernah negatif', async () => {
  const res = await sale(cashierAToken, {
    items: [{ productId: productA.id, qty: 100 }],
    payment: { method: 'cash', amount: 2000000 },
  });
  assert.strictEqual(res.status, 409);
  assert.match(res.body.error.message, /tidak mencukupi/);
  assert.ok((await getQuantity(productA.id, outletA1)) >= 0);
});

// ------------------------------------------------------- Anti-duplikasi -----
test('Permintaan ulang dengan clientRef sama tidak membuat transaksi baru', async () => {
  const clientRef = randomUUID();
  const body = {
    items: [{ productId: productA.id, qty: 1 }],
    payment: { method: 'cash', amount: 20000 },
    clientRef,
  };

  const first = await sale(cashierAToken, body);
  assert.strictEqual(first.status, 201);
  assert.strictEqual(first.body.idempotent, false);
  assert.strictEqual(await getQuantity(productA.id, outletA1), 3);

  const second = await sale(cashierAToken, body);
  assert.strictEqual(second.status, 200);
  assert.strictEqual(second.body.idempotent, true);
  assert.strictEqual(second.body.transaction.id, first.body.transaction.id);
  assert.strictEqual(await getQuantity(productA.id, outletA1), 3); // tidak berkurang lagi
});

// ------------------------------------------------------- Void oleh Owner ----
test('Void oleh Owner mengembalikan stok; void dua kali ditolak', async () => {
  const target = await ownerGet(tokenA, transactions(businessA));
  const txId = target.body.items.find((t) => t.status === 'completed').id;

  const res = await ownerPost(
    tokenA,
    transactions(businessA) + `/${txId}/void`,
    {}
  );
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.transaction.status, 'voided');
  assert.match(res.body.transaction.voided_by, /^[0-9a-f-]{36}$/i);

  const again = await ownerPost(tokenA, transactions(businessA) + `/${txId}/void`, {});
  assert.strictEqual(again.status, 409);

  // Stok kembali +1 (void transaksi clientRef qty1).
  assert.strictEqual(await getQuantity(productA.id, outletA1), 4);
});

// ------------------------------------------------- Baca: owner & kasir ------
test('Owner melihat riwayat + detail bisnisnya (filter & isolasi)', async () => {
  const list = await ownerGet(tokenA, transactions(businessA) + '?status=completed');
  assert.strictEqual(list.status, 200);
  assert.ok(list.body.total >= 1);
  assert.ok(list.body.items.every((t) => t.status === 'completed'));

  const firstId = list.body.items[0].id;
  const detail = await ownerGet(tokenA, transactions(businessA) + `/${firstId}`);
  assert.strictEqual(detail.status, 200);
  assert.ok(Array.isArray(detail.body.transaction.items));
  assert.ok(Array.isArray(detail.body.transaction.payments));

  // Isolasi tenant: Owner A tidak bisa melihat transaksi bisnis B (404).
  const cross = await ownerGet(tokenA, transactions(businessB));
  assert.strictEqual(cross.status, 404);
});

test('Kasir B membuat penjualan (pajak 0%) & isolasi outlet kasir', async () => {
  const res = await sale(cashierBToken, {
    items: [{ productId: productB.id, qty: 1 }],
    payment: { method: 'cash', amount: 10000 },
  });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(Number(res.body.transaction.total), 5000);
  assert.strictEqual(Number(res.body.transaction.tax_total), 0);
  const txB = res.body.transaction.id;

  // Kasir A hanya melihat outletnya sendiri: transaksi B -> 404.
  const hidden = await cashierGet(cashierAToken, `/transactions/${txB}`);
  assert.strictEqual(hidden.status, 404);

  const mine = await cashierGet(cashierAToken, '/transactions');
  assert.strictEqual(mine.status, 200);
  assert.ok(mine.body.items.length >= 1);
  assert.ok(mine.body.items.every((t) => t.outlet_id === outletA1));

  assert.strictEqual(await getQuantity(productB.id, outletB1), 4);
});

// ------------------------------------------------ Konkurensi stok -------------
test('Penjualan konkuren tidak menghasilkan stok negatif', async () => {
  const stockBefore = await getQuantity(productA.id, outletA1); // 4
  const body = () => ({
    items: [{ productId: productA.id, qty: 3 }],
    payment: { method: 'card', amount: 49500 },
    clientRef: randomUUID(),
  });

  const [r1, r2] = await Promise.all([
    sale(cashierAToken, body()),
    sale(cashierAToken, body()),
  ]);
  const statuses = [r1.status, r2.status].sort();
  assert.deepStrictEqual(statuses, [201, 409]); // satu berhasil, satu kekurangan stok
  const stockAfter = await getQuantity(productA.id, outletA1);
  assert.strictEqual(stockAfter, stockBefore - 3);
  assert.ok(stockAfter >= 0);
});

// ------------------------------------------- Aturan bisnis lain --------------
test('Outlet dengan transaksi aktif tidak bisa dihapus (409)', async () => {
  const del = await ownerDelete(tokenA, ownerPath(businessA, `/outlets/${outletA1}`));
  assert.strictEqual(del.status, 409);
  assert.match(del.body.error.message, /transaksi aktif/);
});

test('Admin Platform bisa melihat transaksi bisnis mana pun (baca)', async () => {
  const list = await request.get(
    `/api/platform/businesses/${businessA}/transactions`,
    auth(adminToken)
  );
  assert.strictEqual(list.status, 200);
  assert.ok(list.body.total >= 1);

  const firstId = list.body.items[0].id;
  const detail = await request.get(
    `/api/platform/businesses/${businessA}/transactions/${firstId}`,
    auth(adminToken)
  );
  assert.strictEqual(detail.status, 200);
  assert.strictEqual(detail.body.transaction.id, firstId);
});

test('Audit log mencatat transaksi dibuat & dibatalkan', async () => {
  const a = await query(
    `SELECT DISTINCT action FROM audit_logs
      WHERE action IN ('transaction.create','transaction.void')`
  );
  const actions = a.rows.map((r) => r.action);
  assert.ok(actions.includes('transaction.create'), 'audit harus memuat transaction.create');
  assert.ok(actions.includes('transaction.void'), 'audit harus memuat transaction.void');
});