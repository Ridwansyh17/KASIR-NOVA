/**
 * Tes unit klien payment gateway Duitku + katalog kanal.
 *
 * Tanpa jaringan dan tanpa basis data: transport `fetch` disuntikkan, sehingga
 * bentuk permintaan (nama field, tanda tangan HMAC, batas panjang), pemetaan
 * respons, dan pemetaan error dapat diuji secara deterministik.
 *
 * Yang dijaga tes ini:
 *   - rumus tanda tangan resmi Duitku (HMAC-SHA256, heksadesimal huruf kecil):
 *       inquiry : merchantCode + merchantOrderId + paymentAmount
 *       status  : merchantCode + merchantOrderId
 *       callback: merchantCode + amount + merchantOrderId
 *   - kewajiban `itemDetails` berjumlah sama dengan `paymentAmount` (kalau
 *     tidak, Duitku membalas HTTP 409).
 *   - batas panjang: merchantOrderId 50, email 50, customerVaName 20.
 *   - verifikasi callback tidak pernah meloloskan tanda tangan yang salah.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { createHmac } from 'node:crypto';
import {
  DUITKU_ENDPOINTS,
  createDuitkuClient,
  safeCompareHex,
  signCallback,
  signInquiry,
  signStatus,
  stripSignature,
} from '../src/payments/duitku.js';
import {
  channelInfo,
  channelsForList,
  expiryMinutesFor,
  isKnownChannel,
} from '../src/payments/channels.js';

const MERCHANT = 'DTESTNOVA';
const API_KEY = 'kunci_uji_sandbox_bukan_rahasia';
const BASE = DUITKU_ENDPOINTS.sandbox;

/** HMAC ditulis ulang di tes (independen dari implementasi modul). */
const hmac = (stringToSign) => createHmac('sha256', API_KEY).update(stringToSign).digest('hex');

const jsonResponse = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(payload),
});

const clientWith = (responder) => {
  const calls = [];
  const client = createDuitkuClient({
    merchantCode: MERCHANT,
    apiKey: API_KEY,
    baseUrl: BASE,
    fetchImpl: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return responder(calls.length);
    },
  });
  return { client, calls };
};

const INQUIRY_OK = {
  merchantCode: MERCHANT,
  reference: 'DTESTCX80TZJ85Q70QCI',
  paymentUrl: 'https://sandbox.duitku.com/topup/topupdirectv2.aspx?ref=TEST',
  vaNumber: '8808123456789',
  amount: '10000',
  statusCode: '00',
  statusMessage: 'SUCCESS',
};

test('tanda tangan HMAC-SHA256 memakai rumus resmi Duitku (heksadesimal huruf kecil)', () => {
  const inquiry = signInquiry({ merchantCode: MERCHANT, orderId: 'SINV-1', amountIdr: 10000, apiKey: API_KEY });
  assert.strictEqual(inquiry, hmac(`${MERCHANT}SINV-1${10000}`));
  assert.match(inquiry, /^[0-9a-f]{64}$/);

  const status = signStatus({ merchantCode: MERCHANT, orderId: 'SINV-1', apiKey: API_KEY });
  assert.strictEqual(status, hmac(`${MERCHANT}SINV-1`));

  const callback = signCallback({ merchantCode: MERCHANT, amount: '10000', orderId: 'SINV-1', apiKey: API_KEY });
  assert.strictEqual(callback, hmac(`${MERCHANT}10000SINV-1`));
});

test('safeCompareHex: cocok hanya bila panjang & isi sama', () => {
  assert.strictEqual(safeCompareHex('abcd', 'abcd'), true);
  assert.strictEqual(safeCompareHex('abcd', 'abce'), false);
  assert.strictEqual(safeCompareHex('abcd', 'abcde'), false);
  assert.strictEqual(safeCompareHex('', ''), false);
  assert.strictEqual(safeCompareHex(undefined, 'abcd'), false);
});

test('stripSignature membuang tanda tangan sebelum payload disimpan', () => {
  const clean = stripSignature({ merchantOrderId: 'SINV-1', amount: '10000', signature: 'abc' });
  assert.deepStrictEqual(clean, { merchantOrderId: 'SINV-1', amount: '10000' });
});

