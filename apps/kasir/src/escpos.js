/**
 * KASIR NOVA — Pembentuk perintah ESC/POS (byte) untuk printer thermal.
 *
 * Modul ini MURNI: tanpa DOM, tanpa impor relatif, sehingga bisa diuji di Node
 * (di-load lewat data: URL, mengikuti pola `receipt-struk.test.js`) maupun
 * dijalankan langsung di WebView Capacitor tanpa bundler.
 *
 * Tanggung jawab: mengubah data transaksi aktual menjadi deretan byte ESC/POS
 * yang dikirim ke printer Bluetooth (Classic SPP maupun BLE). Perhitungan
 * total/pajak tetap milik server — di sini hanya menampilkan.
 *
 * Catatan kompatibilitas:
 *   - Lebar kolom: kertas 58mm ≈ 32 karakter, 80mm = 48 karakter (font A).
 *   - Teks dibatasi ASCII (printer generik default CP437); karakter non-ASCII
 *     diganti '?' agar tidak tampil sebagai sampah.
 *   - Perintah yang dipakai hanya perintah ESC/POS dasar yang hampir selalu ada:
 *     ESC @ (init), ESC a (align), ESC E (bold), GS ! (ukuran), GS V (potong).
 */

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/** Jumlah kolom karakter per lebar kertas (mm). */
export const PAPER_COLUMNS = { 58: 32, 80: 48 };

/** Kolom default 58mm bila lebar tak dikenal. */
export const columnsFor = (width) => PAPER_COLUMNS[String(width)] ?? PAPER_COLUMNS['58'];

/** Nilai SEN (dari server) -> "Rp 31.000" (dibagi 100). Sama dengan receipt.js. */
export const fmtIDR = (sen) => `Rp ${(Number(sen ?? 0) / 100).toLocaleString('id-ID')}`;

/** Tanggal/waktu lokal ringkas; "—" bila kosong/tak valid. */
export const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('id-ID');
};

export const METHOD_LABELS = { cash: 'Tunai', card: 'Kartu', qr: 'QRIS', wallet: 'E-Wallet' };

/** Status pratinjau (draft) — dipakai bersama `receipt.js`/`sale-flow.js`. */
export const DRAFT_STATUS = 'draft';
export const DRAFT_LABEL = 'BELUM DIBAYAR';
export const REPRINT_LABEL = 'CETAK ULANG';

/**
 * Status pembayaran AKTUAL (tidak mengarang "LUNAS"). Logika ini identik
 * dengan `receipt.js`; kesamaan dijaga oleh tes (`printer-escpos.test.js`).
 */
export const paymentStatusLabel = (t = {}) => {
  const pay = t.payments?.[0]?.status;
  if (t.status === DRAFT_STATUS) return DRAFT_LABEL;
  if (t.status === 'voided') return 'DIBATALKAN';
  if (t.status === 'refunded' || pay === 'refunded') return 'DIKEMBALIKAN';
  if (pay === 'failed') return 'GAGAL';
  if (pay === 'pending') return 'BELUM LUNAS';
  return 'LUNAS';
};

/** Ubah teks -> byte ASCII; karakter di luar 32..126 (mis. unicode) -> '?'. */
const ascii = (s) => {
  const out = [];
  for (const ch of String(s ?? '')) {
    const cp = ch.codePointAt(0);
    out.push(cp >= 32 && cp <= 126 ? cp : 0x3f);
  }
  return out;
};

/**
 * Bungkus teks ke beberapa baris selebar `width` karakter (per kata, memecah
 * kata yang lebih panjang dari `width`).
 */
const wrap = (text, width) => {
  const words = String(text ?? '')
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (!words.length) return [''];
  const lines = [];
  let cur = '';
  for (let w of words) {
    while (w.length > width) {
      if (cur) {
        lines.push(cur);
        cur = '';
      }
      lines.push(w.slice(0, width));
      w = w.slice(width);
    }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= width) cur += ` ${w}`;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
};

/**
 * Baris dua kolom (kiri rata kiri, kanan rata kanan). Bila kolom kiri terlalu
 * panjang, ia dibungkus; nilai kanan tetap menempel pada baris pertama.
 * @returns {string[]} daftar baris siap cetak.
 */
