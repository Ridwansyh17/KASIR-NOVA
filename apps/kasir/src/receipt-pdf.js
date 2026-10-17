/**
 * KASIR NOVA — STRUK PDF (struk digital panel Kasir).
 *
 * Tujuan (permintaan pemilik, 17 Okt 2026): setelah pembayaran dikonfirmasi,
 * struk LANGSUNG tersedia sebagai berkas PDF sehingga kasir dapat
 * **menyimpan**, **mengirim (share)**, atau **mencetak** struk TANPA harus
 * menyambungkan printer thermal terlebih dahulu.
 *
 * Modul ini MURNI: tanpa DOM, tanpa jaringan, dan tanpa impor relatif sehingga
 * dapat diuji di Node lewat data: URL (pola `escpos.js`/`receipt.js`).
 *
 * Penulis PDF minimal TANPA pustaka pihak ketiga:
 *   - Halaman berukuran 58 mm / 80 mm (lebar kertas thermal) dengan tinggi
 *     mengikuti isi, dipotong menjadi beberapa halaman bila sangat panjang.
 *   - Font Courier / Courier-Bold (base-14, tidak perlu disematkan sehingga
 *     berkas kecil dan dapat dibuka di mana saja).
 *   - Teks dibatasi ASCII (karakter lain menjadi '?') agar aman di semua
 *     penampil PDF — sama seperti perilaku printer thermal di `escpos.js`.
 *   - Susunan baris sengaja SAMA dengan `escpos.js` (No. Struk, item, TOTAL,
 *     pembayaran, footer) supaya struk PDF dan struk thermal tidak berbeda isi.
 *
 * Catatan penyimpangan: logo outlet TIDAK disematkan ke PDF (butuh penyemat
 * gambar) — nama bisnis/outlet tetap tercetak sebagai teks.
 */

const MM_TO_PT = 72 / 25.4;

/** Jumlah kolom karakter per lebar kertas (mm) — sama dengan `escpos.js`. */
export const PAPER_COLUMNS = { 58: 32, 80: 48 };

/** Kolom default 58mm bila lebar tak dikenal. */
export const columnsFor = (width) => PAPER_COLUMNS[String(width)] ?? PAPER_COLUMNS['58'];

/** Lebar halaman PDF (pt) untuk lebar kertas 58/80 mm. */
export const pageWidthPt = (width) => {
  const mm = String(width) === '80' ? 80 : 58;
  return Math.round(mm * MM_TO_PT * 100) / 100;
};

/** Tata letak teks PDF. */
export const FONT_SIZE = 7.5;
export const LEADING = 9;
export const MARGIN = 4;
/** Tinggi halaman maksimum (pt) ≈ 40 cm; lebih dari ini dipecah ke halaman baru. */
export const MAX_PAGE_HEIGHT = 1150;
/** Courier: lebar karakter = 0,6 × ukuran font. */
export const MONO_RATIO = 0.6;

/** Nilai SEN (dari server) -> "Rp 31.000" (dibagi 100). */
export const fmtIDR = (sen) => `Rp ${(Number(sen ?? 0) / 100).toLocaleString('id-ID')}`;

/** Tanggal/waktu lokal ringkas; "—" bila kosong/tak valid. */
export const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('id-ID');
};

export const METHOD_LABELS = { cash: 'Tunai', card: 'Kartu', qr: 'QRIS', wallet: 'E-Wallet' };

export const DRAFT_STATUS = 'draft';
export const DRAFT_LABEL = 'BELUM DIBAYAR';
export const REPRINT_LABEL = 'CETAK ULANG';

/**
 * Status pembayaran AKTUAL (tidak mengarang "LUNAS"). Logika ini identik dengan
 * `receipt.js`/`escpos.js`; kesamaannya dijaga oleh tes.
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

/** Teks -> ASCII (di luar 32..126 menjadi '?'), sama seperti printer thermal. */
export const toAscii = (value) => {
  let out = '';
  for (const ch of String(value ?? '')) {
    const cp = ch.codePointAt(0);
    out += cp >= 32 && cp <= 126 ? ch : '?';
  }
  return out;
};

/** Bungkus teks menjadi beberapa baris selebar `width` karakter. */
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