test('createInvoice: URL, field wajib, dan tanda tangan sesuai kontrak Duitku', async () => {
  const { client, calls } = clientWith(() => jsonResponse(INQUIRY_OK));

  const result = await client.createInvoice({
    orderId: 'SINV-20261017-ABCD1234',
    amountIdr: 10000,
    method: 'bc', // kode kanal huruf kecil dinormalkan ke huruf besar
    productDetails: 'Langganan Paket Uji - Bisnis Uji',
    email: 'owner@nova.test',
    customerName: 'Nama Owner Yang Sangat Panjang Sekali', // > 20 char
    phoneNumber: '081234567890',
    callbackUrl: 'https://contoh.test/api/payments/duitku/callback',
    returnUrl: 'https://contoh.test/api/payments/duitku/return',
    expiryMinutes: 60,
  });

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, `${BASE}/v2/inquiry`);
  assert.strictEqual(calls[0].init.method, 'POST');
  assert.strictEqual(calls[0].init.headers['Content-Type'], 'application/json');

  const b = calls[0].body;
  assert.strictEqual(b.merchantCode, MERCHANT);
  assert.strictEqual(b.paymentAmount, 10000);
  assert.strictEqual(b.paymentMethod, 'BC');
  assert.strictEqual(b.merchantOrderId, 'SINV-20261017-ABCD1234');
  assert.strictEqual(b.expiryPeriod, 60);
  assert.strictEqual(b.callbackUrl, 'https://contoh.test/api/payments/duitku/callback');
  assert.strictEqual(b.returnUrl, 'https://contoh.test/api/payments/duitku/return');
  assert.strictEqual(b.customerVaName.length <= 20, true);
  assert.deepStrictEqual(b.itemDetails, [{ name: b.productDetails, price: 10000, quantity: 1 }]);
  assert.strictEqual(
    b.itemDetails.reduce((sum, it) => sum + it.price * it.quantity, 0),
    b.paymentAmount,
    'total itemDetails wajib sama dengan paymentAmount (Duitku membalas 409 bila berbeda)'
  );
  assert.strictEqual(b.signature, hmac(`${MERCHANT}SINV-20261017-ABCD1234${10000}`));

  assert.strictEqual(result.vaNumber, '8808123456789');
  assert.strictEqual(result.reference, 'DTESTCX80TZJ85Q70QCI');
  assert.strictEqual(result.paymentUrl, INQUIRY_OK.paymentUrl);
});

test('createInvoice: email dipotong ke 50 karakter (batas Duitku)', async () => {
  const { client, calls } = clientWith(() => jsonResponse(INQUIRY_OK));
  await client.createInvoice({
    orderId: 'SINV-1',
    amountIdr: 10000,
    method: 'BC',
    productDetails: 'Uji',
    email: `${'a'.repeat(60)}@nova.test`,
    callbackUrl: 'https://contoh.test/cb',
    returnUrl: 'https://contoh.test/rt',
  });
  assert.strictEqual(calls[0].body.email.length, 50);
});

test('createInvoice: menolak respons non-200 dengan pesan gateway (502)', async () => {
  const { client } = clientWith(() => jsonResponse({ Message: 'Minimum Payment 10000 IDR' }, 400));
  await assert.rejects(
    () =>
      client.createInvoice({
        orderId: 'SINV-1',
        amountIdr: 5000,
        method: 'BC',
        productDetails: 'Uji',
        email: 'a@b.test',
        callbackUrl: 'https://contoh.test/cb',
        returnUrl: 'https://contoh.test/rt',
      }),
    (err) => {
      assert.strictEqual(err.statusCode, 502);
      assert.match(err.message, /Minimum Payment 10000 IDR/);
      return true;
    }
  );
});

test('createInvoice: menolak statusCode selain 00', async () => {
  const { client } = clientWith(() =>
    jsonResponse({ statusCode: '01', statusMessage: 'Payment channel not available' })
  );
  await assert.rejects(
    () =>
      client.createInvoice({
        orderId: 'SINV-1',
        amountIdr: 10000,
        method: 'IR',
        productDetails: 'Uji',
        email: 'a@b.test',
        callbackUrl: 'https://contoh.test/cb',
        returnUrl: 'https://contoh.test/rt',
      }),
    (err) => {
      assert.strictEqual(err.statusCode, 502);
      assert.match(err.message, /Payment channel not available/);
      return true;
    }
  );
});

test('createInvoice: kegagalan jaringan & waktu habis dipetakan ke 502', async () => {
  const refused = clientWith(() => {
    throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
  });
  await assert.rejects(
    () =>
      refused.client.createInvoice({
        orderId: 'SINV-1',
        amountIdr: 10000,
        method: 'BC',
        productDetails: 'Uji',
        email: 'a@b.test',
        callbackUrl: 'https://contoh.test/cb',
        returnUrl: 'https://contoh.test/rt',
      }),
    (err) => {
      assert.strictEqual(err.statusCode, 502);
      assert.match(err.message, /tidak dapat dihubungi/);
      return true;
    }
  );

  const aborted = clientWith(() => {
    const e = new Error('aborted');
    e.name = 'AbortError';
    throw e;
  });
  await assert.rejects(
    () =>
      aborted.client.createInvoice({
        orderId: 'SINV-1',
        amountIdr: 10000,
        method: 'BC',
        productDetails: 'Uji',
        email: 'a@b.test',
        callbackUrl: 'https://contoh.test/cb',
        returnUrl: 'https://contoh.test/rt',
      }),
    (err) => {
      assert.strictEqual(err.statusCode, 502);
      assert.match(err.message, /waktu habis/);
      return true;
    }
  );
});