export const twoColumn = (left, right, width) => {
  const l = String(left ?? '');
  const r = String(right ?? '');
  if (!r) return wrap(l, width);
  const leftWidth = Math.max(8, width - r.length - 1);
  const lines = wrap(l, leftWidth);
  return lines.map((ln, i) => {
    if (i !== 0) return ln;
    const pad = Math.max(1, width - ln.length - r.length);
    return ln + ' '.repeat(pad) + r;
  });
};

// --- Perintah ESC/POS -------------------------------------------------------
const CMD = {
  init: () => [0x1b, 0x40],
  align: (a) => [0x1b, 0x61, a === 'center' ? 1 : a === 'right' ? 2 : 0],
  bold: (on) => [0x1b, 0x45, on ? 1 : 0],
  // GS ! n : n bit0 = tinggi ganda, bit4 = lebar ganda.
  size: (doubleWidth, doubleHeight) => [0x1d, 0x21, (doubleWidth ? 0x10 : 0) | (doubleHeight ? 0x01 : 0)],
  // GS V 0 : potong penuh. Didahului umpan beberapa baris agar potongan rapi.
  cut: () => [0x1d, 0x56, 0x00],
};

/**
 * Bangun sekumpulan byte ESC/POS untuk satu struk dari transaksi AKTUAL.
 *
 * @param {object} p
 * @param {object} p.transaction detail transaksi (items, payments, total, ...).
 * @param {object} [p.context] konteks outlet/bisnis dari /me.
 * @param {string} [p.cashier] nama kasir.
 * @param {'58'|'80'|number} [p.width] lebar kertas (mm). Default '58'.
 * @param {boolean} [p.cut] kirim perintah potong kertas. Default true.
 * @param {boolean} [p.reprint] tandai struk sebagai CETAK ULANG (FASE 3).
 * @returns {Uint8Array} byte ESC/POS siap dikirim ke printer.
 */
export const buildStrukEscPos = ({
  transaction: t = {},
  context = {},
  cashier = '',
  width = '58',
  cut = true,
  reprint = false,
} = {}) => {
  const cols = columnsFor(width);
  const payment = t.payments?.[0];
  const method = payment?.method ?? 'cash';
  const methodLabel = METHOD_LABELS[method] ?? '-';
  const status = paymentStatusLabel(t);
  const isCash = method === 'cash';
  const isPaid = status === 'LUNAS';
  const isDraft = status === DRAFT_LABEL;

  const business = context?.business ?? {};
  const outlet = context?.outlet ?? {};
  const cashierName = cashier || t.cashier_name || '';

  const paid = Number(t.paid_amount ?? 0);
  const change = Number(t.change_amount ?? 0);
  const discount = Number(t.discount_total ?? 0);
  const tax = Number(t.tax_total ?? 0);
  const taxRate = Number(t.tax_rate ?? 0);
  const totalQty = (t.items ?? []).reduce((s, it) => s + Number(it.qty || 0), 0);
  const customer = [t.customer_name, t.customer_phone, t.customer_code].filter(Boolean).join(' · ');

  const bytes = [];
  const put = (arr) => {
    for (const b of arr) bytes.push(b & 0xff);
  };
  const line = (s = '') => {
    put(ascii(s));
    bytes.push(0x0a);
  };
  const divider = () => line('-'.repeat(cols));
  const row = (l, r) => {
    for (const ln of twoColumn(l, r, cols)) line(ln);
  };

  put(CMD.init());

  // --- Penanda cetak ulang (FASE 3) ---------------------------------------
  if (reprint) {
    put(CMD.align('center'));
    put(CMD.bold(true));
    line(`*** ${REPRINT_LABEL} ***`);
    put(CMD.bold(false));
    put(CMD.align('left'));
  }

  // --- Header toko (terpusat, nama ditebalkan & tinggi ganda) --------------
  put(CMD.align('center'));
  put(CMD.bold(true));
  put(CMD.size(false, true));
  line(business.name ?? 'KASIR NOVA');
  put(CMD.size(false, false));
  put(CMD.bold(false));
  if (outlet.name) line(outlet.name);
  if (outlet.address) line(outlet.address);
  if (outlet.phone) line(`Telp. ${outlet.phone}`);
  put(CMD.align('left'));
  divider();

  // --- Penanda pratinjau (tidak pernah dicetak sebagai LUNAS) -------------
  if (isDraft) {
    put(CMD.align('center'));
    put(CMD.bold(true));
    line(DRAFT_LABEL);
    put(CMD.bold(false));
    put(CMD.align('left'));
  }

  // --- Info transaksi ------------------------------------------------------
  row('No. Struk', t.invoice_no ?? '');
  row('Tanggal', fmtDate(t.created_at));
  row('ID Transaksi', t.id ?? '');
  if (cashierName) row('Kasir', cashierName);
  if (customer) row('Pelanggan', customer);
  divider();

  // --- Daftar item ---------------------------------------------------------
  for (const it of t.items ?? []) {
    const qty = Number(it.qty ?? 0);
    const unit = Number(it.unit_price ?? 0);
    const lineTotal = Number(it.line_total ?? 0);
    row(`${qty}x ${it.product_name ?? ''}`, fmtIDR(lineTotal));
    if (qty > 1) line(`   @ ${fmtIDR(unit)}`);
    const note = it.note || it.variant_name;
    if (note) line(`   ${note}`);
  }
  divider();

  // --- Ringkasan -----------------------------------------------------------
  row('Total Produk', `${totalQty} item`);
  row('Subtotal', fmtIDR(t.subtotal));
  if (discount !== 0) row('Diskon', `-${fmtIDR(Math.abs(discount))}`);
  if (tax !== 0 || taxRate !== 0) row(`Pajak (${taxRate}%)`, fmtIDR(tax));
  put(CMD.bold(true));
  put(CMD.size(false, true));
  row('TOTAL', fmtIDR(t.total));
  put(CMD.size(false, false));
  put(CMD.bold(false));
  divider();

  // --- Pembayaran (uang diterima & kembalian hanya untuk tunai LUNAS) ------
  row('Pembayaran', methodLabel);
  row('Status', status);
  if (isCash && isPaid) {
    row('Uang Diterima', fmtIDR(paid));
    row('Kembalian', fmtIDR(change));
  }
  if (isCash && isDraft) {
    row('Rencana Bayar', fmtIDR(paid));
    row('Kembalian', fmtIDR(change));
  }
  divider();

  // --- Footer --------------------------------------------------------------
  put(CMD.align('center'));
  line('Terima kasih atas kunjungan Anda');
  put(CMD.bold(true));
  line('KASIR NOVA');
  put(CMD.bold(false));
  put(CMD.align('left'));

  // Umpan kertas sebelum potong.
  line();
  line();
  if (cut) put(CMD.cut());

  return Uint8Array.from(bytes);
};