/** Baris dua kolom (kiri rata kiri, kanan rata kanan) — sama dengan escpos.js. */
export const twoColumn = (left, right, width) => {
  const l = String(left ?? '');
  const r = String(right ?? '');
  if (!r) return wrap(l, width);
  // Nilai kanan yang panjang (mis. UUID transaksi) tidak muat berdampingan:
  // cetak label lalu nilainya pada baris sendiri agar TIDAK melewati halaman.
  if (width - r.length - 1 < 8) return [...wrap(l, width), ...wrap(r, width)];
  const leftWidth = Math.max(8, width - r.length - 1);
  const lines = wrap(l, leftWidth);
  return lines.map((ln, i) => {
    if (i !== 0) return ln;
    const pad = Math.max(1, width - ln.length - r.length);
    return ln + ' '.repeat(pad) + r;
  });
};

/**
 * Susun dokumen struk sebagai daftar baris ber-atribut
 * (`{ text, bold, center }`) — sumber tunggal untuk PDF & daftar baris polos.
 *
 * @param {object} p
 * @param {object} p.transaction detail transaksi (items, payments, total, ...).
 * @param {object} [p.context] konteks outlet/bisnis dari `/me`.
 * @param {string} [p.cashier] nama kasir.
 * @param {'58'|'80'|number} [p.width] lebar kertas (mm). Default '58'.
 * @param {boolean} [p.reprint] tandai struk sebagai CETAK ULANG.
 * @returns {Array<{text: string, bold: boolean, center: boolean}>}
 */
