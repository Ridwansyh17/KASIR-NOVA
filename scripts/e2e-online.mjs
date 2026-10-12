#!/usr/bin/env node
/**
 * E2E smoke ONLINE — KASIR NOVA (Fase 13).
 *
 * Menjalankan alur bisnis lengkap terhadap deployment produksi
 * (Vercel + Neon). Aman dijalankan ulang (idempoten): data demo dibuat
 * hanya bila belum ada; transaksi memakai clientRef unik agar tidak
 * menggandakan data saat diulang.
 *
 * Env (rahasia TIDAK ada di file ini):
 *   BASE_URL            default https://kasir-nova.vercel.app
 *   OWNER_EMAIL         akun owner (seed)
 *   OWNER_PASSWORD
 *   ADMIN_EMAIL         akun platform admin (seed)
 *   ADMIN_PASSWORD
 *   E2E_BUSINESS_NAME   default "Demo Kasir NOVA"
 *   E2E_CASHIER_EMAIL   default kasir.demo@nova.test
 *   E2E_CASHIER_PASSWORD default KasirDemo123!
 *   E2E_CASHIER_PIN     default 0248
 *   E2E_PLATFORM_FLOW=1   ikut menguji alur Admin Platform (buat owner uji ->
 *                         login -> isolasi tenant -> soft-delete -> login ditolak).
 *
 * Pemakaian (PowerShell, tanpa menampilkan password):
 *   $env:BASE_URL='https://kasir-nova.vercel.app'
 *   $env:OWNER_EMAIL=...; $env:OWNER_PASSWORD=...; ...
 *   node scripts/e2e-online.mjs
 * Exit code 0 = semua langkah PASS; 1 = ada FAIL/BLOCKED.
 */
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';

const BASE = (process.env.BASE_URL || 'https://kasir-nova.vercel.app').replace(/\/+$/, '');

const DEMO = {
  business: process.env.E2E_BUSINESS_NAME || 'Demo Kasir NOVA',
  outlet: 'Outlet Utama',
  outletTaxRate: 11, // PPN eksklusif
  categories: ['Makanan', 'Minuman'],
  products: [
    { name: 'Nasi Goreng Spesial', price: 1_500_000, category: 'Makanan', trackStock: true, stock: 50 },
    { name: 'Mie Goreng Spesial', price: 1_300_000, category: 'Makanan', trackStock: true, stock: 40 },
    { name: 'Es Teh Manis', price: 500_000, category: 'Minuman', trackStock: true, stock: 100 },
    { name: 'Jasa Antar', price: 250_000, category: null, trackStock: false, stock: 0 },
  ],
  cashier: {
    fullName: 'Kasir Demo',
    email: process.env.E2E_CASHIER_EMAIL || 'kasir.demo@nova.test',
    password: process.env.E2E_CASHIER_PASSWORD || 'KasirDemo123!',
    pin: process.env.E2E_CASHIER_PIN || '0248',
  },
};

const results = [];
const notes = [];
function step(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) process.exitCode = 1;
}
function note(msg) {
  notes.push(msg);
}

async function api(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  const text = await res.text();
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text.slice(0, 160) };
  }
  return { status: res.status, ok: res.ok, json };
}

const asList = (json) => {
  if (!json) return [];
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.items)) return json.items;
  if (Array.isArray(json.rows)) return json.rows;
  return [];
};

// ------------------------------------------------------------------ 1. Health
try {
  const r = await api('/api/health');
  const dbUp = r.json?.services?.database === 'up';
  step('1. Health API + database online', dbUp, `${r.status} db=${r.json?.services?.database}`);
} catch (e) {
  step('1. Health API + database online', false, String(e));
}

// ----------------------------------------------------------------- 2. Login
let ownerToken, adminToken;
const ownerEmail = process.env.OWNER_EMAIL;
const ownerPw = process.env.OWNER_PASSWORD;
const adminEmail = process.env.ADMIN_EMAIL;
const adminPw = process.env.ADMIN_PASSWORD;

