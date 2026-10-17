/**
 * Tes integrasi tagihan langganan (payment gateway) — uji sandbox Duitku.
 *
 * Strategi: transport gateway disuntikkan (`setProviderForTests`) sehingga tes
 * berjalan tanpa kredensial dan tanpa jaringan, TETAPI verifikasi tanda tangan
 * callback memakai implementasi asli (`createDuitkuClient().verifyCallback`)
 * dengan kunci uji. Jadi jalur kritis berikut benar-benar diuji:
 *
 *   1. Owner membuat tagihan -> nominal diambil dari harga paket (sen), bukan
 *      dari klien; nomor VA tersimpan; jejak audit ditulis.
 *   2. Tagihan pending dipakai ulang (idempoten) dan hanya satu tagihan pending
 *      per bisnis (index unik parsial).
 *   3. Callback bertanda tangan sah -> tagihan lunas + langganan diaktifkan
 *      (langganan aktif lama menjadi `expired`).
 *   4. Callback palsu/bernominal lain TIDAK mengubah apa pun (401/400).
 *   5. Callback ganda tidak pernah mengaktifkan langganan dua kali.
 *   6. Isolasi tenant: tagihan bisnis lain tidak terlihat (404).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
// PENTING: bootstrap env pembayaran harus dimuat sebelum modul app (env.js).
import './helpers/payment-env.js';
import request from './helpers/request.js';
import { query } from '../src/config/db.js';
import { hashPassword } from '../src/utils/hash.js';
import { signAccessToken } from '../src/utils/token.js';
import { createDuitkuClient, signCallback } from '../src/payments/duitku.js';
import { clearProviderForTests, setProviderForTests } from '../src/payments/index.js';

const EMAIL = 'uji-invoice@nova.test';
const EMAIL_LAIN = 'uji-invoice-lain@nova.test';
const PASSWORD = 'InvoiceUji123!';
const MERCHANT = 'DTESTNOVA';
const API_KEY = 'kunci_uji_sandbox_bukan_rahasia';
const SANDBOX = 'https://sandbox.duitku.com/webapi/api/merchant';

const PRICE_OK = 1_000_000; // Rp 10.000 — tepat di batas minimum gateway
const PRICE_BESAR = 5_000_000; // Rp 50.000
const PRICE_KECIL = 500_000; // Rp 5.000 — di bawah minimum
const SUF = randomUUID().slice(0, 6);

let ownerId;
let token;
let businessId;
let ownerLainId;
let tokenLain;
let planOk;
let planBesar;
let planKecil;
let planGratis;

const calls = { createInvoice: [], checkStatus: [] };
let statusResponse = {
  statusCode: '00',
  statusMessage: 'SUCCESS',
  amountIdr: 10000,
  reference: 'REF-SYNC',
};

/** Verifikasi callback memakai implementasi ASLI klien Duitku. */
const realVerifier = createDuitkuClient({
  merchantCode: MERCHANT,
  apiKey: API_KEY,
  baseUrl: SANDBOX,
});

const fakeProvider = {
  name: 'duitku',
  createInvoice: async (payload) => {
    calls.createInvoice.push(payload);
    const seq = calls.createInvoice.length;
    return {
      reference: `REF-GW-${seq}`,
      vaNumber: `880800000000${seq}`,
      qrString: null,
      paymentUrl: `https://sandbox.duitku.com/topup/topupdirectv2.aspx?ref=UJI${seq}`,
      appUrl: null,
      amountIdr: payload.amountIdr,
      raw: {
        merchantCode: MERCHANT,
        reference: `REF-GW-${seq}`,
        statusCode: '00',
        statusMessage: 'SUCCESS',
        amount: String(payload.amountIdr),
      },
    };
  },
  checkStatus: async (orderId) => {
    calls.checkStatus.push(orderId);
    return {
      ...statusResponse,
      raw: {
        merchantOrderId: orderId,
        reference: statusResponse.reference,
        amount: String(statusResponse.amountIdr),
        statusCode: statusResponse.statusCode,
        statusMessage: statusResponse.statusMessage,
      },
    };
  },
  verifyCallback: (body) => realVerifier.verifyCallback(body),
};

const auth = (t) => ({ headers: { Authorization: `Bearer ${t}` } });
const subPath = (biz, tail) => `/api/owner/businesses/${biz}/subscription${tail}`;
const createInvoice = (t, biz, body) => request.post(subPath(biz, '/invoices'), body, auth(t));
const listInvoices = (t, biz, qs = '') => request.get(subPath(biz, `/invoices${qs}`), auth(t));
const getInvoice = (t, biz, id) => request.get(subPath(biz, `/invoices/${id}`), auth(t));
const syncInvoice = (t, biz, id) => request.post(subPath(biz, `/invoices/${id}/sync`), {}, auth(t));

