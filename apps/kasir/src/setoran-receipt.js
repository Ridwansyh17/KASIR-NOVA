/**
 * KASIR NOVA — BUKTI SETORAN KASIR (layar, cetak, PDF, ESC/POS).
 *
 * Modul MURNI (tanpa DOM/jaringan) yang menyusun dokumen bukti setoran dari
 * data setoran hasil server. Susunan mengikuti referensi
 * `assets/references/Contoh_Struk_Setoran_KASIR_NOVA.png`:
 *
 *   KASIR NOVA / BUKTI SETORAN KASIR / outlet
 *   No. Setoran, Tanggal, Kasir, Shift, Status
 *   RINCIAN PENDAPATAN (tunai, QRIS, total)
 *   RINCIAN PENGELUARAN (item, total, pengeluaran kas/non-tunai)
 *   PERHITUNGAN SETORAN (tunai - pengeluaran kas = wajib)
 *   TUNAI AKTUAL, SELISIH, KEKURANGAN KAS, catatan, tanda tangan
 *   footer + waktu cetak
 *
 * Satu sumber dokumen dipakai untuk semua keluaran:
 *   - `buildSetoranHtml`  -> pratinjau layar & dialog cetak peramban,
 *   - `buildSetoranPdf`   -> berkas PDF (lewat `receipt-pdf.js`),
 *   - `buildSetoranEscPos`-> byte printer thermal 58/80mm (bantuan `escpos.js`).
 *
 * Nominal dari server SELALU dalam SEN; pembagian 100 hanya untuk tampilan.
 */

import { columnsFor, twoColumn } from './escpos.js';
import { buildPdfFromDoc, fmtIDR } from './receipt-pdf.js';

export const STATUS_LABELS = {
  draft: 'DRAFT',
  completed: 'SELESAI',
  recorded: 'SELESAI',
  voided: 'DIBATALKAN',
};

export const SHIFT_LABELS = {
  full: 'Sehari (00:00 - 24:00)',
  pagi: 'Pagi (08:00 - 15:00)',
  sore: 'Sore (15:00 - 21:00)',
  malam: 'Malam (21:00 - 08:00)',
};

export const EXPENSE_CATEGORY_LABELS = {
  operational: 'Operasional',
  utilities: 'Utilitas',
  supplies: 'Perlengkapan',
  transport: 'Transport',
  maintenance: 'Pemeliharaan',
  inventory_purchase: 'Beli Persediaan',
  other: 'Lain-lain',
};

export const REPRINT_LABEL = 'CETAK ULANG';
export const VOID_LABEL = 'DIBATALKAN';

const num = (value) => Number(value ?? 0);

const pad2 = (value) => String(value).padStart(2, '0');

/** Tanggal (DATE/ISO) -> "DD/MM/YYYY". */
export const fmtDayDMY = (value) => {
  if (!value) return '—';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const [y, m, d] = value.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
};

/** Waktu lokal -> "HH:MM"; "—" bila kosong/tak valid. */
export const fmtClock = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
};

/** Stempel waktu ringkas "DD/MM/YYYY HH:MM". */
export const fmtStamp = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fmtDayDMY(value);
  return `${fmtDayDMY(date)} ${fmtClock(date)}`;
};

const statusOf = (deposit = {}) => STATUS_LABELS[deposit.status] ?? String(deposit.status ?? '—').toUpperCase();

const expenseLabel = (expense = {}) =>
  String(expense.note || EXPENSE_CATEGORY_LABELS[expense.category] || expense.category || 'Pengeluaran');

const totalsOf = (deposit = {}, totals = {}) => {
  const source = totals && Object.keys(totals).length ? totals : deposit;
  return {
    cashRevenue: num(source.cash_revenue ?? deposit.cash_revenue),
    qrisRevenue: num(source.qris_revenue ?? deposit.qris_revenue),
    otherRevenue: num(source.other_revenue ?? deposit.other_revenue),
    totalRevenue: num(source.total_revenue ?? deposit.total_revenue),
    totalExpense: num(source.total_expense ?? deposit.total_expense),
    cashExpense: num(source.cash_expense ?? deposit.cash_expense),
    noncashExpense: num(source.noncash_expense ?? deposit.noncash_expense),
    requiredCash: num(source.required_cash ?? deposit.required_cash),
    actualCash:
      source.actual_cash === null || source.actual_cash === undefined
        ? deposit.actual_cash === null || deposit.actual_cash === undefined
          ? null
          : num(deposit.actual_cash)
        : num(source.actual_cash),
    difference:
      source.difference === null || source.difference === undefined
        ? deposit.difference === null || deposit.difference === undefined
          ? null
          : num(deposit.difference)
        : num(source.difference),
    shortfall: num(source.shortfall ?? deposit.shortfall),
  };
};

