#!/usr/bin/env node
/**
 * sandbox-duitku-e2e.mjs — uji sandbox pembayaran langganan (Duitku) lewat API
 * KASIR NOVA sendiri. Dipakai SETELAH pemilik mengisi `PAYMENT_*`/`DUITKU_*`
 * di `server/.env` (dokumen: docs/38 §10).
 *
 * Alur yang diuji (tanpa URL publik — memakai `/invoices/:id/sync`):
 *   1. Health server lokal.
 *   2. Login Owner (kredensial seed dari `server/.env`).
 *   3. Pilih bisnis aktif pertama milik Owner.
 *   4. `GET  …/subscription/plans`  → status gateway + kanal aktif.
 *   5. `POST …/subscription/invoices` → tagihan VA/QRIS **sungguhan** (sandbox).
 *   6. `POST …/invoices/:id/sync`   → cek status ke gateway.
 *   7. Bila sudah dibayar: laporkan aktivasi langganan.
 *
 * Keamanan: skrip TIDAK pernah mencetak kata sandi, token, API key, atau
 * merchant code. Nomor VA ditampilkan **bertopeng** (4 digit terakhir) kecuali
 * bila `--show-va` diberikan (nomor VA sandbox bukan rahasia, hanya agar log
 * tetap ringkas).
 *
 * Pemakaian (dari root repo, server lokal harus jalan):
 *   node scripts/sandbox-duitku-e2e.mjs                 # gateway belum diisi ⇒ berhenti rapi
 *   node scripts/sandbox-duitku-e2e.mjs --show-va       # tampilkan nomor VA penuh
 *   node scripts/sandbox-duitku-e2e.mjs --channel NQ    # pakai kanal tertentu (mis. QRIS)
 *   BASE_URL=http://localhost:4000 node scripts/sandbox-duitku-e2e.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE_URL || 'http://localhost:4000';
const SHOW_VA = process.argv.includes('--show-va');
const argValue = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1].trim().toUpperCase()
    : null;
};
const CHANNEL = argValue('--channel');

/** Baca satu nilai dari server/.env (nilai TIDAK pernah dicetak). */
const envValue = (name) => {
  const text = readFileSync(join(root, 'server', '.env'), 'utf8');
  const line = text.split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim() : null;
};

const mask = (value) => {
  if (!value) return '(tidak ada)';
  const s = String(value);
  if (SHOW_VA) return s;
  return s.length <= 4 ? '••••' : `${'•'.repeat(Math.max(0, s.length - 4))}${s.slice(-4)}`;
};

let gagal = 0;
const step = (label, ok, info = '') => {
  if (!ok) gagal++;
  console.log(`  ${ok ? 'PASS' : 'GAGAL'}  ${label}${info ? ` — ${info}` : ''}`);
};

const api = async (path, { method = 'GET', token, body } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* respons tanpa JSON */
  }
  return { status: res.status, json };
};

const asList = (payload) =>
  Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : [];

console.log(`\n=== UJI SANDBOX PEMBAYARAN LANGGANAN — ${BASE} ===`);

// ---------------------------------------------------------------- 1. health
try {
  const r = await api('/api/health');
  step('1. Health server lokal', r.status === 200, `status=${r.status} db=${r.json?.services?.database ?? '?'}`);
} catch (err) {
  step('1. Health server lokal', false, `server tidak jalan? ${err.message}`);
  console.log('\nRingkasan: server lokal belum siap — jalankan dulu `npm.cmd run dev` di folder server/.');
  process.exit(1);
}

// ----------------------------------------------------------------- 2. login
const email = process.env.OWNER_EMAIL || 'owner@nova.test';
const password = process.env.OWNER_PASSWORD || envValue('SEED_OWNER_PASSWORD');
if (!password) {
  step('2. Login Owner', false, 'SEED_OWNER_PASSWORD tidak ada di server/.env');
  process.exit(1);
}
const login = await api('/api/auth/login', {
  method: 'POST',
  body: { role: 'owner', email, password },
});
const token = login.json?.accessToken;
step(
  '2. Login Owner',
  login.status === 200 && !!token,
  `status=${login.status} role=${login.json?.user?.role ?? '?'}${login.status === 200 ? '' : ` pesan=${login.json?.error?.message ?? '-'}`}`
);
if (!token) {
  console.log('\nRingkasan: login gagal — periksa SEED_OWNER_EMAIL/SEED_OWNER_PASSWORD di server/.env.');
  process.exit(1);
}

// -------------------------------------------------------------- 3. bisnis
const bisnis = asList((await api('/api/owner/businesses', { token })).json);
step('3. Bisnis milik Owner tersedia', bisnis.length > 0, bisnis[0] ? `dipakai "${bisnis[0].name}"` : 'tidak ada');
if (!bisnis.length) process.exit(1);
const businessId = bisnis[0].id;
const subPath = `/api/owner/businesses/${businessId}/subscription`;

// ------------------------------------------------- 4. status gateway & paket
const opsi = await api(`${subPath}/plans`, { token });
if (opsi.status !== 200) {
  step('4. Opsi checkout (paket + gateway)', false, `status=${opsi.status} ${opsi.json?.error?.message ?? ''}`);
  process.exit(1);
}
const gateway = opsi.json.gateway ?? {};
// Hanya paket berbayar yang memenuhi minimum gateway (nominal < minimum
// ditolak server dengan 422, jadi tidak ada gunanya diuji).
const minIdr = Number(gateway.min_amount_idr ?? 0);
const semuaBerbayar = (opsi.json.plans ?? []).filter((p) => p.purchasable);
const terlaluKecil = semuaBerbayar.filter((p) => p.price < minIdr * 100);
const paket = semuaBerbayar.filter((p) => p.price >= minIdr * 100);
const ringkasGateway = `provider=${gateway.provider} mode=${gateway.mode} enabled=${gateway.enabled} kanal=${(gateway.channels ?? []).map((c) => c.code).join(',') || '-'}${gateway.reason ? ` alasan=${gateway.reason}` : ''}`;