/** Callback Duitku bertanda tangan (format asli: x-www-form-urlencoded). */
const signedCallback = ({ orderId, amountIdr, resultCode = '00', badSignature = false, amount = null }) => {
  const amountStr = String(amount ?? amountIdr);
  return {
    merchantCode: MERCHANT,
    amount: amountStr,
    merchantOrderId: orderId,
    productDetail: 'Langganan uji',
    paymentCode: 'BC',
    resultCode,
    reference: 'REF-CALLBACK',
    additionalParam: '',
    signature: badSignature
      ? 'f'.repeat(64)
      : signCallback({ merchantCode: MERCHANT, amount: amountStr, orderId, apiKey: API_KEY }),
  };
};
const sendCallback = (body) => request.postForm('/api/payments/duitku/callback', body);

const insertPlan = async (name, price) => {
  const { rows } = await query(
    `INSERT INTO subscription_plans
       (name, max_outlets, max_cashiers, price, duration_days, features, is_active, is_default)
     VALUES ($1, 3, 5, $2, 30, '{}'::jsonb, true, false)
     RETURNING id`,
    [name, price]
  );
  return rows[0].id;
};

const cleanupOwner = async (email) => {
  const { rows } = await query(`SELECT id FROM owners WHERE email = $1`, [email]);
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  await query('DELETE FROM refresh_tokens WHERE user_role = $1 AND user_id = ANY($2::uuid[])', [
    'owner',
    ids,
  ]);
  await query('DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])', [ids]);
  await query('DELETE FROM owners WHERE id = ANY($1::uuid[])', [ids]);
  return ids;
};

before(async () => {
  await cleanupOwner(EMAIL);
  await cleanupOwner(EMAIL_LAIN);

  const hash = await hashPassword(PASSWORD);
  const owner = await query(
    `INSERT INTO owners (email, password_hash, full_name, status)
     VALUES ($1, $2, 'Owner Invoice Uji', 'active') RETURNING id`,
    [EMAIL, hash]
  );
  ownerId = owner.rows[0].id;
  token = signAccessToken({ userId: ownerId, role: 'owner' });

  const ownerLain = await query(
    `INSERT INTO owners (email, password_hash, full_name, status)
     VALUES ($1, $2, 'Owner Invoice Lain', 'active') RETURNING id`,
    [EMAIL_LAIN, hash]
  );
  ownerLainId = ownerLain.rows[0].id;
  tokenLain = signAccessToken({ userId: ownerLainId, role: 'owner' });

  businessId = (
    await request.post('/api/owner/businesses', { name: `Bisnis Invoice ${SUF}` }, auth(token))
  ).body.business.id;

  planOk = await insertPlan(`Paket Uji 10rb ${SUF}`, PRICE_OK);
  planBesar = await insertPlan(`Paket Uji 50rb ${SUF}`, PRICE_BESAR);
  planKecil = await insertPlan(`Paket Uji 5rb ${SUF}`, PRICE_KECIL);
  planGratis = await insertPlan(`Paket Uji Gratis ${SUF}`, 0);

  setProviderForTests(fakeProvider);
});

after(async () => {
  clearProviderForTests();
  await cleanupOwner(EMAIL);
  await cleanupOwner(EMAIL_LAIN);
  await query(`DELETE FROM audit_logs WHERE business_id = $1`, [businessId]).catch(() => {});
  await query(`DELETE FROM subscription_plans WHERE id = ANY($1::uuid[])`, [
    [planOk, planBesar, planKecil, planGratis],
  ]);
  await request.stop();
});

test('opsi checkout: daftar paket + kanal + status gateway (tanpa rahasia)', async () => {
  const res = await request.get(subPath(businessId, '/plans'), auth(token));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.gateway.enabled, true);
  assert.strictEqual(res.body.gateway.provider, 'duitku');
  assert.strictEqual(res.body.gateway.mode, 'sandbox');
  assert.deepStrictEqual(
    res.body.gateway.channels.map((c) => c.code),
    ['BC', 'I1', 'M2', 'BR']
  );
  assert.ok(
    res.body.gateway.channels.every((c) => c.kind === 'va' && typeof c.label === 'string'),
    'kanal default adalah Virtual Account berlabel'
  );

  const plan = res.body.plans.find((p) => p.id === planOk);
  assert.strictEqual(plan.price, PRICE_OK, 'harga dilaporkan dalam sen');
  assert.strictEqual(plan.purchasable, true);
  const gratis = res.body.plans.find((p) => p.id === planGratis);
  assert.strictEqual(gratis.purchasable, false, 'paket gratis tidak bisa ditagih');
  assert.strictEqual(JSON.stringify(res.body).includes(API_KEY), false, 'tidak ada rahasia di respons');
});

