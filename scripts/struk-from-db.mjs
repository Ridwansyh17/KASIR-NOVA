/**
 * Ambil SATU transaksi nyata dari database lalu buat gambar struk (.jpg).
 *
 * Read-only (hanya SELECT). Susunan baris meniru `apps/kasir/src/receipt.js`:
 * kertas 58mm, 32 kolom monospace, label/nilai sejajar, harga rata kanan,
 * "Rp" pada nominal, Uang Diterima/Kembalian hanya untuk tunai yang LUNAS.
 *
 * Pemakaian (dari root repo):
 *   node scripts/struk-from-db.mjs                # transaksi terbaru (utamakan completed)
 *   node scripts/struk-from-db.mjs --list         # daftar transaksi terbaru
 *   node scripts/struk-from-db.mjs --index 3      # pilih dari hasil --list
 *   node scripts/struk-from-db.mjs --tx <uuid>    # transaksi tertentu
 *   node scripts/struk-from-db.mjs --out STRUK.jpg
 *
 * Env: DATABASE_URL dibaca dari server/.env (tidak pernah dicetak).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const W = 32;
const ROOT = process.cwd();

// --- Argumen ----------------------------------------------------------------
const args = process.argv.slice(2);
const getOpt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const LIST = args.includes('--list');
const TX = getOpt('--tx');
const INDEX = getOpt('--index') !== undefined ? Number(getOpt('--index')) : undefined;
const OUT = getOpt('--out') ?? join(ROOT, 'STRUK-PEMBAYARAN.jpg');

// --- Env --------------------------------------------------------------------
const envRaw = readFileSync(join(ROOT, 'server', '.env'), 'utf8');
const env = {};
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const url = env.DATABASE_URL;
if (!url) {
  console.error('ERROR: DATABASE_URL tidak ada di server/.env');
  process.exit(1);
}

// --- Format (meniru receipt.js) --------------------------------------------
const W_METHOD = { cash: 'Tunai', card: 'Kartu', qr: 'QRIS', wallet: 'Wallet' };
const fit = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const center = (s) => {
  s = fit(s);
  if (s.length >= W) return s.slice(0, W);
  return ' '.repeat(Math.floor((W - s.length) / 2)) + s;
};
const col2 = (l, r) => {
  let left = fit(l);
  const right = fit(r);
  if (left.length + right.length + 1 > W) left = left.slice(0, Math.max(0, W - right.length - 1));
  const gap = Math.max(1, W - left.length - right.length);
  return left + ' '.repeat(gap) + right;
};
const rp = (sen) => 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(Number(sen ?? 0) / 100));
const fmtDate = (d) => {
  if (!d) return '-';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '-';
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(dt);
  const g = (t) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}`;
};
const statusLabel = (t, pay) => {
  if (t.status === 'voided') return 'DIBATALKAN';
  if (t.status === 'refunded' || pay?.status === 'refunded') return 'DIKEMBALIKAN';
  if (pay?.status === 'failed') return 'GAGAL';
  if (pay?.status === 'pending') return 'BELUM LUNAS';
  return 'LUNAS';
};
const col2r = (l, r) => { // kolom kanan terpotong agar tidak melewati kertas
  l = fit(l); r = fit(r);
  if (l.length + r.length + 1 > W) r = r.slice(0, Math.max(1, W - l.length - 1));
  const gap = Math.max(1, W - l.length - r.length);
  return l + ' '.repeat(gap) + r;
};

// --- DB ---------------------------------------------------------------------
const client = new pg.Client({
  connectionString: url,
  ssl: /neon\.tech|sslmode=require/.test(url) ? { rejectUnauthorized: false } : undefined,
});
await client.connect();

if (LIST || (INDEX !== undefined && !TX)) {
  const { rows } = await client.query(
    `SELECT t.id, t.invoice_no, t.status, t.total, t.created_at, o.name AS outlet,
            (SELECT count(*) FROM transaction_items i WHERE i.transaction_id = t.id)::int AS items,
            (SELECT count(*) FROM payments p WHERE p.transaction_id = t.id)::int AS pays
       FROM transactions t JOIN outlets o ON o.id = t.outlet_id
      ORDER BY t.created_at DESC LIMIT 20`
  );
  if (!rows.length) {
    console.log('Tidak ada transaksi di database.');
    await client.end();
    process.exit(0);
  }
  console.log('idx | invoice_no | status | outlet | total | item | bayar | waktu');
  rows.forEach((r, i) =>
    console.log(
      `${String(i).padStart(3)} | ${r.invoice_no} | ${r.status} | ${r.outlet} | ${r.total} | ${r.items} | ${r.pays} | ${fmtDate(r.created_at)}`
    )
  );
  if (!LIST) {
    const pick = rows[INDEX ?? 0];
    if (!pick) { console.error(`ERROR: indeks ${INDEX} tidak ada`); await client.end(); process.exit(1); }
    await render(pick.id);
  }
  await client.end();
} else {
  let id = TX;
  if (!id) {
    const { rows } = await client.query(
      `SELECT t.id FROM transactions t
        WHERE EXISTS (SELECT 1 FROM transaction_items i WHERE i.transaction_id = t.id)
          AND EXISTS (SELECT 1 FROM payments p WHERE p.transaction_id = t.id)
        ORDER BY (t.status = 'completed') DESC, t.created_at DESC
        LIMIT 1`
    );
    if (!rows.length) {
      console.error('ERROR: tidak ada transaksi berisi item & pembayaran.');
      await client.end();
      process.exit(1);
    }
    id = rows[0].id;
  }
  await render(id);
  await client.end();
}

// --- Bangun baris & render --------------------------------------------------
async function render(txId) {
  const { rows } = await client.query(
    `SELECT t.*, b.name AS business_name, o.name AS outlet_name, o.address AS outlet_address,
            o.phone AS outlet_phone, c.full_name AS cashier_name
       FROM transactions t
       JOIN outlets o ON o.id = t.outlet_id
       JOIN businesses b ON b.id = o.business_id
       LEFT JOIN cashiers c ON c.id = t.cashier_id
      WHERE t.id = $1`,
    [txId]
  );
  const t = rows[0];
  if (!t) { console.error(`ERROR: transaksi ${txId} tidak ditemukan`); process.exit(1); }

  const { rows: items } = await client.query(
    `SELECT product_name, qty, unit_price, line_total FROM transaction_items
      WHERE transaction_id = $1 ORDER BY created_at, id`,
    [txId]
  );
  const { rows: pays } = await client.query(
    `SELECT method, amount, status FROM payments WHERE transaction_id = $1 ORDER BY created_at LIMIT 1`,
    [txId]
  );
  const pay = pays[0];
  const method = pay?.method ?? 'cash';
  const isCash = method === 'cash';
  const status = statusLabel(t, pay);
  const isPaid = status === 'LUNAS';
  const totalQty = items.reduce((s, it) => s + Number(it.qty || 0), 0);

  const dash = '-'.repeat(W);
  const L = [];
  const push = (text, style = 'n') => L.push({ T: text, S: style });

  push(center(t.business_name), 'b');
  if (t.outlet_name) push(center(t.outlet_name));
  if (t.outlet_address) push(center(t.outlet_address));
  if (t.outlet_phone) push(center('Telp. ' + t.outlet_phone));
  push(dash, 'm');
  push(col2('No. Struk', t.invoice_no));
  push(col2('Tanggal', fmtDate(t.created_at)));
  if (t.cashier_name) push(col2('Kasir', t.cashier_name));
  push(dash, 'm');
  for (const it of items) {
    const qty = Number(it.qty);
    push(col2r(`${qty}x ${it.product_name}`, `Rp ${new Intl.NumberFormat('id-ID').format(Math.round(Number(it.line_total) / 100))}`));
    if (qty > 1) push('   @ ' + `Rp ${new Intl.NumberFormat('id-ID').format(Math.round(Number(it.unit_price) / 100))}`, 'm');
  }
  push(dash, 'm');
  push(col2('Total Produk', `${totalQty} item`));
  push(col2r('Subtotal', `Rp ${new Intl.NumberFormat('id-ID').format(Math.round(Number(t.subtotal) / 100))}`));
  if (Number(t.discount_total) !== 0)
    push(col2r('Diskon', '-' + `Rp ${new Intl.NumberFormat('id-ID').format(Math.round(Math.abs(Number(t.discount_total)) / 100))}`));
  if (Number(t.tax_total) !== 0 || Number(t.tax_rate) !== 0)
    push(col2r(`Pajak (${Number(t.tax_rate)}%)`, `Rp ${new Intl.NumberFormat('id-ID').format(Math.round(Number(t.tax_total) / 100))}`));
  push(col2r('TOTAL', `Rp ${new Intl.NumberFormat('id-ID').format(Math.round(Number(t.total) / 100))}`), 'b');
  push(dash, 'm');
  push(col2('Pembayaran', W_METHOD[method] ?? '-'));
  push(col2('Status', status), 'b');
  if (isCash && isPaid) push(col2r('Uang Diterima', `Rp ${new Intl.NumberFormat('id-ID').format(Math.round(Number(t.paid_amount) / 100))}`));
  if (isCash && isPaid) push(col2r('Kembalian', `Rp ${new Intl.NumberFormat('id-ID').format(Math.round(Number(t.change_amount) / 100))}`));
  push(dash, 'm');
  push(center('Terima kasih atas kunjungan Anda'));
  push(center('KASIR NOVA'), 'b');

  console.log(`Transaksi: ${t.invoice_no} (${t.status}, ${fmtDate(t.created_at)}) — ${items.length} item`);
  console.log('-' .repeat(W));
  for (const l of L) console.log(l.T);
  console.log('-'.repeat(W));

  const linesPath = join(tmpdir(), 'nova-struk-lines.txt');
  // Protokol sederhana: <style><teks> per baris (menghindari kuirk ConvertFrom-Json PS 5.1).
  writeFileSync(linesPath, L.map((l) => l.S + l.T).join('\n'), 'utf8');
  const ps1 = join(ROOT, 'scripts', 'generate-struk-jpg.ps1');
  const res = spawnSync(
    'powershell',
    ['-ExecutionPolicy', 'Bypass', '-File', ps1, '-LinesFile', linesPath, '-Out', resolve(OUT)],
    { stdio: 'inherit' }
  );
  process.exitCode = res.status ?? 1;
}