const money = (value) => (value === null || value === undefined ? '—' : fmtIDR(value));

/**
 * Susun dokumen bukti setoran sebagai daftar baris ber-atribut.
 *
 * @param {object} p
 * @param {object} p.deposit data setoran (item daftar / detail).
 * @param {object} [p.business] nama bisnis (fallback: snapshot/konteks).
 * @param {object} [p.outlet] nama outlet (fallback: snapshot/konteks).
 * @param {string} [p.cashierName] nama kasir.
 * @param {object} [p.totals] totals pratinjau (opsional; default dari deposit).
 * @param {Array<object>} [p.transactions] transaksi snapshot.
 * @param {Array<object>} [p.expenses] pengeluaran snapshot.
 * @param {'58'|'80'|number} [p.width] lebar kertas (mm). Default '58'.
 * @param {boolean} [p.reprint] tandai CETAK ULANG.
 * @param {Date|string} [p.printedAt] waktu cetak (default sekarang).
 * @returns {Array<{text: string, bold: boolean, center: boolean}>}
 */
export const buildSetoranDoc = ({
  deposit = {},
  business = {},
  outlet = {},
  cashierName = '',
  totals,
  transactions = [],
  expenses = [],
  width = '58',
  reprint = false,
  printedAt = new Date(),
} = {}) => {
  const cols = columnsFor(width);
  const snapshot = deposit.snapshot ?? {};
  const biz = business?.name ? business : snapshot.business ?? business ?? {};
  const out = outlet?.name ? outlet : snapshot.outlet ?? outlet ?? {};
  const t = totalsOf(deposit, totals);
  const status = statusOf(deposit);
  const isVoid = deposit.status === 'voided';
  const cashier = cashierName || snapshot.cashier?.name || deposit.officer_name || '';
  const recipient = deposit.recipient_name || snapshot.recipient_name || '';
  const note = deposit.cashier_note || deposit.note || snapshot.note || '';
  const shiftLabel = deposit.shift_label || snapshot.period?.shift_label || SHIFT_LABELS[snapshot.period?.shift] || '—';
  const periodStart = deposit.period_start || snapshot.period?.start;
  const periodEnd = deposit.period_end || snapshot.period?.end;
  const receiptDate = `${fmtDayDMY(deposit.deposited_on || snapshot.period?.date)} ${fmtClock(
    deposit.completed_at || deposit.created_at
  )}`;

  const doc = [];
  const plain = (text, { bold = false, center = false } = {}) =>
    doc.push({ text: String(text ?? ''), bold, center });
  const center = (text, { bold = false } = {}) => plain(text, { bold, center: true });
  const divider = () => plain('-'.repeat(cols));
  const strongDivider = () => plain('='.repeat(cols));
  const row = (left, right, { bold = false } = {}) => {
    for (const line of twoColumn(String(left ?? ''), String(right ?? ''), cols)) plain(line, { bold });
  };

  if (reprint) center(`*** ${REPRINT_LABEL} ***`, { bold: true });
  if (isVoid) center(`*** ${VOID_LABEL} ***`, { bold: true });

  center(biz.name || 'KASIR NOVA', { bold: true });
  center('BUKTI SETORAN KASIR', { bold: true });
  if (out.name) center(out.name);
  divider();

  row('No. Setoran', deposit.settlement_no || '—');
  row('Tanggal', receiptDate);
  if (cashier) row('Kasir', cashier);
  row('Shift', shiftLabel);
  row('Status', status, { bold: true });
  if (periodStart && periodEnd) {
    row('Periode', `${fmtStamp(periodStart)} - ${fmtClock(periodEnd)}`);
  }
  if (isVoid && deposit.void_reason) row('Alasan void', deposit.void_reason);
  divider();

  center('RINCIAN PENDAPATAN', { bold: true });
  row('Pendapatan Tunai', fmtIDR(t.cashRevenue));
  row('Pendapatan QRIS', fmtIDR(t.qrisRevenue));
  if (t.otherRevenue !== 0) row('Pendapatan Lain', fmtIDR(t.otherRevenue));
  row('Total Pendapatan', fmtIDR(t.totalRevenue), { bold: true });
  divider();

  center('RINCIAN PENGELUARAN', { bold: true });
  if (expenses.length) {
    for (const expense of expenses) row(expenseLabel(expense), fmtIDR(expense.amount));
  }
  row('Total Pengeluaran', fmtIDR(t.totalExpense), { bold: true });
  row('Pengeluaran dari Kas', fmtIDR(t.cashExpense));
  if (t.noncashExpense !== 0) row('Pengeluaran Non-tunai', fmtIDR(t.noncashExpense));
  divider();

  center('PERHITUNGAN SETORAN', { bold: true });
  row('Pendapatan Tunai', fmtIDR(t.cashRevenue));
  row('Pengeluaran dari Kas', t.cashExpense ? `-${fmtIDR(t.cashExpense)}` : fmtIDR(0));
  strongDivider();
  center('TOTAL SETORAN TUNAI WAJIB', { bold: true });
  center(fmtIDR(t.requiredCash), { bold: true });
  strongDivider();

  row('Uang Tunai Aktual', money(t.actualCash), { bold: true });
  row('Selisih Setoran', money(t.difference), { bold: true });
  if (t.difference !== null && t.difference > 0) row('Kelebihan Kas', fmtIDR(t.difference));
  if (t.shortfall > 0) row('KEKURANGAN KAS', fmtIDR(t.shortfall), { bold: true });

  divider();
  row('Catatan', note || '—');
  if (deposit.settlement_no && transactions.length) row('Jumlah Transaksi', String(transactions.length));
  plain('');
  row('Disetorkan oleh', 'Diterima oleh');
  plain('');
  plain('');
  row(`( ${cashier || '................'} )`, `( ${recipient || '................'} )`);
  divider();
  center('Dicetak melalui KASIR NOVA');
  center(`Dicetak: ${fmtStamp(printedAt)}`);
  if (isVoid) center(VOID_LABEL, { bold: true });

  return doc;
};