test('kanal di luar daftar aktif ditolak 422', async () => {
  const res = await createInvoice(token, businessId, { planId: planOk, paymentMethod: 'ZZ' });
  assert.strictEqual(res.status, 422);
  assert.match(res.body.error.message, /Metode pembayaran tidak tersedia/);
});

test('paket gratis tidak memerlukan pembayaran (422)', async () => {
  const res = await createInvoice(token, businessId, { planId: planGratis, paymentMethod: 'BC' });
  assert.strictEqual(res.status, 422);
  assert.match(res.body.error.message, /gratis/i);
});

test('harga di bawah minimum gateway ditolak 422', async () => {
  const res = await createInvoice(token, businessId, { planId: planKecil, paymentMethod: 'BC' });
  assert.strictEqual(res.status, 422);
  assert.match(res.body.error.message, /minimum gateway/i);
});

test('membuat tagihan VA: 201, nomor VA dari gateway, audit tercatat', async () => {
  const before = calls.createInvoice.length;
  const res = await createInvoice(token, businessId, { planId: planOk, paymentMethod: 'bc' });
  assert.strictEqual(res.status, 201);
  const inv = res.body.invoice;
  assert.strictEqual(res.body.reused, false);
  assert.strictEqual(inv.status, 'pending');
  assert.strictEqual(inv.amount, PRICE_OK, 'nominal = harga paket dalam sen');
  assert.strictEqual(inv.payment_method, 'BC', 'kode kanal dinormalkan huruf besar');
  assert.strictEqual(inv.payment_method_label, 'BCA Virtual Account');
  assert.match(inv.order_id, /^SINV-\d{14}-[0-9A-F]{8}$/);
  assert.ok(inv.va_number, 'nomor VA tersimpan');
  assert.ok(inv.payment_url, 'tautan pembayaran tersimpan');
  assert.ok(new Date(inv.expires_at) > new Date(), 'masa berlaku di masa depan');
  assert.strictEqual(inv.plan.id, planOk);

  assert.strictEqual(calls.createInvoice.length, before + 1, 'gateway dipanggil sekali');
  const call = calls.createInvoice.at(-1);
  assert.strictEqual(call.amountIdr, PRICE_OK / 100, 'sen -> rupiah bulat untuk gateway');
  assert.strictEqual(call.method, 'BC');
  assert.match(call.callbackUrl, /\/api\/payments\/duitku\/callback$/);

  const { rows } = await query(
    `SELECT action, actor_role, actor_id, after FROM audit_logs
      WHERE business_id = $1 AND action = 'subscription.invoice_created'
      ORDER BY created_at DESC LIMIT 1`,
    [businessId]
  );
  assert.strictEqual(rows[0].actor_role, 'owner');
  assert.strictEqual(rows[0].actor_id, ownerId);
  assert.strictEqual(rows[0].after.order_id, inv.order_id);
  assert.strictEqual(Number(rows[0].after.amount), PRICE_OK);

  globalThis.__invoiceA = inv;
});

test('permintaan tagihan yang sama memakai ulang tagihan pending (tanpa panggilan gateway baru)', async () => {
  const before = calls.createInvoice.length;
  const res = await createInvoice(token, businessId, { planId: planOk, paymentMethod: 'BC' });
  assert.strictEqual(res.status, 200, 'dipakai ulang -> 200 (bukan 201)');
  assert.strictEqual(res.body.reused, true);
  assert.strictEqual(res.body.invoice.id, globalThis.__invoiceA.id);
  assert.strictEqual(calls.createInvoice.length, before, 'gateway tidak dipanggil ulang');
});

test('tagihan untuk paket lain membatalkan tagihan pending sebelumnya', async () => {
  const res = await createInvoice(token, businessId, { planId: planBesar, paymentMethod: 'BC' });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.invoice.amount, PRICE_BESAR);
  globalThis.__invoiceB = res.body.invoice;

  const lama = await getInvoice(token, businessId, globalThis.__invoiceA.id);
  assert.strictEqual(lama.body.invoice.status, 'canceled');

  const { rows } = await query(
    `SELECT count(*)::int AS n FROM subscription_invoices
      WHERE business_id = $1 AND status = 'pending'`,
    [businessId]
  );
  assert.strictEqual(rows[0].n, 1, 'hanya satu tagihan pending per bisnis');
});