if (!ownerEmail || !ownerPw) {
  step('2. Owner login', false, 'OWNER_EMAIL/OWNER_PASSWORD belum diset');
} else {
  try {
    const r = await api('/api/auth/login', {
      method: 'POST',
      body: { role: 'owner', email: ownerEmail, password: ownerPw },
    });
    ownerToken = r.json?.accessToken;
    step('2. Owner login', r.status === 200 && !!ownerToken, `status=${r.status} role=${r.json?.user?.role}`);
  } catch (e) {
    step('2. Owner login', false, String(e));
  }
}

if (!adminEmail || !adminPw) {
  step('3. Admin Platform login', false, 'ADMIN_EMAIL/ADMIN_PASSWORD belum diset');
} else {
  try {
    const r = await api('/api/auth/login', {
      method: 'POST',
      body: { role: 'platform_admin', email: adminEmail, password: adminPw },
    });
    adminToken = r.json?.accessToken;
    step('3. Admin Platform login', r.status === 200 && !!adminToken, `status=${r.status} role=${r.json?.user?.role}`);
  } catch (e) {
    step('3. Admin Platform login', false, String(e));
  }
}

// ---------------------------------------------------- 4. Bisnis + outlet demo
let businessId;
if (ownerToken) {
  try {
    const list = asList((await api('/api/owner/businesses', { token: ownerToken })).json);
    const existing = list.find((b) => b.name === DEMO.business);
    if (existing) {
      businessId = existing.id;
      step('4. Bisnis demo tersedia (buat bila perlu)', true, `dipakai kembali "${DEMO.business}"`);
    } else {
      const r = await api('/api/owner/businesses', { method: 'POST', token: ownerToken, body: { name: DEMO.business, businessType: 'F&B' } });
      businessId = r.json?.business?.id;
      step('4. Bisnis demo tersedia (buat bila perlu)', r.status === 201 && !!businessId, `dibuat (status=${r.status})`);
    }
  } catch (e) {
    step('4. Bisnis demo tersedia (buat bila perlu)', false, String(e));
  }
}

let outletId;
if (ownerToken && businessId) {
  try {
    const list = asList((await api(`/api/owner/businesses/${businessId}/outlets`, { token: ownerToken })).json);
    const existing = list.find((o) => o.name === DEMO.outlet);
    if (existing) {
      outletId = existing.id;
      step('5. Outlet utama tersedia', true, 'dipakai kembali');
    } else {
      const r = await api(`/api/owner/businesses/${businessId}/outlets`, {
        method: 'POST',
        token: ownerToken,
        body: { name: DEMO.outlet, taxRate: DEMO.outletTaxRate },
      });
      outletId = r.json?.outlet?.id;
      step('5. Outlet utama tersedia', r.status === 201 && !!outletId, `dibuat (status=${r.status})`);
    }
  } catch (e) {
    step('5. Outlet utama tersedia', false, String(e));
  }
}

if (ownerToken && businessId) {
  try {
    const r = await api(`/api/owner/businesses/${businessId}/subscription`, { token: ownerToken });
    const v = r.json?.subscription ?? r.json?.plan ?? r.json;
    const ok = r.status === 200 && v && /active/i.test(String(v.status ?? ''));
    step('6. Langganan bisnis aktif (plan gratis)', ok, `status=${r.status} plan=${v?.plan_name ?? v?.name ?? '?'} sub=${v?.status ?? '?'}`);
  } catch (e) {
    step('6. Langganan bisnis aktif (plan gratis)', false, String(e));
  }
}

// ------------------------------------------------------- 7. Kategori & produk
const categoryIds = {};
if (ownerToken && businessId) {
  try {
    const list = asList((await api(`/api/owner/businesses/${businessId}/categories`, { token: ownerToken })).json);
    for (const name of DEMO.categories) {
      const found = list.find((c) => c.name === name);
      if (found) {
        categoryIds[name] = found.id;
      } else {
        const r = await api(`/api/owner/businesses/${businessId}/categories`, {
          method: 'POST', token: ownerToken, body: { name },
        });
        categoryIds[name] = r.json?.category?.id;
      }
    }
    step('7. Kategori dibuat', Object.keys(categoryIds).length === DEMO.categories.length, Object.keys(categoryIds).join(', '));
  } catch (e) {
    step('7. Kategori dibuat', false, String(e));
  }
}