if (!gateway.enabled) {
  // Kondisi normal sebelum kredensial diisi — BUKAN kegagalan kode.
  console.log(`  ⏸  4. Status gateway pembayaran — ${ringkasGateway}`);
  const petunjuk =
    gateway.reason === 'kredensial_duitku_belum_lengkap'
      ? 'Kredensial Duitku belum lengkap: butuh DUITKU_MERCHANT_CODE **dan** DUITKU_API_KEY di server/.env.'
      : gateway.reason === 'mode_produksi_belum_diizinkan'
        ? 'Mode produksi belum diizinkan: butuh PAYMENT_ALLOW_PRODUCTION=true (jangan untuk sandbox).'
        : 'Isi PAYMENT_PROVIDER=duitku, PAYMENT_MODE=sandbox, DUITKU_MERCHANT_CODE, DUITKU_API_KEY di server/.env.';
  console.log(
    `\nRingkasan: ⏸ gateway BELUM dikonfigurasi (server menjawab 503 dengan aman).\n` +
      `${petunjuk}\n` +
      'Restart server, lalu jalankan skrip ini lagi. Lihat docs/38 §2 & §10.\n' +
      'Tidak ada tagihan yang dibuat. Keluar dengan status 0 (bukan kegagalan kode).'
  );
  process.exit(0);
}
step('4. Status gateway pembayaran', true, ringkasGateway);

const infoPaket = paket[0]
  ? `${paket[0].name} = ${paket[0].price} sen / ${paket[0].duration_days} hari` +
    (terlaluKecil.length > 0 ? ` (dilewati ${terlaluKecil.length} paket < minimum Rp ${minIdr.toLocaleString('id-ID')})` : '')
  : `tidak ada paket ≥ Rp ${minIdr.toLocaleString('id-ID')}`;
step('5. Paket berbayar tersedia', paket.length > 0, infoPaket);
if (!paket.length) {
  console.log(
    `\nRingkasan: tidak ada paket berbayar yang memenuhi minimum gateway (Rp ${minIdr.toLocaleString('id-ID')}).\n` +
      'Buat paket uji dengan harga ≥ minimum, atau turunkan PAYMENT_MIN_AMOUNT_IDR di server/.env.'
  );
  process.exit(1);
}

// ------------------------------------------------------- 6. buat tagihan
const kanalTersedia = (gateway.channels ?? []).map((c) => c.code);
if (CHANNEL && !kanalTersedia.includes(CHANNEL)) {
  console.log(
    `\nRingkasan: kanal ${CHANNEL} tidak aktif di server ini (aktif: ${kanalTersedia.join(',') || '-'}).\n` +
      `Tambahkan kode itu pada PAYMENT_CHANNELS di server/.env lalu restart server.`
  );
  process.exit(1);
}
const kanal = CHANNEL || kanalTersedia[0];
const buat = await api(`${subPath}/invoices`, {
  method: 'POST',
  token,
  body: { planId: paket[0].id, paymentMethod: kanal },
});
const inv = buat.json?.invoice;
if (buat.status !== 200 && buat.status !== 201) {
  step('6. Buat tagihan via gateway', false, `status=${buat.status} ${buat.json?.error?.message ?? ''}`);
  console.log('\nRingkasan: pembuatan tagihan GAGAL — periksa pesan di atas & kredensial sandbox.');
  process.exit(1);
}
step(
  '6. Buat tagihan via gateway',
  true,
  `status=${buat.status} reused=${buat.json?.reused === true} order=${inv.order_id} status=${inv.status} nominal=${inv.amount} sen kanal=${inv.payment_method_label ?? inv.payment_method}`
);
console.log(
  `         VA/QR  : ${inv.va_number ? `VA ${mask(inv.va_number)}` : inv.qr_string ? `QRIS qrString ${String(inv.qr_string).length} karakter (digambar di panel)` : '(tidak ada)'}` +
    `\n         berlaku: ${inv.expires_at ?? '-'}` +
    `\n         tautan : ${inv.payment_url ?? '-'}`
);

// --------------------------------------------------------- 7. cek status
const sync = await api(`${subPath}/invoices/${inv.id}/sync`, { method: 'POST', token });
const inv2 = sync.json?.invoice;
step('7. Cek status ke gateway', sync.status === 200, `status=${sync.status} tagihan=${inv2?.status ?? '?'} diperiksa=${sync.json?.checked === true}`);
if (inv2?.status === 'paid') {
  const sub = await api('/api/owner/businesses/' + businessId + '/subscription', { token });
  step(
    '8. Langganan aktif setelah pembayaran',
    sub.status === 200 && sub.json?.subscription?.status === 'active',
    `plan=${sub.json?.plan?.name ?? '?'} status=${sub.json?.subscription?.status ?? '?'}`
  );
} else {
  console.log(
    `         catatan: tagihan masih "${inv2?.status ?? 'pending'}". Bayar lewat halaman demo Duitku\n` +
      '         (https://sandbox.duitku.com/payment/demo/demosuccesstransaction.aspx) lalu\n' +
      '         jalankan ulang skrip ini (tagihan pending akan dipakai ulang) atau tekan\n' +
      '         tombol "Cek Status" di panel Owner.'
  );
}

console.log(`\nRingkasan: ${gagal === 0 ? 'SEMUA LANGKAH LULUS' : `${gagal} LANGKAH GAGAL`}`);
process.exit(gagal === 0 ? 0 : 1);