/**
 * Halaman UJI CETAK sederhana (bukan struk transaksi) untuk memverifikasi
 * printer tersambung & mencetak. Tidak menyatakan status pembayaran apa pun.
 */
export const buildTestEscPos = ({ width = '58', context = {}, now = new Date() } = {}) => {
  const cols = columnsFor(width);
  const business = context?.business ?? {};
  const outlet = context?.outlet ?? {};
  const bytes = [];
  const put = (arr) => {
    for (const b of arr) bytes.push(b & 0xff);
  };
  const line = (s = '') => {
    put(ascii(s));
    bytes.push(0x0a);
  };

  put(CMD.init());
  put(CMD.align('center'));
  put(CMD.bold(true));
  put(CMD.size(false, true));
  line('UJI CETAK PRINTER');
  put(CMD.size(false, false));
  put(CMD.bold(false));
  line(business.name ?? 'KASIR NOVA');
  if (outlet.name) line(outlet.name);
  put(CMD.align('left'));
  line('-'.repeat(cols));
  for (const ln of wrap(
    'Cetak thermal KASIR NOVA berfungsi. Jika Anda membaca ini, printer tersambung dengan baik.',
    cols
  )) {
    line(ln);
  }
  line('-'.repeat(cols));
  put(CMD.align('center'));
  line(fmtDate(now.toISOString()));
  put(CMD.align('left'));
  line();
  line();
  put(CMD.cut());

  return Uint8Array.from(bytes);
};

export default {
  PAPER_COLUMNS,
  columnsFor,
  fmtIDR,
  fmtDate,
  METHOD_LABELS,
  DRAFT_STATUS,
  DRAFT_LABEL,
  REPRINT_LABEL,
  paymentStatusLabel,
  twoColumn,
  buildStrukEscPos,
  buildTestEscPos,
};