test('callback bertanda tangan salah ditolak 401 dan tidak mengubah tagihan', async () => {
  const inv = globalThis.__invoiceB;
  const res = await sendCallback(
    signedCallback({ orderId: inv.order_id, amountIdr: inv.amount / 100, badSignature: true })
  );
  assert.strictEqual(res.status, 401);
  const after = await getInvoice(token, businessId, inv.id);
  assert.strictEqual(after.body.invoice.status, 'pending');
});

test('callback bernominal berbeda ditolak 400 (nominal tagihan tidak dipercaya dari luar)', async () => {
  const inv = globalThis.__invoiceB;
  const res = await sendCallback(
    signedCallback({
      orderId: inv.order_id,
      amountIdr: inv.amount / 100,
      amount: '1', // tanda tangan sah, tetapi nominalnya tidak sesuai tagihan
    })
  );
  assert.strictEqual(res.status, 400);
  assert.match(res.body.error.message, /tidak sesuai tagihan/);
  const after = await getInvoice(token, businessId, inv.id);
  assert.strictEqual(after.body.invoice.status, 'pending');
});

test('callback resultCode 01 menandai tagihan gagal tanpa mengaktifkan paket', async () => {
  const inv = globalThis.__invoiceB;
  const res = await sendCallback(
    signedCallback({ orderId: inv.order_id, amountIdr: inv.amount / 100, resultCode: '01' })
  );
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.status, 'gagal');
  const after = await getInvoice(token, businessId, inv.id);
  assert.strictEqual(after.body.invoice.status, 'failed');

  const { rows } = await query(
    `SELECT plan_id FROM subscriptions WHERE business_id = $1 AND status = 'active'`,
    [businessId]
  );
  assert.strictEqual(rows.length, 1);
  assert.notStrictEqual(rows[0].plan_id, planBesar, 'paket gagal tidak diaktifkan');
});

test('callback sah: tagihan lunas & langganan paket baru aktif', async () => {
  const created = await createInvoice(token, businessId, { planId: planOk, paymentMethod: 'BC' });
  assert.strictEqual(created.status, 201);
  const inv = created.body.invoice;
  globalThis.__invoiceC = inv;

  const res = await sendCallback(
    signedCallback({ orderId: inv.order_id, amountIdr: inv.amount / 100 })
  );
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.status, 'lunas');
  assert.ok(res.body.subscription_id, 'langganan baru dikembalikan');

  const after = await getInvoice(token, businessId, inv.id);
  assert.strictEqual(after.body.invoice.status, 'paid');
  assert.ok(after.body.invoice.paid_at, 'waktu pelunasan terisi');
  assert.strictEqual(after.body.invoice.subscription_id, res.body.subscription_id);

  const { rows: subs } = await query(
    `SELECT s.id, s.status, s.plan_id, s.expires_at, p.duration_days
       FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id
      WHERE s.business_id = $1 ORDER BY s.created_at ASC`,
    [businessId]
  );
  const aktif = subs.filter((s) => s.status === 'active');
  assert.strictEqual(aktif.length, 1, 'tepat satu langganan aktif');
  assert.strictEqual(aktif[0].plan_id, planOk);
  assert.ok(subs.some((s) => s.status === 'expired'), 'langganan lama menjadi expired');
  assert.ok(new Date(aktif[0].expires_at) > new Date());

  const { rows: audit } = await query(
    `SELECT actor_role, actor_id, action, after FROM audit_logs
      WHERE business_id = $1 AND action = 'subscription.invoice_paid'
      ORDER BY created_at DESC LIMIT 1`,
    [businessId]
  );
  assert.strictEqual(audit[0].actor_role, 'owner');
  assert.strictEqual(audit[0].actor_id, ownerId);
  assert.strictEqual(audit[0].after.order_id, inv.order_id);
  assert.strictEqual(audit[0].after.source, 'callback');
  assert.strictEqual(audit[0].after.payment_method, 'BC');
});

