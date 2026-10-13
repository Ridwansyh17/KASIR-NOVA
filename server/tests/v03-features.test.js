/**
 * Tes integrasi V0.3 — Fase 1/2/4/5/6/7.
 *
 * Cakupan:
 *   - Fase 1: HPP hanya untuk pengguna berizin (Owner selalu; Kasir opt-in);
 *     kelola produk dari area kasir; SKU duplikat ditolak.
 *   - Fase 2: HABIS otomatis (stok 0) & manual; produk HABIS diblokir dari
 *     transaksi; aktivasi ulang memerlukan stok; histori pergerakan stok.
 *   - Fase 4/6: laporan pendapatan harian & ringkasan keuangan (Tunai/QRIS,
 *     HPP, biaya transaksi, pengeluaran, laba kotor/bersih) + ekspor xlsx.
 *   - Fase 5: pengeluaran outlet (kategori, metode, void sebagai koreksi).
 *   - Fase 7: snapshot HPP pada item transaksi & biaya transaksi pembayaran.
 *
 * Uang memakai satuan SEN (integer) seperti modul lain; asersi memakai angka
 * mentah agar konsisten dengan paket tes yang sudah ada.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import request from './helpers/request.js';
import { query } from '../src/config/db.js';
import { hashPassword } from '../src/utils/hash.js';
import { signAccessToken } from '../src/utils/token.js';

const PASSWORD = 'V03Uji123!';
const TZ = 'Asia/Jakarta';

let ownerId;
let ownerToken;
let biz; // bisnis untuk uji produk/stok/pergerakan
let outletA;
let cashierId;
let cashierToken;

let bizFin; // bisnis khusus uji laporan keuangan & pengeluaran
let outletF;
let cashierFinId;
let cashierFinToken;

let pMain; // price 10000, cost 6000, stok terkontrol
let pService; // track_stock=false
let fp1; // 10000 / 6000
let fp2; // 20000 / 15000

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const ownerGet = (path, t = ownerToken) => request.get(`/api/owner${path}`, { headers: auth(t) });
const ownerPost = (path, data, t = ownerToken) =>
  request.post(`/api/owner${path}`, data, { headers: auth(t) });
const ownerPatch = (path, data, t = ownerToken) =>
  request.patch(`/api/owner${path}`, data, { headers: auth(t) });
const cashierGet = (path, t = cashierToken) => request.get(`/api/cashier${path}`, { headers: auth(t) });
const cashierPost = (path, data, t = cashierToken) =>
  request.post(`/api/cashier${path}`, data, { headers: auth(t) });
const cashierPatch = (path, data, t = cashierToken) =>
  request.patch(`/api/cashier${path}`, data, { headers: auth(t) });
const bp = (b, s) => `/businesses/${b}${s}`;

const today = async () => {
  const { rows } = await query(`SELECT (now() AT TIME ZONE $1::text)::date::text AS d`, [TZ]);
  return rows[0].d;
};

const getQty = async (productId, outletId) => {
  const { rows } = await query(
    `SELECT quantity FROM product_stocks WHERE product_id = $1 AND outlet_id = $2`,
    [productId, outletId]
  );
  return rows[0]?.quantity ?? null;
};

before(async () => {
  const emails = ['uji-v03@nova.test'];
  const leftover = (
    await query(`SELECT id FROM owners WHERE email = ANY($1::text[])`, [emails])
  ).rows.map((r) => r.id);
  if (leftover.length) {
    await query(`DELETE FROM refresh_tokens WHERE user_id = ANY($1::uuid[])`, [leftover]);
    await query(`DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])`, [leftover]);
    await query(`DELETE FROM owners WHERE id = ANY($1::uuid[])`, [leftover]);
  }

  const ins = await query(
    `INSERT INTO owners (email, password_hash, full_name, status)
     VALUES ('uji-v03@nova.test', $1, 'Owner V03', 'active') RETURNING id`,
    [await hashPassword(PASSWORD)]
  );
  ownerId = ins.rows[0].id;
  ownerToken = signAccessToken({ userId: ownerId, role: 'owner' });

  // --- Bisnis produk/stok -------------------------------------------------
  biz = (await ownerPost('/businesses', { name: 'Bisnis V03 Produk' })).body.business.id;
  outletA = (await ownerPost(bp(biz, '/outlets'), { name: 'Outlet V03 A' })).body.outlet.id;
  const ca = await ownerPost(bp(biz, '/cashiers'), {
    fullName: 'Kasir V03',
    email: 'uji-v03-kasir@nova.test',
    password: PASSWORD,
    outletId: outletA,
  });
  cashierId = ca.body.cashier.id;
  cashierToken = (
    await request.post('/api/auth/login', {
      role: 'cashier',
      email: 'uji-v03-kasir@nova.test',
      password: PASSWORD,
    })
  ).body.accessToken;

  pMain = (
    await ownerPost(bp(biz, '/products'), {
      name: 'V03 Nasi',
      sku: 'V03-1',
      price: 10000,
      costPrice: 6000,
      trackStock: true,
      initialStock: 10,
      outletId: outletA,
    })
  ).body.product;
  pService = (
    await ownerPost(bp(biz, '/products'), {
      name: 'V03 Jasa',
      sku: 'V03-2',
      price: 5000,
      trackStock: false,
    })
  ).body.product;

  // --- Bisnis laporan keuangan -------------------------------------------
  bizFin = (await ownerPost('/businesses', { name: 'Bisnis V03 Fin' })).body.business.id;
  outletF = (await ownerPost(bp(bizFin, '/outlets'), { name: 'Outlet V03 F' })).body.outlet.id;
  const cf = await ownerPost(bp(bizFin, '/cashiers'), {
    fullName: 'Kasir V03 Fin',
    email: 'uji-v03-fin@nova.test',
    password: PASSWORD,
    outletId: outletF,
  });
  cashierFinId = cf.body.cashier.id;
  cashierFinToken = (
    await request.post('/api/auth/login', {
      role: 'cashier',
      email: 'uji-v03-fin@nova.test',
      password: PASSWORD,
    })
  ).body.accessToken;

  fp1 = (
    await ownerPost(bp(bizFin, '/products'), {
      name: 'V03 Fin A',
      sku: 'V03F-1',
      price: 10000,
      costPrice: 6000,
      trackStock: true,
      initialStock: 20,
      outletId: outletF,
    })
  ).body.product;
  fp2 = (
    await ownerPost(bp(bizFin, '/products'), {
      name: 'V03 Fin B',
      sku: 'V03F-2',
      price: 20000,
      costPrice: 15000,
      trackStock: true,
      initialStock: 10,
      outletId: outletF,
    })
  ).body.product;
});

after(async () => {
  const ids = [ownerId, cashierId, cashierFinId];
  await query(`DELETE FROM refresh_tokens WHERE user_id = ANY($1::uuid[])`, [ids]);
  await query(`DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])`, [[ownerId]]);
  await query(`DELETE FROM owners WHERE id = $1`, [ownerId]);
});

// ---------------------------------------------------------------- Fase 1 ----
test('Fase 1: Owner melihat HPP; Kasir tanpa izin tidak (UI + server)', async () => {
  const list = await ownerGet(bp(biz, '/products?search=V03 Nasi'));
  assert.strictEqual(list.status, 200);
  assert.strictEqual(list.body.can_view_profit, true);
  assert.strictEqual(Number(list.body.items[0].cost_price), 6000);

  const me = await cashierGet('/me');
  assert.strictEqual(me.status, 200);
  assert.strictEqual(me.body.permissions.can_view_profit, false);

  const cList = await cashierGet('/products?search=V03 Nasi');
  assert.strictEqual(cList.status, 200);
  assert.strictEqual(cList.body.can_view_profit, false);
  const row = cList.body.items.find((p) => p.id === pMain.id);
  assert.ok(row, 'kasir harus melihat produk bisnisnya');
  assert.strictEqual(row.cost_price, undefined, 'HPP tidak boleh dikirim ke kasir tanpa izin');
  assert.strictEqual(row.quantity, 10);
});

test('Fase 1: Kasir tanpa izin tidak bisa mengisi HPP (403)', async () => {
  const res = await cashierPatch(`/products/${pMain.id}`, { costPrice: 1234 });
  assert.strictEqual(res.status, 403);
  assert.match(res.body.error.message, /izin|modal|HPP/i);
});

test('Fase 1: Owner memberi izin HPP ke kasir -> HPP terlihat', async () => {
  const grant = await ownerPatch(bp(biz, `/cashiers/${cashierId}`), { canViewProfit: true });
  assert.strictEqual(grant.status, 200);
  assert.strictEqual(grant.body.cashier.can_view_profit, true);

  const cList = await cashierGet('/products?search=V03 Nasi');
  assert.strictEqual(cList.body.can_view_profit, true);
  const row = cList.body.items.find((p) => p.id === pMain.id);
  assert.strictEqual(Number(row.cost_price), 6000);
});

test('Fase 1: Kasir berizin menambah produk sendiri; SKU duplikat ditolak (409)', async () => {
  const created = await cashierPost('/products', {
    name: 'V03 Produk Kasir',
    sku: 'V03-KASIR',
    price: 3000,
    costPrice: 1500,
    trackStock: true,
    initialStock: 5,
  });
  assert.strictEqual(created.status, 201);
  assert.strictEqual(Number(created.body.product.cost_price), 1500);
  assert.strictEqual(await getQty(created.body.product.id, outletA), 5);

  const dup = await cashierPost('/products', {
    name: 'V03 Duplikat',
    sku: 'V03-1', // sama dengan pMain
    price: 1000,
  });
  assert.strictEqual(dup.status, 409);

  // Kembalikan izin HPP ke default (false) untuk uji berikutnya.
  const revoke = await ownerPatch(bp(biz, `/cashiers/${cashierId}`), { canViewProfit: false });
  assert.strictEqual(revoke.body.cashier.can_view_profit, false);
});

// ---------------------------------------------------------------- Fase 2 ----
test('Fase 2: stok 0 => HABIS otomatis; penjualan diblokir (409)', async () => {
  // Kosongkan stok via Owner.
  await ownerPatch(bp(biz, `/products/${pMain.id}/stocks/${outletA}`), { quantity: 0 });

  const list = await ownerGet(bp(biz, '/products?search=V03 Nasi'));
  assert.strictEqual(list.body.items[0].out_of_stock, true);

  const sale = await cashierPost('/transactions', {
    items: [{ productId: pMain.id, qty: 1 }],
    payment: { method: 'cash', amount: 10000 },
  });
  assert.strictEqual(sale.status, 409);
});

test('Fase 2: tandai HABIS manual memblokir transaksi; aktivasi butuh stok', async () => {
  const mark = await cashierPatch(`/products/${pMain.id}/stock-status`, { outOfStock: true });
  assert.strictEqual(mark.status, 200);
  assert.strictEqual(mark.body.product.manual_out_of_stock, true);

  const blocked = await cashierPost('/transactions', {
    items: [{ productId: pMain.id, qty: 1 }],
    payment: { method: 'cash', amount: 10000 },
  });
  assert.strictEqual(blocked.status, 409);
  assert.match(blocked.body.error.message, /HABIS/i);

  // Stok masih 0 -> aktivasi ulang ditolak.
  const restoreFail = await cashierPatch(`/products/${pMain.id}/stock-status`, {
    outOfStock: false,
  });
  assert.strictEqual(restoreFail.status, 409);

  // Isi stok, lalu aktivasi ulang berhasil dan penjualan normal.
  await ownerPatch(bp(biz, `/products/${pMain.id}/stocks/${outletA}`), { quantity: 3 });
  const restore = await cashierPatch(`/products/${pMain.id}/stock-status`, { outOfStock: false });
  assert.strictEqual(restore.status, 200);
  assert.strictEqual(restore.body.product.manual_out_of_stock, false);

  const sale = await cashierPost('/transactions', {
    items: [{ productId: pMain.id, qty: 1 }],
    payment: { method: 'cash', amount: 10000 },
  });
  assert.strictEqual(sale.status, 201);
  assert.strictEqual(await getQty(pMain.id, outletA), 2);
});

test('Fase 2: void mengembalikan stok + pergerakan stok tercatat (sale/void)', async () => {
  const rows = await ownerGet(bp(biz, `/inventory-movements?productId=${pMain.id}&limit=50`));
  assert.strictEqual(rows.status, 200);
  const sale = rows.body.items.find((m) => m.type === 'sale');
  assert.ok(sale, 'harus ada pergerakan penjualan');
  assert.strictEqual(sale.qty_delta, -1);
  assert.ok(rows.body.items.some((m) => m.type === 'adjustment'), 'penyesuaian stok tercatat');

  // Ambil transaksi selesai lalu void oleh Owner.
  const txs = await ownerGet(bp(biz, '/transactions?status=completed&limit=1'));
  const tx = txs.body.items[0];
  const voided = await ownerPost(bp(biz, `/transactions/${tx.id}/void`), {});
  assert.strictEqual(voided.status, 200);
  assert.strictEqual(await getQty(pMain.id, outletA), 3);

  const after = await ownerGet(bp(biz, `/inventory-movements?productId=${pMain.id}&type=void`));
  assert.ok(after.body.items.length >= 1);
  assert.strictEqual(after.body.items[0].qty_delta, 1);

  // Area kasir: histori hanya outletnya sendiri.
  const scoped = await cashierGet('/inventory-movements?limit=50');
  assert.strictEqual(scoped.status, 200);
  assert.ok(scoped.body.items.length >= 1);
  assert.ok(scoped.body.items.every((m) => m.outlet_id === outletA));
});

// --------------------------------------------------- Fase 7: snapshot HPP --
test('Fase 7: HPP di-snapshot pada item transaksi & biaya pembayaran tersimpan', async () => {
  const sale = await cashierPost('/transactions', {
    items: [{ productId: pMain.id, qty: 2 }],
    payment: { method: 'qr', amount: 20000, feeAmount: 350, reference: 'V03-QR' },
  });
  assert.strictEqual(sale.status, 201);
  const txId = sale.body.transaction.id;

  const item = await query(
    `SELECT cost_price FROM transaction_items WHERE transaction_id = $1`,
    [txId]
  );
  assert.strictEqual(Number(item.rows[0].cost_price), 6000);

  const pay = await query(
    `SELECT method, amount, fee_amount FROM payments WHERE transaction_id = $1`,
    [txId]
  );
  assert.strictEqual(Number(pay.rows[0].fee_amount), 350);
  assert.strictEqual(pay.rows[0].method, 'qr');

  // Ubah HPP katalog -> snapshot lama TIDAK berubah.
  await ownerPatch(bp(biz, `/products/${pMain.id}`), { costPrice: 9999 });
  const still = await query(
    `SELECT cost_price FROM transaction_items WHERE transaction_id = $1`,
    [txId]
  );
  assert.strictEqual(Number(still.rows[0].cost_price), 6000);
  await ownerPatch(bp(biz, `/products/${pMain.id}`), { costPrice: 6000 });
});

// ---------------------------------------------------------------- Fase 5 ----
test('Fase 5: Kasir mencatat pengeluaran outletnya; Owner melihat semua', async () => {
  const d = await today();
  const created = await cashierPost('/expenses', {
    category: 'supplies',
    amount: 1500,
    method: 'cash',
    note: 'Beli tisu',
    date: d,
  });
  assert.strictEqual(created.status, 201);
  assert.strictEqual(created.body.expense.outlet_id, outletA);
  assert.strictEqual(created.body.expense.status, 'recorded');

  const list = await ownerGet(bp(biz, '/expenses'));
  assert.strictEqual(list.status, 200);
  assert.ok(list.body.items.some((e) => e.id === created.body.expense.id));
  assert.strictEqual(list.body.totals.operating_total, 1500);
});

test('Fase 5: koreksi lewat void (bukan hapus); kasir hanya boleh void miliknya', async () => {
  const d = await today();
  const own = (
    await cashierPost('/expenses', { category: 'transport', amount: 800, method: 'cash', date: d })
  ).body.expense;

  const voided = await cashierPost(`/expenses/${own.id}/void`, { reason: 'Salah catat' });
  assert.strictEqual(voided.status, 200);
  assert.strictEqual(voided.body.expense.status, 'voided');

  const again = await cashierPost(`/expenses/${own.id}/void`, { reason: 'Ulangi' });
  assert.strictEqual(again.status, 409);

  // Pengeluaran milik Owner tidak boleh di-void kasir (403).
  const ownerExp = (
    await ownerPost(bp(biz, '/expenses'), {
      outletId: outletA,
      category: 'operational',
      amount: 900,
      method: 'transfer',
      date: d,
    })
  ).body.expense;
  const forbidden = await cashierPost(`/expenses/${ownerExp.id}/void`, { reason: 'Coba' });
  assert.strictEqual(forbidden.status, 403);

  // Baris tetap ada (tidak pernah dihapus).
  const { rows } = await query(`SELECT status FROM expenses WHERE id = $1`, [own.id]);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].status, 'voided');
});

// ----------------------------------------------------------- Fase 4 & 6 ----
test('Fase 4/6: laporan keuangan harian akurat (Tunai/QRIS/HPP/laba)', async () => {
  // Penjualan terkontrol di bisnis keuangan.
  const s1 = await cashierPost(
    '/transactions',
    {
      items: [{ productId: fp1.id, qty: 2 }], // 20000
      payment: { method: 'cash', amount: 20000 },
    },
    cashierFinToken
  );
  assert.strictEqual(s1.status, 201);
  const s2 = await cashierPost(
    '/transactions',
    {
      items: [{ productId: fp2.id, qty: 1 }], // 20000
      payment: { method: 'qr', amount: 20000, feeAmount: 500 },
    },
    cashierFinToken
  );
  assert.strictEqual(s2.status, 201);

  const d = await today();
  // Pengeluaran operasional 2000 + pembelian persediaan 5000 (dikecualikan).
  await ownerPost(bp(bizFin, '/expenses'), {
    outletId: outletF,
    category: 'operational',
    amount: 2000,
    method: 'cash',
    date: d,
  });
  await ownerPost(bp(bizFin, '/expenses'), {
    outletId: outletF,
    category: 'inventory_purchase',
    amount: 5000,
    method: 'cash',
    date: d,
  });
  // Kasir mencatat 1500 (lalu) dan 999 yang di-void (diabaikan).
  await cashierPost(
    '/expenses',
    { category: 'supplies', amount: 1500, method: 'cash', date: d },
    cashierFinToken
  );
  const toVoid = (
    await cashierPost(
      '/expenses',
      { category: 'other', amount: 999, method: 'cash', date: d },
      cashierFinToken
    )
  ).body.expense;
  await cashierPost(`/expenses/${toVoid.id}/void`, { reason: 'Batal' }, cashierFinToken);

  const rep = await ownerGet(bp(bizFin, `/reports/finance?outletId=${outletF}&date=${d}`));
  assert.strictEqual(rep.status, 200);
  const b = rep.body;

  assert.strictEqual(b.income.cash, 20000);
  assert.strictEqual(b.income.qris, 20000);
  assert.strictEqual(b.income.total, 40000);
  assert.strictEqual(b.income.transaction_fees, 500);
  assert.strictEqual(b.hpp, 27000); // 2*6000 + 1*15000
  assert.strictEqual(b.gross_profit, 13000); // 40000 - 27000
  assert.strictEqual(b.expenses.operating_total, 3500); // 2000 + 1500
  assert.strictEqual(b.expenses.inventory_total, 5000);
  assert.strictEqual(b.net_profit, 9000); // 13000 - 3500 - 500
  assert.strictEqual(b.transactions.completed, 2);
});

test('Fase 4: kasir melihat pendapatan outletnya; HPP/laba disembunyikan tanpa izin', async () => {
  const d = await today();
  const rep = await cashierGet(`/reports/daily?date=${d}`, cashierFinToken);
  assert.strictEqual(rep.status, 200);
  assert.strictEqual(rep.body.income.total, 40000);
  assert.strictEqual(rep.body.can_view_profit, false);
  assert.strictEqual(rep.body.hpp, undefined);
  assert.strictEqual(rep.body.net_profit, undefined);

  // Beri izin -> HPP & laba muncul.
  await ownerPatch(bp(bizFin, `/cashiers/${cashierFinId}`), { canViewProfit: true });
  const rep2 = await cashierGet(`/reports/daily?date=${d}`, cashierFinToken);
  assert.strictEqual(rep2.body.can_view_profit, true);
  assert.strictEqual(rep2.body.hpp, 27000);
  assert.strictEqual(rep2.body.net_profit, 9000);
  await ownerPatch(bp(bizFin, `/cashiers/${cashierFinId}`), { canViewProfit: false });
});

test('Fase 6: ekspor laporan keuangan ke .xlsx', async () => {
  const d = await today();
  const res = await request.binary(
    `/api/owner${bp(bizFin, `/reports/finance/export?outletId=${outletF}&date=${d}`)}`,
    { headers: auth(ownerToken) }
  );
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type'), /spreadsheetml/);
  // Semua berkas xlsx diawali 'PK' (zip).
  assert.strictEqual(res.buffer.slice(0, 2).toString('utf8'), 'PK');
});

test('Fase 6: filter pengeluaran per kategori & rentang tanggal', async () => {
  const d = await today();
  const op = await ownerGet(bp(bizFin, `/expenses?category=operational&from=${d}&to=${d}`));
  assert.strictEqual(op.status, 200);
  assert.ok(op.body.items.every((e) => e.category === 'operational'));
  assert.strictEqual(op.body.totals.inventory_total, 0);

  const inv = await ownerGet(bp(bizFin, `/expenses?category=inventory_purchase`));
  assert.strictEqual(inv.body.totals.operating_total, 0);
  assert.strictEqual(inv.body.totals.inventory_total, 5000);
});