export const buildStrukDoc = ({
  transaction: t = {},
  context = {},
  cashier = '',
  width = '58',
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

  const doc = [];
  const plain = (text, { bold = false, center = false } = {}) =>
    doc.push({ text: String(text ?? ''), bold, center });
  // Baris terpusat tetap dibungkus agar tidak melebihi lebar kertas.
  const center = (text, { bold = false } = {}) => {
    for (const ln of wrap(toAscii(text), cols)) plain(ln, { bold, center: true });
  };
  const divider = () => plain('-'.repeat(cols));
  const row = (l, r, { bold = false } = {}) => {
    for (const ln of twoColumn(toAscii(l), toAscii(r), cols)) plain(ln, { bold });
  };

  // --- Penanda cetak ulang ------------------------------------------------
  if (reprint) center(`*** ${REPRINT_LABEL} ***`, { bold: true });

  // --- Kop toko (terpusat) ------------------------------------------------
  center(toAscii(business.name ?? 'KASIR NOVA'), { bold: true });
  if (outlet.name) center(toAscii(outlet.name));
  if (outlet.address) center(toAscii(outlet.address));
  if (outlet.phone) center(toAscii(`Telp. ${outlet.phone}`));
  divider();

  // --- Penanda pratinjau (tidak pernah "LUNAS") ---------------------------
  if (isDraft) center(DRAFT_LABEL, { bold: true });

  // --- Info transaksi -----------------------------------------------------
  row('No. Struk', t.invoice_no ?? '');
  row('Tanggal', fmtDate(t.created_at));
  row('ID Transaksi', t.id ?? '');
  if (cashierName) row('Kasir', cashierName);
  if (customer) row('Pelanggan', customer);
  divider();

  // --- Daftar item --------------------------------------------------------
  for (const it of t.items ?? []) {
    const qty = Number(it.qty ?? 0);
    const unit = Number(it.unit_price ?? 0);
    const lineTotal = Number(it.line_total ?? 0);
    row(`${qty}x ${it.product_name ?? ''}`, fmtIDR(lineTotal));
    if (qty > 1) plain(`   @ ${fmtIDR(unit)}`);
    const note = it.note || it.variant_name;
    if (note) plain(`   ${toAscii(note)}`);
  }
  divider();

  // --- Ringkasan ----------------------------------------------------------
  row('Total Produk', `${totalQty} item`);
  row('Subtotal', fmtIDR(t.subtotal));
  if (discount !== 0) row('Diskon', `-${fmtIDR(Math.abs(discount))}`);
  if (tax !== 0 || taxRate !== 0) row(`Pajak (${taxRate}%)`, fmtIDR(tax));
  row('TOTAL', fmtIDR(t.total), { bold: true });
  divider();

  // --- Pembayaran ---------------------------------------------------------
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

  // --- Footer -------------------------------------------------------------
  center('Terima kasih atas kunjungan Anda');
  center('KASIR NOVA', { bold: true });

  return doc;
};

/** Daftar baris struk TANPA atribut (untuk pemeriksaan/uji). */
export const buildStrukLines = (opts) => buildStrukDoc(opts).map((ln) => ln.text);

// --- Penulis PDF minimal ----------------------------------------------------
const round2 = (n) => Math.round(n * 100) / 100;

const pad2 = (n) => String(n).padStart(2, '0');

/** Escape teks untuk literal string PDF. */
const pdfEscape = (text) => toAscii(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** Isi halaman (content stream) dari daftar baris. */
const pageStream = ({ lines, pageWidth, pageHeight }) => {
  const parts = ['BT'];
  let y = pageHeight - MARGIN - FONT_SIZE;
  for (const ln of lines) {
    const font = ln.bold ? '/F2' : '/F1';
    const textWidth = ln.text.length * FONT_SIZE * MONO_RATIO;
    const x = ln.center ? Math.max(MARGIN, (pageWidth - textWidth) / 2) : MARGIN;
    parts.push(`${font} ${FONT_SIZE} Tf`, `1 0 0 1 ${round2(x)} ${round2(y)} Tm`, `(${pdfEscape(ln.text)}) Tj`);
    y -= LEADING;
  }
  parts.push('ET');
  return parts.join('\n');
};

/** Rangkai berkas PDF (latin1) dari halaman-halaman yang sudah dihitung. */
const assemblePdf = ({ pages, width }) => {
  const objects = [];
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  // Objek tiap halaman: isi = 5+2i, Halaman = 6+2i. Pohon halaman (/Kids) HARUS
  // menunjuk ke objek Halaman (6+2i) — bukan ke stream isinya.
  const pageIds = pages.map((_, i) => 6 + i * 2);
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>';
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>';

  pages.forEach((page, i) => {
    const contentId = 5 + i * 2;
    const pageId = contentId + 1;
    const stream = pageStream({ lines: page.lines, pageWidth: width, pageHeight: page.height });
    objects[contentId - 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    objects[pageId - 1] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${round2(width)} ${round2(page.height)}]` +
      ` /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
  });

  let file = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets[i] = file.length;
    file += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const startxref = file.length;
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) file += `${String(off).padStart(10, '0')} 00000 n \n`;
  file +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${startxref}\n%%EOF\n`;
  return latin1Bytes(file);
};

/** String (tiap karakter 0..255) -> Uint8Array. */
const latin1Bytes = (text) => {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
};

/**
 * Bangun berkas STRUK PDF dari transaksi.
 *
 * @param {object} p sama dengan `buildStrukDoc`.
 * @returns {Uint8Array} berkas PDF siap diunduh/dibagikan/dicetak.
 */
export const buildStrukPdf = ({ width = '58', ...rest } = {}) => {
  const doc = buildStrukDoc({ width, ...rest });
  const pageWidth = pageWidthPt(width);
  const maxLines = Math.max(1, Math.floor((MAX_PAGE_HEIGHT - 2 * MARGIN - FONT_SIZE) / LEADING));

  const chunks = [];
  for (let i = 0; i < doc.length; i += maxLines) chunks.push(doc.slice(i, i + maxLines));
  if (!chunks.length) chunks.push([]);

  const single = chunks.length === 1;
  const pages = chunks.map((lines) => ({
    lines,
    height: single
      ? Math.max(100, 2 * MARGIN + FONT_SIZE + lines.length * LEADING)
      : MAX_PAGE_HEIGHT,
  }));
  return assemblePdf({ pages, width: pageWidth });
};

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Uint8Array -> base64 (untuk jembatan Capacitor / tautan data). */
export const bytesToBase64 = (bytes) => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    const n = (b0 << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += b1 === undefined ? '=' : B64[(n >> 6) & 63];
    out += b2 === undefined ? '=' : B64[n & 63];
  }
  return out;
};

/** Nama berkas aman dari nomor struk: "Struk-INV-0001.pdf". */
export const strukPdfFileName = (transaction = {}) => {
  const raw = String(transaction.invoice_no || transaction.id || 'kasir');
  const safe = raw.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'kasir';
  return `Struk-${safe}.pdf`;
};

export default {
  PAPER_COLUMNS,
  columnsFor,
  pageWidthPt,
  FONT_SIZE,
  LEADING,
  MARGIN,
  MAX_PAGE_HEIGHT,
  fmtIDR,
  fmtDate,
  METHOD_LABELS,
  DRAFT_STATUS,
  DRAFT_LABEL,
  REPRINT_LABEL,
  paymentStatusLabel,
  toAscii,
  twoColumn,
  buildStrukDoc,
  buildStrukLines,
  buildStrukPdf,
  bytesToBase64,
  strukPdfFileName,
};