test('callback ganda idempoten: langganan tidak pernah diaktifkan dua kali', async () => {
  const inv = globalThis.__invoiceC;
  const { rows: before } = await query(
    `SELECT count(*)::int AS n FROM subscriptions WHERE business_id = $1`,
    [businessId]
  );

  const res = await sendCallback(
    signedCallback({ orderId: inv.order_id, amountIdr: inv.amount / 100 })
  );
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.status, 'sudah_lunas');

  const { rows: after } = await query(
    `SELECT count(*)::int AS n FROM subscriptions WHERE business_id = $1`,
    [businessId]
  );
  assert.strictEqual(after[0].n, before[0].n, 'tidak ada baris langganan baru');
});

test('callback untuk nomor pesanan tak dikenal dijawab 200 agar tidak diulang', async () => {
  const res = await sendCallback(
    signedCallback({ orderId: 'SINV-19700101T000000-DEADBEEF', amountIdr: 10000 })
  );
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.status, 'ignored');
  assert.strictEqual(res.body.reason, 'tagihan_tidak_dikenal');
});

test('cek status manual (sync) melunasi tagihan bila gateway menyatakan sukses', async () => {
  const created = await createInvoice(token, businessId, { planId: planBesar, paymentMethod: 'BC' });
  const inv = created.body.invoice;
  statusResponse = {
    statusCode: '00',
    statusMessage: 'SUCCESS',
    amountIdr: PRICE_BESAR / 100,
    reference: 'REF-SYNC',
  };

  const res = await syncInvoice(token, businessId, inv.id);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.checked, true);
  assert.strictEqual(res.body.invoice.status, 'paid');
  assert.strictEqual(res.body.gateway_status.code, '00');
  assert.ok(calls.checkStatus.includes(inv.order_id), 'gateway dicek dengan order_id tagihan');

  const { rows } = await query(
    `SELECT plan_id FROM subscriptions WHERE business_id = $1 AND status = 'active'`,
    [businessId]
  );
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].plan_id, planBesar);
});

test('sync pada tagihan yang sudah lunas tidak memanggil gateway lagi', async () => {
  const inv = globalThis.__invoiceC;
  const before = calls.checkStatus.length;
  const res = await syncInvoice(token, businessId, inv.id);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.checked, false);
  assert.strictEqual(calls.checkStatus.length, before, 'tanpa panggilan gateway tambahan');
});

test('riwayat tagihan: filter status & paginasi', async () => {
  const semua = await listInvoices(token, businessId, '?limit=100');
  assert.strictEqual(semua.status, 200);
  assert.ok(semua.body.total >= 4);
  assert.ok(
    semua.body.items.every((i) => i.plan && typeof i.plan.name === 'string'),
    'riwayat menyertakan nama paket'
  );

  const lunas = await listInvoices(token, businessId, '?status=paid');
  assert.ok(lunas.body.items.length >= 1);
  assert.ok(lunas.body.items.every((i) => i.status === 'paid'));

  const page = await listInvoices(token, businessId, '?limit=1&page=2');
  assert.strictEqual(page.body.items.length, 1);
  assert.strictEqual(page.body.limit, 1);

  const invalid = await listInvoices(token, businessId, '?status=entah');
  assert.strictEqual(invalid.status, 422);
});

test('isolasi tenant: tagihan bisnis orang lain tidak terlihat (404)', async () => {
  const res = await getInvoice(tokenLain, businessId, globalThis.__invoiceC.id);
  assert.strictEqual(res.status, 404);

  const buat = await createInvoice(tokenLain, businessId, { planId: planOk, paymentMethod: 'BC' });
  assert.strictEqual(buat.status, 404);

  const riwayat = await listInvoices(tokenLain, businessId);
  assert.strictEqual(riwayat.status, 404);
});

test('tanpa konfigurasi gateway: checkout menyala=false dan pembuatan tagihan 503', async () => {
  clearProviderForTests();

  const opsi = await request.get(subPath(businessId, '/plans'), auth(token));
  assert.strictEqual(opsi.status, 200);
  assert.strictEqual(opsi.body.gateway.enabled, false);
  assert.strictEqual(opsi.body.gateway.reason, 'gateway_belum_dikonfigurasi');

  const res = await createInvoice(token, businessId, { planId: planOk, paymentMethod: 'BC' });
  assert.strictEqual(res.status, 503);
  assert.match(res.body.error.message, /belum dikonfigurasi/i);

  const cb = await sendCallback(
    signedCallback({ orderId: 'SINV-19700101T000000-CAFEBABE', amountIdr: 10000 })
  );
  assert.strictEqual(cb.status, 503, 'callback pun tidak diproses tanpa kredensial');

  setProviderForTests(fakeProvider);
});