const productIds = {}; // name -> id
if (ownerToken && businessId) {
  try {
    const list = asList((await api(`/api/owner/businesses/${businessId}/products`, { token: ownerToken })).json);
    for (const p of DEMO.products) {
      const found = list.find((x) => x.name === p.name);
      if (found) {
        productIds[p.name] = found.id;
      } else {
        const r = await api(`/api/owner/businesses/${businessId}/products`, {
          method: 'POST',
          token: ownerToken,
          body: {
            name: p.name,
            price: p.price,
            trackStock: p.trackStock,
            categoryId: p.category ? categoryIds[p.category] : null,
          },
        });
        productIds[p.name] = r.json?.product?.id;
        if (!productIds[p.name]) console.error(`  - gagal buat produk ${p.name}: ${r.status} ${JSON.stringify(r.json)}`);
      }
    }
    const missing = DEMO.products.filter((p) => !productIds[p.name]);
    step('8. Produk demo tersedia', missing.length === 0, missing.length ? `kurang: ${missing.map((m) => m.name).join(', ')}` : `${DEMO.products.length} produk siap`);
  } catch (e) {
    step('8. Produk demo tersedia', false, String(e));
  }
}

if (ownerToken && businessId && outletId) {
  try {
    let allOk = true;
    for (const p of DEMO.products) {
      if (!p.trackStock) continue;
      const r = await api(`/api/owner/businesses/${businessId}/products/${productIds[p.name]}/stocks/${outletId}`, {
        method: 'PATCH', token: ownerToken, body: { quantity: p.stock },
      });
      if (r.status !== 200) allOk = false;
    }
    step('9. Stok awal produk diisi', allOk, 'ok');
  } catch (e) {
    step('9. Stok awal produk diisi', false, String(e));
  }
}

async function readStock(productName) {
  const r = await api(`/api/owner/businesses/${businessId}/products/${productIds[productName]}`, { token: ownerToken });
  const s = (r.json?.stocks ?? []).find((x) => x.outlet_id === outletId);
  return s ? Number(s.quantity) : null;
}

// ------------------------------------------------------- 10. Kasir demo + PIN
let cashierId;
if (ownerToken && businessId && outletId) {
  try {
    const list = asList((await api(`/api/owner/businesses/${businessId}/cashiers`, { token: ownerToken })).json);
    const found = list.find((c) => c.email === DEMO.cashier.email);
    if (found) {
      cashierId = found.id;
    } else {
      const r = await api(`/api/owner/businesses/${businessId}/cashiers`, {
        method: 'POST',
        token: ownerToken,
        body: {
          fullName: DEMO.cashier.fullName,
          email: DEMO.cashier.email,
          password: DEMO.cashier.password,
          outletId,
        },
      });
      cashierId = r.json?.cashier?.id;
      if (!cashierId) console.error(`  - gagal buat kasir: ${r.status} ${JSON.stringify(r.json)}`);
    }
    // Pastikan PIN aktif (idempoten).
    if (cashierId) {
      const pin = await api(`/api/owner/businesses/${businessId}/cashiers/${cashierId}/pin`, {
        method: 'POST', token: ownerToken, body: { pin: DEMO.cashier.pin },
      });
      if (![200, 201, 409].includes(pin.status)) {
        step('10. Kasir demo ada + PIN terset', false, `set PIN status=${pin.status}`);
      } else {
        step('10. Kasir demo ada + PIN terset', true, `id=${cashierId} email=${DEMO.cashier.email}`);
      }
    } else {
      step('10. Kasir demo ada + PIN terset', false, 'kasir gagal dibuat');
    }
  } catch (e) {
    step('10. Kasir demo ada + PIN terset', false, String(e));
  }
}