/** Baris polos (untuk pemeriksaan/uji). */
export const buildSetoranLines = (options) => buildSetoranDoc(options).map((line) => line.text);

const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
  );

/**
 * HTML pratinjau/cetak. Memakai baris monospace agar kolom Rupiah rata seperti
 * struk thermal (lebar 58/80mm).
 */
export const buildSetoranHtml = (options = {}) => {
  const doc = buildSetoranDoc(options);
  const lines = doc
    .map((line) => {
      const classes = ['setoran-line'];
      if (line.bold) classes.push('bold');
      if (line.center) classes.push('center');
      return `<div class="${classes.join(' ')}">${escapeHtml(line.text) || '&nbsp;'}</div>`;
    })
    .join('');
  return `<div class="setoran-receipt" data-width="${String(options.width) === '80' ? '80' : '58'}">${lines}</div>`;
};

/** Berkas PDF bukti setoran (58/80mm). */
export const buildSetoranPdf = (options = {}) => {
  const width = options.width ?? '58';
  return buildPdfFromDoc({ doc: buildSetoranDoc({ ...options, width }), width });
};

const ESC = 0x1b;
const GS = 0x1d;

const asciiBytes = (text) => {
  const out = [];
  for (const char of String(text ?? '')) {
    const code = char.codePointAt(0);
    out.push(code >= 32 && code <= 126 ? code : 0x3f);
  }
  return out;
};

/**
 * Byte ESC/POS bukti setoran. Lebar kolom mengikuti `escpos.js`.
 * @returns {Uint8Array}
 */
export const buildSetoranEscPos = (options = {}) => {
  const { cut = true, width = '58' } = options;
  const doc = buildSetoranDoc({ ...options, width });
  const bytes = [];
  const put = (values) => {
    for (const value of values) bytes.push(value & 0xff);
  };
  const line = (text = '') => {
    put(asciiBytes(text));
    bytes.push(0x0a);
  };
  const align = (position) => put([ESC, 0x61, position === 'center' ? 1 : 0]);
  const bold = (on) => put([ESC, 0x45, on ? 1 : 0]);

  put([ESC, 0x40]);
  for (const entry of doc) {
    align(entry.center ? 'center' : 'left');
    bold(entry.bold);
    line(entry.text);
  }
  bold(false);
  align('left');
  line();
  line();
  if (cut) put([GS, 0x56, 0x00]);
  return Uint8Array.from(bytes);
};

const safePart = (value, fallback) => {
  const clean = String(value ?? '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return clean || fallback;
};

/** Nama berkas PDF: "Setoran-STR-20261019-001.pdf". */
export const setoranPdfFileName = (deposit = {}) =>
  `Setoran-${safePart(deposit.settlement_no || deposit.id, 'kasir')}.pdf`;

/** Nama berkas byte ESC/POS: "Setoran-STR-20261019-001.bin". */
export const setoranBinFileName = (deposit = {}) =>
  `Setoran-${safePart(deposit.settlement_no || deposit.id, 'kasir')}.bin`;

export default {
  STATUS_LABELS,
  SHIFT_LABELS,
  EXPENSE_CATEGORY_LABELS,
  REPRINT_LABEL,
  VOID_LABEL,
  fmtDayDMY,
  fmtClock,
  fmtStamp,
  buildSetoranDoc,
  buildSetoranLines,
  buildSetoranHtml,
  buildSetoranPdf,
  buildSetoranEscPos,
  setoranPdfFileName,
  setoranBinFileName,
};