test('checkStatus: memakai tanda tangan merchantCode + merchantOrderId', async () => {
  const { client, calls } = clientWith(() =>
    jsonResponse({
      merchantOrderId: 'SINV-1',
      reference: 'DTESTCX80TZJ85Q70QCI',
      amount: '10000',
      fee: '0.00',
      statusCode: '00',
      statusMessage: 'SUCCESS',
    })
  );

  const res = await client.checkStatus('SINV-1');
  assert.strictEqual(calls[0].url, `${BASE}/transactionStatus`);
  assert.strictEqual(calls[0].body.merchantCode, MERCHANT);
  assert.strictEqual(calls[0].body.merchantOrderId, 'SINV-1');
  assert.strictEqual(calls[0].body.signature, hmac(`${MERCHANT}SINV-1`));
  assert.strictEqual(res.statusCode, '00');
  assert.strictEqual(res.amountIdr, 10000);
  assert.strictEqual(res.reference, 'DTESTCX80TZJ85Q70QCI');
});

test('verifyCallback: menerima tanda tangan sah, menolak yang tidak sah', () => {
  const { client } = clientWith(() => jsonResponse(INQUIRY_OK));
  const base = {
    merchantCode: MERCHANT,
    amount: '10000',
    merchantOrderId: 'SINV-1',
    resultCode: '00',
    paymentCode: 'BC',
    reference: 'DTESTCX80TZJ85Q70QCI',
  };

  const valid = client.verifyCallback({
    ...base,
    signature: hmac(`${MERCHANT}10000SINV-1`),
  });
  assert.strictEqual(valid.ok, true);
  assert.strictEqual(valid.orderId, 'SINV-1');
  assert.strictEqual(valid.amountIdr, 10000);
  assert.strictEqual(valid.resultCode, '00');
  assert.strictEqual(valid.reference, 'DTESTCX80TZJ85Q70QCI');

  const badSignature = client.verifyCallback({ ...base, signature: hmac('halo') });
  assert.strictEqual(badSignature.ok, false);
  assert.strictEqual(badSignature.reason, 'tanda_tangan_tidak_sah');

  const otherMerchant = client.verifyCallback({
    ...base,
    merchantCode: 'DLAIN',
    signature: hmac(`DLAIN10000SINV-1`),
  });
  assert.strictEqual(otherMerchant.ok, false);
  assert.strictEqual(otherMerchant.reason, 'merchant_code_tidak_cocok');

  const missing = client.verifyCallback({ merchantCode: MERCHANT, orderId: 'SINV-1' });
  assert.strictEqual(missing.ok, false);
  assert.strictEqual(missing.reason, 'parameter_callback_kurang');

  const badAmount = client.verifyCallback({
    ...base,
    amount: 'sepuluh ribu',
    signature: hmac(`${MERCHANT}sepuluh ribuSINV-1`),
  });
  assert.strictEqual(badAmount.ok, false);
  assert.strictEqual(badAmount.reason, 'nominal_tidak_valid');
});

test('verifyCallback: tanda tangan untuk nominal lain tidak berlaku (anti-tamper)', () => {
  const { client } = clientWith(() => jsonResponse(INQUIRY_OK));
  const signature10000 = hmac(`${MERCHANT}10000SINV-1`);
  const verdict = client.verifyCallback({
    merchantCode: MERCHANT,
    amount: '990000',
    merchantOrderId: 'SINV-1',
    resultCode: '00',
    signature: signature10000,
  });
  assert.strictEqual(verdict.ok, false);
  assert.strictEqual(verdict.reason, 'tanda_tangan_tidak_sah');
});

test('katalog kanal: label, jenis, dan pembatasan masa berlaku', () => {
  assert.strictEqual(isKnownChannel('BC'), true);
  assert.strictEqual(isKnownChannel('bc'), true);
  assert.strictEqual(isKnownChannel('ZZ'), false);

  const bc = channelInfo('BC');
  assert.strictEqual(bc.kind, 'va');
  assert.strictEqual(bc.label, 'BCA Virtual Account');

  const nq = channelInfo('NQ');
  assert.strictEqual(nq.kind, 'qris');

  assert.strictEqual(expiryMinutesFor('BC', 1440), 1440);
  assert.strictEqual(expiryMinutesFor('SP', 1440), 60, 'QRIS ShopeePay maksimum 60 menit');
  assert.strictEqual(expiryMinutesFor('BC', 0), 1440, 'nilai tak wajar -> default kanal');

  const list = channelsForList(['BC', 'NQ', 'ZZ']);
  assert.deepStrictEqual(
    list.map((c) => c.code),
    ['BC', 'NQ'],
    'kode tak dikenal dibuang dari daftar'
  );
});