// ------------------------------------------------- 11. Login PIN kasir + me
let cashierToken;
if (cashierId && outletId) {
  try {
    const cards = asList((await api(`/api/auth/cashiers?outletId=${outletId}`)).json);
    const card = cards.find((c) => c.id === cashierId);
    if (!card) {
      step('11. Kasir login PIN (pilih kartu → PIN)', false, 'kartu tidak muncul di pemilih');
    } else {
      const r = await api('/api/auth/cashier-pin', { method: 'POST', body: { cashierId: card.id, pin: DEMO.cashier.pin } });
      cashierToken = r.json?.accessToken;
      step('11. Kasir login PIN (pilih kartu → PIN)', r.status === 200 && !!cashierToken, `status=${r.status} role=${r.json?.user?.role}`);
      if (cashierToken) {
        const me = await api('/api/auth/me', { token: cashierToken });
        const outId = me.json?.context?.outlet?.id;
        step('12. /api/auth/me kasir → outlet benar', me.status === 200 && outId === outletId, `outlet=${outId === outletId ? 'sama' : outId}`);
      }
    }
  } catch (e) {
    step('11. Kasir login PIN (pilih kartu → PIN)', false, String(e));
  }
}

// ------------------------------------------- 13. Kasir melihat katalog outlet
if (cashierToken) {
  try {
    const r = await api('/api/cashier/products', { token: cashierToken });
    const names = asList(r.json).map((p) => p.name);
    const hasNasi = names.includes('Nasi Goreng Spesial');
    const hasEs = names.includes('Es Teh Manis');
    step('13. Kasir membaca katalog outlet (read-only)', r.status === 200 && hasNasi && hasEs, `${names.length} produk`);
  } catch (e) {
    step('13. Kasir membaca katalog outlet (read-only)', false, String(e));
  }
}

// ------------------------------------------------------------- 14. Penjualan
let saleAId;
if (cashierToken && businessId && outletId) {
  try {
    const stockBefore = await readStock('Nasi Goreng Spesial');
    const r = await api('/api/cashier/transactions', {
      method: 'POST',
      token: cashierToken,
      body: {
        items: [{ productId: productIds['Nasi Goreng Spesial'], qty: 2 }],
        payment: { method: 'cash', amount: 4_000_000 },
        clientRef: randomUUID(),
      },
    });
    const t = r.json?.transaction;
    const totalsOk =
      r.status === 201 && t && Number(t.subtotal) === 3_000_000 && Number(t.tax_total) === 330_000 && Number(t.total) === 3_330_000;
    const stockAfter = await readStock('Nasi Goreng Spesial');
    const stockOk = stockBefore !== null && stockAfter === stockBefore - 2;
    saleAId = t?.id;
    step(
      '14. Penjualan tunai A (server hitung total) + stok berkurang',
      totalsOk && stockOk,
      `status=${r.status} invoice=${t?.invoice_no} total=${t?.total} stok ${stockBefore}->${stockAfter}`
    );
    if (saleAId) note(`invoice A=${t?.invoice_no} id=${saleAId}`);
  } catch (e) {
    step('14. Penjualan tunai A (server hitung total) + stok berkurang', false, String(e));
  }
}

// --------------------------------------------------------- 15. Idempoten-ref
if (cashierToken) {
  try {
    const clientRef = randomUUID();
    const body = {
      items: [{ productId: productIds['Nasi Goreng Spesial'], qty: 1 }],
      payment: { method: 'cash', amount: 2_000_000 },
      clientRef,
    };
    const first = await api('/api/cashier/transactions', { method: 'POST', token: cashierToken, body });
    const second = await api('/api/cashier/transactions', { method: 'POST', token: cashierToken, body });
    const sameId = first.json?.transaction?.id === second.json?.transaction?.id;
    step(
      '15. Permintaan ulang (clientRef sama) tidak menggandakan',
      first.status === 201 && second.status === 200 && second.json?.idempotent === true && sameId,
      `1st=${first.status} 2nd=${second.status} idem=${second.json?.idempotent}`
    );
    // Bersihkan transaksi duplikat-uji ini agar tidak menumpuk riwayat demo.
    if (second.json?.transaction?.id && ownerToken && businessId) {
      await api(`/api/owner/businesses/${businessId}/transactions/${second.json.transaction.id}/void`, { method: 'POST', token: ownerToken, body: {} });
      note('transaksi uji idempotensi di-void');
    }
  } catch (e) {
    step('15. Permintaan ulang (clientRef sama) tidak menggandakan', false, String(e));
  }
}

