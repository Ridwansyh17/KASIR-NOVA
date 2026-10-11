/**
 * Tes integrasi Fase 6 — Produk, Kategori, Harga, Stok.
 *
 * Kriteria selesai:
 *   - Harga & stok tersimpan persisten (harga sen; stok per outlet).
 *   - Kasir hanya bisa MELIHAT produk outletnya (read-only, anti-IDOR:
 *     outlet diturunkan dari akun, bukan input klien).
 *   - Isolasi tenant kategori/produk/stok antar bisnis = 404.
 *   - Harga negatif / stok negatif ditolak; nama/SKU/barcode duplikat = 409.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import request from './helpers/request.js';
import { query } from '../src/config/db.js';
import { hashPassword } from '../src/utils/hash.js';
import { signAccessToken } from '../src/utils/token.js';

const PASSWORD = 'ProdukUji123!';

let ownerAId, ownerBId;
let tokenA, tokenB;
let businessA, businessB;
let outletA1, outletB1;
let cashierAId, cashierBId, cashierAToken, cashierBToken;
let categoryA, categoryB;
let productA, productB;

const auth = (token) => ({ headers: { Authorization: `Bearer ${token}` } });
// Path RELATIVE terhadap /api/owner (ownerGet/ownerPost menambahkan prefix).
const ownerPath = (businessId, tail = '') => `/businesses/${businessId}${tail}`;
const ownerGet = (token, path) => request.get(`/api/owner${path}`, auth(token));
const ownerPost = (token, path, body) => request.post(`/api/owner${path}`, body, auth(token));
const ownerPatch = (token, path, body) => request.patch(`/api/owner${path}`, body, auth(token));
const ownerDelete = (token, path) => request.del(`/api/owner${path}`, auth(token));

const categories = (biz) => ownerPath(biz, '/categories');
const products = (biz) => ownerPath(biz, '/products');
const stockPath = (biz, productId, outletId) =>
  ownerPath(biz, `/products/${productId}/stocks/${outletId}`);

before(async () => {
  // Bersihkan sisa data dari run sebelumnya (amankah? email ini khusus milik
  // suite ini). Cascades: owner -> businesses -> outlets/cashiers/products.
  const leftoverOwners = (
    await query(`SELECT id FROM owners WHERE email IN ('uji-produk-a@nova.test','uji-produk-b@nova.test')`)
  ).rows.map((r) => r.id);
  if (leftoverOwners.length) {
    await query('DELETE FROM refresh_tokens WHERE user_role = $1 AND user_id = ANY($2::uuid[])', [
      'owner',
      leftoverOwners,
    ]);
    await query('DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])', [leftoverOwners]);
    await query('DELETE FROM owners WHERE id = ANY($1::uuid[])', [leftoverOwners]);
  }

  const insOwner = async (email, name) => {
    const r = await query(
      `INSERT INTO owners (email, password_hash, full_name, status)
       VALUES ($1, $2, $3, 'active') RETURNING id`,
      [email, await hashPassword(PASSWORD), name]
    );
    return r.rows[0].id;
  };
  ownerAId = await insOwner('uji-produk-a@nova.test', 'Owner Produk A');
  ownerBId = await insOwner('uji-produk-b@nova.test', 'Owner Produk B');
  tokenA = signAccessToken({ userId: ownerAId, role: 'owner' });
  tokenB = signAccessToken({ userId: ownerBId, role: 'owner' });

  businessA = (await ownerPost(tokenA, '/businesses', { name: 'Bisnis Produk A' })).body.business.id;
  businessB = (await ownerPost(tokenB, '/businesses', { name: 'Bisnis Produk B' })).body.business.id;
  outletA1 = (await ownerPost(tokenA, ownerPath(businessA, '/outlets'), { name: 'Outlet PA1' }))
    .body.outlet.id;
  outletB1 = (await ownerPost(tokenB, ownerPath(businessB, '/outlets'), { name: 'Outlet PB1' }))
    .body.outlet.id;

  // Kasir di kedua bisnis (paket Gratis: 1 kasir per bisnis).
  const ca = await ownerPost(tokenA, ownerPath(businessA, '/cashiers'), {
    fullName: 'Kasir Produk A',
    email: 'kproduk-a@nova.test',
    password: PASSWORD,
    outletId: outletA1,
  });
  cashierAId = ca.body.cashier.id;
  const cb = await ownerPost(tokenB, ownerPath(businessB, '/cashiers'), {
    fullName: 'Kasir Produk B',
    email: 'kproduk-b@nova.test',
    password: PASSWORD,
    outletId: outletB1,
  });
  cashierBId = cb.body.cashier.id;

  const lga = await request.post('/api/auth/login', {
    role: 'cashier',
    email: 'kproduk-a@nova.test',
    password: PASSWORD,
  });
  cashierAToken = lga.body.accessToken;
  const lgb = await request.post('/api/auth/login', {
    role: 'cashier',
    email: 'kproduk-b@nova.test',
    password: PASSWORD,
  });
  cashierBToken = lgb.body.accessToken;

  categoryA = (await ownerPost(tokenA, categories(businessA), { name: 'Makanan' })).body.category;
  categoryB = (await ownerPost(tokenB, categories(businessB), { name: 'Minuman' })).body.category;

  productA = (
    await ownerPost(tokenA, products(businessA), {
      name: 'Nasi Goreng',
      sku: 'NG-001',
      price: 15000,
      categoryId: categoryA.id,
      trackStock: true,
    })
  ).body.product;
  productB = (
    await ownerPost(tokenB, products(businessB), {
      name: 'Es Teh',
      sku: 'ET-001',
      price: 5000,
      categoryId: categoryB.id,
      trackStock: true,
    })
  ).body.product;
});

after(async () => {
  await query('DELETE FROM refresh_tokens WHERE user_id = ANY($1::uuid[])', [
    [ownerAId, ownerBId, cashierAId, cashierBId],
  ]);
  await query('DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])', [
    [ownerAId, ownerBId],
  ]);
  await query('DELETE FROM owners WHERE id = ANY($1::uuid[])', [[ownerAId, ownerBId]]);
});

// ------------------------------------------------------------- Otorisasi ----
test('Tanpa token / peran salah pada endpoint produk (401/403)', async () => {
  assert.strictEqual((await request.get(`/api/owner${products(businessA)}`)).status, 401);

  // Kasir tidak boleh memakai route owner.
  const asCashier = await request.get(
    `/api/owner${products(businessA)}`,
    auth(cashierAToken)
  );
  assert.strictEqual(asCashier.status, 403);

  // Owner tidak boleh memakai route kasir.
  const asOwner = await request.get('/api/cashier/products', auth(tokenA));
  assert.strictEqual(asOwner.status, 403);
});

// ------------------------------------------------------------- Kategori ----
test('Kategori duplikat (beda kapital) ditolak (409)', async () => {
  const dup = await ownerPost(tokenA, categories(businessA), { name: 'makanan' });
  assert.strictEqual(dup.status, 409);
  assert.match(dup.body.error.message, /Kategori/);
});

test('Kategori bisnis B tidak terlihat oleh Owner A (404)', async () => {
  const res = await ownerGet(
    tokenA,
    ownerPath(businessA, `/categories/${categoryB.id}`)
  );
  assert.strictEqual(res.status, 404);
});

test('Kategori yang dipakai produk tidak bisa dihapus (409)', async () => {
  const res = await ownerDelete(tokenA, ownerPath(businessA, `/categories/${categoryA.id}`));
  assert.strictEqual(res.status, 409);
  assert.match(res.body.error.message, /masih dipakai/);
});

// ------------------------------------------------------------- Produk ------
test('Produk dibuat (201) + baris stok 0 otomatis untuk setiap outlet', async () => {
  const detail = await ownerGet(tokenA, ownerPath(businessA, `/products/${productA.id}`));
  assert.strictEqual(detail.status, 200);
  assert.strictEqual(Number(detail.body.product.price), 15000);
  assert.strictEqual(detail.body.stocks.length, 1);
  assert.strictEqual(detail.body.stocks[0].outlet_id, outletA1);
  assert.strictEqual(detail.body.stocks[0].quantity, 0);
});

test('Harga negatif & stok negatif ditolak (422)', async () => {
  const badPrice = await ownerPost(tokenA, products(businessA), {
    name: 'Harga Negatif',
    price: -100,
  });
  assert.strictEqual(badPrice.status, 422);

  const badStock = await ownerPatch(tokenA, stockPath(businessA, productA.id, outletA1), {
    quantity: -1,
  });
  assert.strictEqual(badStock.status, 422);
});

test('Set stok outlet (200); SKU duplikat antar produk ditolak (409)', async () => {
  const set = await ownerPatch(tokenA, stockPath(businessA, productA.id, outletA1), {
    quantity: 10,
  });
  assert.strictEqual(set.status, 200);
  assert.strictEqual(set.body.quantity, 10);

  const dup = await ownerPost(tokenA, products(businessA), {
    name: 'Nasi Goreng Spesial',
    sku: 'ng-001', // sama, beda kapital
    price: 20000,
  });
  assert.strictEqual(dup.status, 409);
  assert.match(dup.body.error.message, /SKU/);
});

test('Ubah produk (nama & harga) tersimpan (200)', async () => {
  const upd = await ownerPatch(tokenA, ownerPath(businessA, `/products/${productA.id}`), {
    name: 'Nasi Goreng Spesial',
    price: 18000,
    categoryId: null,
  });
  assert.strictEqual(upd.status, 200);
  assert.strictEqual(upd.body.product.name, 'Nasi Goreng Spesial');
  assert.strictEqual(Number(upd.body.product.price), 18000);
  assert.strictEqual(upd.body.product.category_id, null);
});

test('Produk track_stock=false tidak punya baris stok & setStock ditolak (409)', async () => {
  const service = await ownerPost(tokenA, products(businessA), {
    name: 'Jasa Antar',
    price: 25000,
    trackStock: false,
  });
  assert.strictEqual(service.status, 201);

  const detail = await ownerGet(tokenA, ownerPath(businessA, `/products/${service.body.product.id}`));
  assert.strictEqual(detail.body.stocks.length, 0);

  const set = await ownerPatch(tokenA, stockPath(businessA, service.body.product.id, outletA1), {
    quantity: 3,
  });
  assert.strictEqual(set.status, 409);
});

test('Isolasi tenant: stok/produk bisnis B tidak bisa disentuh Owner A (404)', async () => {
  const byA = await ownerPatch(tokenA, stockPath(businessA, productB.id, outletA1), {
    quantity: 99,
  });
  assert.strictEqual(byA.status, 404);

  const byB = await ownerPatch(tokenB, stockPath(businessB, productA.id, outletB1), {
    quantity: 99,
  });
  assert.strictEqual(byB.status, 404);

  const listB = await ownerGet(tokenA, products(businessB));
  assert.strictEqual(listB.status, 404);
});

test('Soft delete produk: hilang dari daftar & detail (404)', async () => {
  const del = await ownerDelete(tokenA, ownerPath(businessA, `/products/${productA.id}`));
  assert.strictEqual(del.status, 200);
  assert.strictEqual(del.body.deleted, true);

  const detail = await ownerGet(tokenA, ownerPath(businessA, `/products/${productA.id}`));
  assert.strictEqual(detail.status, 404);
});

// ------------------------------------------------------- Area kasir ---------
test('Kasir hanya melihat produk outletnya + stok miliknya (read-only)', async () => {
  // Bisnis A: produk "Nasi Goreng" (soft-deleted -> tidak muncul) dan
  // "Jasa Antar" aktif track_stock=false. Bisnis B punya "Es Teh".
  const listA = await request.get('/api/cashier/products', auth(cashierAToken));
  assert.strictEqual(listA.status, 200);
  assert.strictEqual(listA.body.total, 1); // hanya Jasa Antar
  const jasa = listA.body.items[0];
  assert.strictEqual(jasa.name, 'Jasa Antar');
  assert.strictEqual(jasa.quantity, null); // track_stock=false

  const listB = await request.get('/api/cashier/products', auth(cashierBToken));
  assert.strictEqual(listB.status, 200);
  assert.strictEqual(listB.body.total, 1);
  assert.strictEqual(listB.body.items[0].name, 'Es Teh');
});

test('Kasir A tidak melihat produk bisnis B; cari (search) menyaring', async () => {
  const listA = await request.get('/api/cashier/products', auth(cashierAToken));
  assert.ok(!listA.body.items.some((p) => p.name === 'Es Teh'));

  const search = await request.get('/api/cashier/products?search=teh', auth(cashierAToken));
  assert.strictEqual(search.body.total, 0); // "teh" tidak ada di bisnis A

  const searchB = await request.get('/api/cashier/products?search=teh', auth(cashierBToken));
  assert.strictEqual(searchB.body.total, 1);
});

test('Kasir melihat stok outletnya sendiri yang telah diisi (quantity)', async () => {
  // Reaktifkan produk A (kembalikan dari soft delete) untuk uji stok kasir.
  await query(`UPDATE products SET deleted_at = NULL WHERE id = $1`, [productA.id]);

  const listA = await request.get('/api/cashier/products', auth(cashierAToken));
  const nasgor = listA.body.items.find((p) => p.name === 'Nasi Goreng Spesial');
  assert.ok(nasgor, 'Nasi Goreng Spesial harus tampil setelah diaktifkan');
  assert.strictEqual(nasgor.quantity, 10); // stok outlet A1 yang di-set tadi
});

// ---------------------------------------------------------------- Audit -----
test('Audit log mencatat aksi kategori, produk & stok', async () => {
  const { rows } = await query(
    `SELECT DISTINCT action FROM audit_logs WHERE actor_id = $1`,
    [ownerAId]
  );
  const actions = rows.map((r) => r.action);
  for (const expected of [
    'category.create',
    'product.create',
    'product.update',
    'product.delete',
    'stock.set',
  ]) {
    assert.ok(actions.includes(expected), `audit harus memuat ${expected}`);
  }
});