// ------------------------------------------------------- 16. Void kembalikan stok
if (ownerToken && businessId && outletId && cashierToken) {
  try {
    const stockBefore = await readStock('Es Teh Manis');
    const r = await api('/api/cashier/transactions', {
      method: 'POST',
      token: cashierToken,
      body: {
        items: [{ productId: productIds['Es Teh Manis'], qty: 1 }],
        payment: { method: 'cash', amount: 1_000_000 },
        clientRef: randomUUID(),
      },
    });
    const txId = r.json?.transaction?.id;
    const total = Number(r.json?.transaction?.total);
    const v = txId ? await api(`/api/owner/businesses/${businessId}/transactions/${txId}/void`, { method: 'POST', token: ownerToken, body: {} }) : null;
    const stockAfter = await readStock('Es Teh Manis');
    const ok = r.status === 201 && v?.status === 200 && v.json?.transaction?.status === 'voided' && stockBefore !== null && stockAfter === stockBefore;
    step('16. Void oleh Owner mengembalikan stok', ok, `sale=${r.status} void=${v?.status} stok ${stockBefore}->${stockAfter} total_void=${total}`);
  } catch (e) {
    step('16. Void oleh Owner mengembalikan stok', false, String(e));
  }
}

// -------------------------------------------------------------- 17. Laporan
if (ownerToken && businessId) {
  try {
    const g = await api(`/api/owner/businesses/${businessId}/reports?groupBy=day`, { token: ownerToken });
    const s = await api(`/api/owner/businesses/${businessId}/reports/summary`, { token: ownerToken });
    const sm = s.json?.summary;
    const ok = g.status === 200 && s.status === 200 && sm && Number(sm.total) >= 3_330_000 && Number(sm.voided_total) >= 555_000;
    step(
      '17. Laporan agregat + ringkasan (revenue & voided)',
      ok,
      `grouped=${g.status} summary=${s.status} revenue>=3.330.000 voided>=555.000`
    );
    if (sm) note(`ringkasan: total=${sm.total} voided_total=${sm.voided_total} top=${sm.top ?? ''}`);
  } catch (e) {
    step('17. Laporan agregat + ringkasan (revenue & voided)', false, String(e));
  }
}

if (ownerToken && businessId) {
  try {
    const r = await api(`/api/owner/businesses/${businessId}/reports/export?format=json`, { token: ownerToken });
    step('18. Ekspor laporan (JSON)', r.status === 200, `status=${r.status}`);
  } catch (e) {
    step('18. Ekspor laporan (JSON)', false, String(e));
  }
}

if (ownerToken && businessId) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const res = await fetch(
      `${BASE}/api/owner/businesses/${businessId}/reports/export?format=xlsx&from=2000-01-01&to=${today}`,
      { headers: { Authorization: `Bearer ${ownerToken}` } }
    );
    const buf = Buffer.from(await res.arrayBuffer());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const names = wb.worksheets.map((s) => s.name);
    const ok =
      res.status === 200 &&
      buf.length > 1000 &&
      names.includes('Ringkasan') &&
      names.includes('Detail Transaksi') &&
      names.includes('Rekap Harian') &&
      names.includes('Rekap Metode Pembayaran');
    step(
      '19. Ekspor rekap transaksi Excel (.xlsx)',
      ok,
      `status=${res.status} sheets=${names.join(',')} bytes=${buf.length}`
    );
  } catch (e) {
    step('19. Ekspor rekap transaksi Excel (.xlsx)', false, String(e));
  }
}

// ------------------------------------------------------- 20. Audit log owner
if (ownerToken && businessId) {
  try {
    const r = await api(`/api/owner/businesses/${businessId}/audit-logs`, { token: ownerToken });
    const actions = asList(r.json).map((a) => a.action);
    step('20. Audit log owner mencatat transaksi', r.status === 200 && actions.includes('transaction.create'), `${actions.length} entri`);
  } catch (e) {
    step('20. Audit log owner mencatat transaksi', false, String(e));
  }
}

// ------------------------------------------------------------- 21. Admin view
if (adminToken) {
  try {
    const b = await api('/api/platform/businesses?limit=5', { token: adminToken });
    const names = asList(b.json).map((x) => x.name ?? x.business_name);
    const hasDemo = names.includes(DEMO.business);
    const a = await api('/api/platform/audit-logs?limit=5', { token: adminToken });
    const s = await api('/api/platform/sessions', { token: adminToken });
    step('21. Admin: daftar bisnis + audit-log + sesi kasir', b.status === 200 && hasDemo && a.status === 200 && s.status === 200, `businesses=${b.status} audit=${a.status} sessions=${s.status}`);
  } catch (e) {
    step('21. Admin: daftar bisnis + audit-log + sesi kasir', false, String(e));
  }
}

// ------------------------------------------------------ 22. Halaman statis
try {
  const paths = ['/kasir/', '/admin/', '/owner/'];
  const results2 = await Promise.all(paths.map((p) => fetch(`${BASE}${p}`)));
  const ok = results2.every((r) => r.status === 200);
  step('22. Halaman statis /kasir /admin /owner (200)', ok, results2.map((r) => r.status).join(','));
} catch (e) {
  step('22. Halaman statis /kasir /admin /owner (200)', false, String(e));
}

// ------------------------------------------------- Admin Platform flow (opsional)
// Alur: admin buat owner uji -> login -> isolasi tenant -> soft-delete
// -> login ditolak. Self-cleaning (owner dihapus di akhir tes).
if (adminToken && process.env.E2E_PLATFORM_FLOW === '1') {
  const platformEmail = `e2e.plat.${randomUUID().slice(0, 8)}@nova.test`;
  const platformPw = 'E2ePlatform!2026';
  const platformName = 'Owner Uji Platform Online';

  const cr = await api('/api/platform/owners', {
    method: 'POST',
    token: adminToken,
    body: { email: platformEmail, password: platformPw, fullName: platformName, phone: '+6281111000000' },
  });
  const oid = cr.json?.owner?.id;
  step('23. Admin membuat owner uji (soft-delete di akhir tes)', cr.status === 201 && !!oid, `status=${cr.status}`);

  if (oid) {
    const l = await api('/api/auth/login', {
      method: 'POST',
      body: { role: 'owner', email: platformEmail, password: platformPw },
    });
    const otk = l.json?.accessToken;
    step('24. Owner baru bisa login & mendapatkan sesi', l.status === 200 && !!otk, `status=${l.status}`);

    if (otk) {
      const ownBiz = asList((await api('/api/owner/businesses', { token: otk })).json).filter((b) => b.id === businessId);
      const hidden = await api(`/api/owner/businesses/${businessId}`, { token: otk });
      step(
        '25. Isolasi tenant: owner baru TIDAK melihat bisnis demo (404)',
        hidden.status === 404 && ownBiz.length === 0,
        `status=${hidden.status}`
      );
    }

    const del = await api(`/api/platform/owners/${oid}`, { method: 'DELETE', token: adminToken });
    step('26. Admin soft-delete owner uji', del.status === 200, `status=${del.status}`);

    const l2 = await api('/api/auth/login', {
      method: 'POST',
      body: { role: 'owner', email: platformEmail, password: platformPw },
    });
    step('27. Owner yang dihapus tidak bisa login lagi (401/403)', [401, 403].includes(l2.status), `status=${l2.status}`);
    note(`owner uji ${platformEmail} dibuat & dihapus (soft-delete) — tersisa di audit trail`);
  }
}

// --------------------------------------------------------------- Ringkasan
console.log('\n=== E2E ONLINE — ' + BASE + ' ===');
console.log(`tanggal: ${new Date().toISOString()}`);
for (const r of results) {
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
}
const pass = results.filter((r) => r.ok).length;
const fail = results.filter((r) => !r.ok).length;
console.log(`\nTotal: ${results.length} langkah  |  PASS ${pass}  FAIL ${fail}`);
if (notes.length) {
  console.log('\nCatatan:');
  for (const n of notes) console.log(`  - ${n}`);
}
console.log(fail === 0 ? '\nHASIL: SEMUA LULUS (exit 0)' : '\nHASIL: ADA KEGAGALAN (exit 1)');
process.exitCode = fail === 0 ? 0 : 1;