/**
 * Pembuat berkas Microsoft Excel (.xlsx) untuk rekapan transaksi Owner.
 *
 * Prinsip:
 *   - Data berasal dari transaksi NYATA yang sudah difilter di server
 *     (lihat `report/service.js`); modul ini hanya menata & memformat.
 *   - Nominal tersimpan dalam SEN (integer) di DB; pada berkas Excel
 *     dikonversi ke RUPIAH agar angka dapat dihitung/diformat sebagai mata uang.
 *   - Tanggal/jam memakai zona waktu BISNIS (sudah dihitung di SQL).
 *   - Proteksi formula injection: nilai teks yang diawali `= + - @ \t \r`
 *     diberi awalan apostrof sehingga tidak dieksekusi Excel.
 *   - Rumus agregat memakai nilai yang sama dengan dashboard (total/void) agar
 *     konsisten dengan halaman Owner.
 */
import ExcelJS from 'exceljs';

export const PAYMENT_METHOD_LABELS = {
  cash: 'Tunai',
  card: 'Kartu',
  qr: 'QRIS',
  wallet: 'E-Wallet',
};

export const PAYMENT_STATUS_LABELS = {
  paid: 'Lunas',
  pending: 'Pending',
  failed: 'Gagal',
  refunded: 'Refund',
};

export const TRANSACTION_STATUS_LABELS = {
  completed: 'Selesai',
  voided: 'Dibatalkan',
  refunded: 'Refund',
};

export const EXPENSE_CATEGORY_LABELS = {
  operational: 'Operasional',
  utilities: 'Listrik dan Air',
  supplies: 'Perlengkapan',
  transport: 'Transportasi',
  maintenance: 'Perawatan',
  inventory_purchase: 'Pembelian Persediaan',
  other: 'Lainnya',
};

export const EXPENSE_STATUS_LABELS = {
  recorded: 'Tercatat',
  voided: 'Dibatalkan',
};

export const EXPENSE_METHOD_LABELS = {
  cash: 'Tunai',
  transfer: 'Transfer',
  qr: 'QRIS',
};

const CURRENCY_FMT = '"Rp"#,##0';
const NAVY = 'FF0C1A34';
const CYAN = 'FF00B4FF';
const LIGHT = 'FFEAF4FF';

/** Netralkan teks agar tidak dieksekusi sebagai formula oleh Excel. */
export const sanitizeText = (value) => {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};

const senToRupiah = (sen) => Number(sen ?? 0) / 100;

/** '2026-10-12' -> '12/10/2026' (tampilan Indonesia, tetap berupa teks). */
const formatDateID = (isoDate) => {
  if (!isoDate) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(isoDate);
};

const labelOf = (map, key) => (key ? map[key] ?? key : '—');

/** Label filter dengan kondisi "semua" saat tidak dipilih. */
const filterLabel = (map, value, noneText) => (value ? map[value] ?? value : noneText);

/** Terapkan gaya baris judul tabel (latar navy, teks putih). */
const styleHeader = (row) => {
  row.height = 22;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: CYAN } } };
  });
};

/** Setel lebar kolom dari objek { key: lebar }. */
const setWidths = (ws, widths) => {
  ws.columns.forEach((col) => {
    if (col.key && widths[col.key]) col.width = widths[col.key];
  });
};

const applyCurrency = (ws, colKey, startRow) => {
  const idx = ws.getColumn(colKey).number;
  for (let r = startRow; r <= ws.rowCount; r += 1) {
    const cell = ws.getCell(r, idx);
    if (cell.value !== null && cell.value !== undefined && cell.value !== '') {
      cell.numFmt = CURRENCY_FMT;
    }
    cell.alignment = { horizontal: 'right' };
  }
};

/** Helper baris sheet Ringkasan: judul seksi, info, uang, cacah. */
const summaryParts = (ws) => ({
  section: (text) => {
    const r = ws.addRow([text, '']);
    r.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    r.eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    });
  },
  info: (label, value) => {
    ws.addRow([label, sanitizeText(value)]);
  },
  money: (label, sen, bold = false) => {
    const r = ws.addRow([label, senToRupiah(sen)]);
    r.getCell(2).numFmt = CURRENCY_FMT;
    if (bold) r.getCell(2).font = { bold: true };
  },
  count: (label, value, bold = false) => {
    const r = ws.addRow([label, Number(value ?? 0)]);
    if (bold) r.getCell(2).font = { bold: true };
  },
});

// ------------------------------------------------------------------ Sheets ---

const buildSummarySheet = (wb, { business, filters, rows, summary, period, generatedAt }) => {
  const ws = wb.addWorksheet('Ringkasan');
  ws.columns = [
    { key: 'label', width: 40 },
    { key: 'value', width: 32 },
  ];

  ws.mergeCells('A1:B1');
  const title = ws.getCell('A1');
  title.value = 'KASIR NOVA — Rekapan Transaksi';
  title.font = { bold: true, size: 15, color: { argb: NAVY } };
  ws.getCell('A2').value = `Dibuat: ${generatedAt}`;
  ws.getCell('A2').font = { italic: true, color: { argb: 'FF5A6B85' } };

  const { section, info, money, count } = summaryParts(ws);

  ws.addRow([]);
  section('INFORMASI LAPORAN');
  info('Nama Bisnis', business.name);
  info('Jenis Usaha', business.business_type || 'Tidak diisi');
  info('Mata Uang', business.currency || 'IDR');
  info('Zona Waktu', business.timezone || 'Asia/Jakarta');
  info('Periode', `${formatDateID(period.from)} s.d. ${formatDateID(period.to)}`);
  info('Filter Outlet', filters.outletLabel || 'Semua outlet');
  info('Filter Status Transaksi', filterLabel(TRANSACTION_STATUS_LABELS, filters.status, 'Semua status'));
  info('Filter Metode Pembayaran', filterLabel(PAYMENT_METHOD_LABELS, filters.paymentMethod, 'Semua metode'));
  info('Filter Status Pembayaran', filterLabel(PAYMENT_STATUS_LABELS, filters.paymentStatus, 'Semua status'));
  info('Kata Kunci Pencarian', filters.search || '—');

  // Status pembayaran didefinisikan pada TRANSAKSI SELESAI saja, sehingga
  // pending/gagal/lunas terpisah jelas dari transaksi batal/refund.
  const completed = rows.filter((r) => r.status === 'completed');
  const voided = rows.filter((r) => r.status === 'voided');
  const refunded = rows.filter((r) => r.status === 'refunded');
  const paid = completed.filter((r) => r.payment_status === 'paid');
  const pending = completed.filter((r) => r.payment_status === 'pending');
  const failed = completed.filter((r) => r.payment_status === 'failed');
  const sum = (list) => list.reduce((acc, r) => acc + Number(r.total ?? 0), 0);

  ws.addRow([]);
  section('RINGKASAN TRANSAKSI');
  count('Jumlah transaksi tercatat', rows.length);
  count('Transaksi selesai', completed.length);
  count('Transaksi dibatalkan (void)', voided.length);
  count('Transaksi refund', refunded.length);
  money('Total pendapatan (transaksi selesai)', summary.total, true);
  money('Rata-rata per transaksi (selesai)', summary.avg_total);
  money('Nilai transaksi dibatalkan (void)', summary.voided_total);
  money('Nilai transaksi refund', sum(refunded));

  ws.addRow([]);
  section('PEMBAYARAN (DIPISAH MENURUT STATUS)');
  count('Pembayaran lunas', paid.length);
  money('Total pembayaran lunas', sum(paid));
  count('Pembayaran pending', pending.length);
  money('Total pembayaran pending', sum(pending));
  count('Pembayaran gagal', failed.length);
  money('Total pembayaran gagal', sum(failed));

  ws.addRow([]);
  section('REKAP METODE PEMBAYARAN (TRANSAKSI SELESAI)');
  const byMethod = new Map();
  for (const r of completed) {
    const key = r.payment_method ?? 'tidak-diketahui';
    const cur = byMethod.get(key) ?? { count: 0, total: 0 };
    cur.count += 1;
    cur.total += Number(r.total ?? 0);
    byMethod.set(key, cur);
  }
  if (!byMethod.size) {
    ws.addRow(['—', 'Tidak ada transaksi selesai']);
  } else {
    for (const [key, v] of byMethod) {
      const r = ws.addRow([labelOf(PAYMENT_METHOD_LABELS, key), senToRupiah(v.total)]);
      r.getCell(2).numFmt = CURRENCY_FMT;
      r.getCell(1).value = `${labelOf(PAYMENT_METHOD_LABELS, key)} (${v.count} transaksi)`;
    }
  }
};

const buildDetailSheet = (wb, rows) => {
  const ws = wb.addWorksheet('Detail Transaksi', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  ws.columns = [
    { header: 'No', key: 'no', width: 6 },
    { header: 'Nomor Transaksi', key: 'invoice', width: 24 },
    { header: 'Tanggal', key: 'date', width: 12 },
    { header: 'Waktu', key: 'time', width: 10 },
    { header: 'Outlet', key: 'outlet', width: 22 },
    { header: 'Kasir', key: 'cashier', width: 20 },
    { header: 'Subtotal', key: 'subtotal', width: 14 },
    { header: 'Diskon', key: 'discount', width: 13 },
    { header: 'Pajak', key: 'tax', width: 13 },
    { header: 'Total', key: 'total', width: 15 },
    { header: 'Dibayar', key: 'paid', width: 14 },
    { header: 'Kembalian', key: 'change', width: 13 },
    { header: 'Metode Pembayaran', key: 'method', width: 18 },
    { header: 'Status Pembayaran', key: 'payStatus', width: 18 },
    { header: 'Status Transaksi', key: 'txStatus', width: 17 },
    { header: 'Catatan', key: 'note', width: 30 },
  ];
  styleHeader(ws.getRow(1));

  rows.forEach((r, i) => {
    ws.addRow({
      no: i + 1,
      invoice: sanitizeText(r.invoice_no),
      date: formatDateID(r.local_date),
      time: r.local_time ?? '',
      outlet: sanitizeText(r.outlet_name),
      cashier: sanitizeText(r.cashier_name),
      subtotal: senToRupiah(r.subtotal),
      discount: senToRupiah(r.discount_total),
      tax: senToRupiah(r.tax_total),
      total: senToRupiah(r.total),
      paid: senToRupiah(r.paid_amount),
      change: senToRupiah(r.change_amount),
      method: labelOf(PAYMENT_METHOD_LABELS, r.payment_method),
      payStatus: labelOf(PAYMENT_STATUS_LABELS, r.payment_status),
      txStatus: labelOf(TRANSACTION_STATUS_LABELS, r.status),
      note: sanitizeText(r.note),
    });
  });

  ['subtotal', 'discount', 'tax', 'total', 'paid', 'change'].forEach((k) =>
    applyCurrency(ws, k, 2)
  );
  ws.autoFilter = { from: 'A1', to: 'P1' };
};

const buildDailySheet = (wb, rows) => {
  const ws = wb.addWorksheet('Rekap Harian', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  ws.columns = [
    { header: 'Tanggal', key: 'date', width: 14 },
    { header: 'Jumlah Transaksi', key: 'count', width: 18 },
    { header: 'Omzet (Selesai)', key: 'omzet', width: 18 },
    { header: 'Dibatalkan (Void)', key: 'voided', width: 18 },
    { header: 'Refund', key: 'refunded', width: 16 },
    { header: 'Pending', key: 'pending', width: 16 },
    { header: 'Gagal', key: 'failed', width: 16 },
  ];
  styleHeader(ws.getRow(1));

  const map = new Map();
  for (const r of rows) {
    const key = r.local_date ?? '';
    const cur =
      map.get(key) ?? { count: 0, omzet: 0, voided: 0, refunded: 0, pending: 0, failed: 0 };
    cur.count += 1;
    if (r.status === 'completed') cur.omzet += Number(r.total ?? 0);
    if (r.status === 'voided') cur.voided += Number(r.total ?? 0);
    if (r.status === 'refunded') cur.refunded += Number(r.total ?? 0);
    if (r.status === 'completed' && r.payment_status === 'pending') cur.pending += Number(r.total ?? 0);
    if (r.status === 'completed' && r.payment_status === 'failed') cur.failed += Number(r.total ?? 0);
    map.set(key, cur);
  }

  [...map.keys()].sort().forEach((date) => {
    const v = map.get(date);
    ws.addRow({
      date: formatDateID(date),
      count: v.count,
      omzet: senToRupiah(v.omzet),
      voided: senToRupiah(v.voided),
      refunded: senToRupiah(v.refunded),
      pending: senToRupiah(v.pending),
      failed: senToRupiah(v.failed),
    });
  });

  ['omzet', 'voided', 'refunded', 'pending', 'failed'].forEach((k) =>
    applyCurrency(ws, k, 2)
  );
  ws.autoFilter = { from: 'A1', to: 'G1' };
};

const buildMethodSheet = (wb, rows) => {
  const ws = wb.addWorksheet('Rekap Metode Pembayaran', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  ws.columns = [
    { header: 'Metode Pembayaran', key: 'method', width: 24 },
    { header: 'Jumlah Transaksi', key: 'count', width: 18 },
    { header: 'Total Omzet (Selesai)', key: 'omzet', width: 22 },
  ];
  styleHeader(ws.getRow(1));

  const map = new Map();
  for (const r of rows) {
    const key = r.payment_method ?? 'tidak-diketahui';
    const cur = map.get(key) ?? { count: 0, omzet: 0 };
    cur.count += 1;
    if (r.status === 'completed') cur.omzet += Number(r.total ?? 0);
    map.set(key, cur);
  }

  [...map.keys()].forEach((key) => {
    const v = map.get(key);
    ws.addRow({ method: labelOf(PAYMENT_METHOD_LABELS, key), count: v.count, omzet: senToRupiah(v.omzet) });
  });

  applyCurrency(ws, 'omzet', 2);
  ws.autoFilter = { from: 'A1', to: 'C1' };
};

/**
 * Bangun berkas .xlsx dan kembalikan sebagai Buffer.
 *
 * @param {object} args
 * @param {object} args.business  - { name, business_type, currency, timezone }
 * @param {object} args.filters   - filter terpakai (untuk ditampilkan)
 * @param {Array}  args.rows      - baris transaksi (lihat service.exportRows)
 * @param {object} args.summary   - { total, avg_total, voided_total, transactions }
 * @param {{from:string,to:string}} args.period
 * @param {string} args.generatedAt
 * @returns {Promise<Buffer>}
 */
export const buildTransactionsWorkbook = async ({
  business,
  filters,
  rows,
  summary,
  period,
  generatedAt,
}) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'KASIR NOVA';
  wb.created = new Date();

  buildSummarySheet(wb, { business, filters, rows, summary, period, generatedAt });
  buildDetailSheet(wb, rows);
  buildDailySheet(wb, rows);
  buildMethodSheet(wb, rows);

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
};

// ------------------------------------------ Perbandingan (Fase 16) ---

const buildComparisonSummarySheet = (
  wb,
  { title, kind, business, filters, totals, period, generatedAt }
) => {
  const ws = wb.addWorksheet('Ringkasan');
  ws.columns = [
    { key: 'label', width: 42 },
    { key: 'value', width: 34 },
  ];

  ws.mergeCells('A1:B1');
  const heading = ws.getCell('A1');
  heading.value = title;
  heading.font = { bold: true, size: 15, color: { argb: NAVY } };
  ws.getCell('A2').value = `Dibuat: ${generatedAt}`;
  ws.getCell('A2').font = { italic: true, color: { argb: 'FF5A6B85' } };

  const { section, info, money, count } = summaryParts(ws);

  ws.addRow([]);
  section('INFORMASI LAPORAN');
  if (kind === 'outlet') {
    info('Nama Bisnis', business?.name ?? '—');
    info('Jenis Usaha', business?.business_type || 'Tidak diisi');
  } else {
    info('Cakupan', 'Semua bisnis milik Owner');
  }
  info(
    'Periode',
    period.from
      ? `${formatDateID(period.from)} s.d. ${formatDateID(period.to)}`
      : 'Bulan berjalan (per zona waktu bisnis)'
  );
  info('Filter Status Transaksi', filterLabel(TRANSACTION_STATUS_LABELS, filters.status, 'Semua status'));
  info('Filter Metode Pembayaran', filterLabel(PAYMENT_METHOD_LABELS, filters.paymentMethod, 'Semua metode'));
  info('Filter Status Pembayaran', filterLabel(PAYMENT_STATUS_LABELS, filters.paymentStatus, 'Semua status'));
  info('Kata Kunci Pencarian', filters.search || '—');

  ws.addRow([]);
  section('TOTAL');
  count(
    kind === 'outlet' ? 'Jumlah outlet' : 'Jumlah bisnis',
    kind === 'outlet' ? totals.outlets : totals.businesses
  );
  count('Transaksi selesai', totals.transactions);
  count('Item terjual', totals.items_sold);
  money('Total omzet (selesai)', totals.total, true);
  money('Nilai transaksi dibatalkan (void)', totals.voided_total);
  money('Nilai transaksi refund', totals.refunded_total);
};

const statusLabel = (status) =>
  status === 'active' ? 'Aktif' : status === 'inactive' ? 'Nonaktif' : status ?? '—';

const buildComparisonTableSheet = (wb, { kind, rows, totals }) => {
  const isOutlet = kind === 'outlet';
  const ws = wb.addWorksheet(isOutlet ? 'Perbandingan Outlet' : 'Perbandingan Bisnis', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  const base = [
    { header: 'No', key: 'no', width: 6 },
    { header: isOutlet ? 'Outlet' : 'Bisnis', key: 'name', width: isOutlet ? 26 : 28 },
    ...(isOutlet ? [{ header: 'Status', key: 'status', width: 12 }] : [{ header: 'Jenis Usaha', key: 'type', width: 18 }]),
    { header: 'Transaksi', key: 'transactions', width: 12 },
    { header: 'Item', key: 'items', width: 10 },
    { header: 'Subtotal', key: 'subtotal', width: 14 },
    { header: 'Diskon', key: 'discount', width: 13 },
    { header: 'Pajak', key: 'tax', width: 13 },
    { header: 'Total (Omzet)', key: 'total', width: 15 },
    { header: 'Void', key: 'voided', width: 13 },
    { header: 'Refund', key: 'refunded', width: 13 },
    ...(isOutlet ? [] : [{ header: 'Outlet Aktif', key: 'activeOutlets', width: 13 }]),
  ];
  ws.columns = base;
  const lastCol = String.fromCharCode(64 + base.length);
  styleHeader(ws.getRow(1));

  const rowOf = (r, no) => {
    const common = {
      no,
      transactions: r.transactions,
      items: r.items_sold,
      subtotal: senToRupiah(r.subtotal),
      discount: senToRupiah(r.discount_total),
      tax: senToRupiah(r.tax_total),
      total: senToRupiah(r.total),
      voided: senToRupiah(r.voided_total),
      refunded: senToRupiah(r.refunded_total),
    };
    return isOutlet
      ? { ...common, name: sanitizeText(r.outlet_name), status: statusLabel(r.outlet_status) }
      : {
          ...common,
          name: sanitizeText(r.name),
          type: sanitizeText(r.business_type || '—'),
          activeOutlets: r.active_outlets,
        };
  };

  rows.forEach((r, i) => ws.addRow(rowOf(r, i + 1)));

  const totalRow = ws.addRow({
    name: 'TOTAL',
    transactions: totals.transactions,
    items: totals.items_sold,
    subtotal: senToRupiah(totals.subtotal),
    discount: senToRupiah(totals.discount_total),
    tax: senToRupiah(totals.tax_total),
    total: senToRupiah(totals.total),
    voided: senToRupiah(totals.voided_total),
    refunded: senToRupiah(totals.refunded_total),
  });
  totalRow.font = { bold: true };
  totalRow.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } };
  });

  ['subtotal', 'discount', 'tax', 'total', 'voided', 'refunded'].forEach((k) =>
    applyCurrency(ws, k, 2)
  );
  ws.autoFilter = { from: 'A1', to: `${lastCol}1` };
};

/**
 * Bangun berkas perbandingan (.xlsx) — 2 sheet: Ringkasan + tabel perbandingan.
 * Dipakai untuk perbandingan outlet (satu bisnis) dan lintas-bisnis (Owner).
 * @returns {Promise<Buffer>}
 */
export const buildComparisonWorkbook = async ({
  kind,
  title,
  business,
  filters,
  rows,
  totals,
  period,
  generatedAt,
}) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'KASIR NOVA';
  wb.created = new Date();

  buildComparisonSummarySheet(wb, { title, kind, business, filters, totals, period, generatedAt });
  buildComparisonTableSheet(wb, { kind, rows, totals });

  return Buffer.from(await wb.xlsx.writeBuffer());
};

/**
 * Bangun berkas laporan keuangan (Fase 6) — sheet Ringkasan Keuangan,
 * Per Outlet, dan Pengeluaran Outlet. Angka (sen) diformat sebagai Rupiah.
 * @returns {Promise<Buffer>}
 */
export const buildFinanceWorkbook = async ({
  business,
  summary,
  expenses,
  filters,
  generatedAt,
}) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'KASIR NOVA';
  wb.created = new Date();

  // ------------------------------------------------ Sheet: Ringkasan ------
  const ws = wb.addWorksheet('Ringkasan Keuangan');
  ws.columns = [
    { key: 'label', width: 42 },
    { key: 'value', width: 30 },
  ];

  ws.mergeCells('A1:B1');
  const heading = ws.getCell('A1');
  heading.value = 'KASIR NOVA — Laporan Keuangan';
  heading.font = { bold: true, size: 15, color: { argb: NAVY } };
  ws.getCell('A2').value = `Dibuat: ${generatedAt}`;
  ws.getCell('A2').font = { italic: true, color: { argb: 'FF5A6B85' } };

  const { section, info, money, count } = summaryParts(ws);

  ws.addRow([]);
  section('INFORMASI LAPORAN');
  info('Nama Bisnis', business.name);
  info('Jenis Usaha', business.business_type || 'Tidak diisi');
  info('Mata Uang', business.currency || 'IDR');
  info('Zona Waktu', business.timezone || 'Asia/Jakarta');
  info('Periode (zona bisnis)', `${formatDateID(summary.period.from)} s.d. ${formatDateID(summary.period.to)}`);
  info('Filter Outlet', filters.outletLabel || 'Semua outlet');

  ws.addRow([]);
  section('PENDAPATAN (TRANSAKSI SELESAI & PEMBAYARAN LUNAS)');
  money('Tunai', summary.income.cash);
  money('QRIS', summary.income.qris);
  money('Kartu', summary.income.card);
  money('E-Wallet', summary.income.wallet);
  money('Total Pendapatan', summary.income.total, true);
  count('Jumlah transaksi selesai', summary.transactions.completed);
  count('Jumlah item terjual', summary.transactions.items_sold);

  ws.addRow([]);
  section('LABA / RUGI');
  money('HPP produk terjual', summary.hpp);
  money('Laba Kotor (Pendapatan - HPP)', summary.gross_profit, true);
  money('Pengeluaran Operasional', summary.expenses.operating_total);
  money('Biaya Transaksi', summary.income.transaction_fees);
  money('Laba Bersih', summary.net_profit, true);

  ws.addRow([]);
  section('PENGELUARAN MENURUT KATEGORI');
  if (!summary.expenses.by_category.length) {
    ws.addRow(['—', 'Tidak ada pengeluaran']);
  } else {
    for (const row of summary.expenses.by_category) {
      const r = ws.addRow([
        `${labelOf(EXPENSE_CATEGORY_LABELS, row.category)}${row.counts_as_operating ? '' : ' (tidak dihitung pada laba bersih)'}`,
        senToRupiah(row.total),
      ]);
      r.getCell(2).numFmt = CURRENCY_FMT;
    }
    money('Total pengeluaran recorded', summary.expenses.total, true);
  }

  ws.addRow([]);
  section('TRANSAKSI DIBATALKAN / REFUND (TIDAK DIHITUNG SEBAGAI PENDAPATAN)');
  count('Transaksi void', summary.transactions.voided);
  money('Nilai transaksi void', summary.transactions.voided_total);
  count('Transaksi refund', summary.transactions.refunded);
  money('Nilai transaksi refund', summary.transactions.refunded_total);

  // ------------------------------------------------ Sheet: Per Outlet ----
  const perOutlet = wb.addWorksheet('Per Outlet', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  perOutlet.columns = [
    { header: 'Outlet', key: 'name', width: 26 },
    { header: 'Transaksi', key: 'transactions', width: 12 },
    { header: 'Pendapatan', key: 'income', width: 16 },
    { header: 'HPP', key: 'hpp', width: 16 },
    { header: 'Laba Kotor', key: 'gross', width: 16 },
    { header: 'Pengeluaran', key: 'opex', width: 16 },
    { header: 'Biaya Transaksi', key: 'fees', width: 16 },
    { header: 'Laba Bersih', key: 'net', width: 16 },
  ];
  styleHeader(perOutlet.getRow(1));
  for (const o of summary.outlets) {
    perOutlet.addRow({
      name: sanitizeText(o.outlet_name),
      transactions: o.transactions,
      income: senToRupiah(o.income),
      hpp: senToRupiah(o.hpp),
      gross: senToRupiah(o.gross_profit),
      opex: senToRupiah(o.operating_expense),
      fees: senToRupiah(o.transaction_fees),
      net: senToRupiah(o.net_profit),
    });
  }
  ['income', 'hpp', 'gross', 'opex', 'fees', 'net'].forEach((k) =>
    applyCurrency(perOutlet, k, 2)
  );
  perOutlet.autoFilter = { from: 'A1', to: 'H1' };

  // ------------------------------------------ Sheet: Pengeluaran Outlet --
  const ex = wb.addWorksheet('Pengeluaran Outlet', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  ex.columns = [
    { header: 'No', key: 'no', width: 6 },
    { header: 'Tanggal', key: 'date', width: 12 },
    { header: 'Outlet', key: 'outlet', width: 22 },
    { header: 'Kategori', key: 'category', width: 22 },
    { header: 'Nominal', key: 'amount', width: 16 },
    { header: 'Metode', key: 'method', width: 12 },
    { header: 'Petugas', key: 'officer', width: 20 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Keterangan', key: 'note', width: 34 },
    { header: 'Alasan Batal', key: 'voidReason', width: 28 },
  ];
  styleHeader(ex.getRow(1));
  expenses.forEach((e, i) => {
    ex.addRow({
      no: i + 1,
      date: formatDateID(e.spent_on),
      outlet: sanitizeText(e.outlet_name),
      category: labelOf(EXPENSE_CATEGORY_LABELS, e.category),
      amount: senToRupiah(e.amount),
      method: labelOf(EXPENSE_METHOD_LABELS, e.method),
      officer: sanitizeText(e.officer_name || '—'),
      status: labelOf(EXPENSE_STATUS_LABELS, e.status),
      note: sanitizeText(e.note),
      voidReason: sanitizeText(e.void_reason),
    });
  });
  applyCurrency(ex, 'amount', 2);
  ex.autoFilter = { from: 'A1', to: 'J1' };

  return Buffer.from(await wb.xlsx.writeBuffer());
};

/**
 * Laporan Transaksi siap-cetak (17 Okt 2026) sebagai berkas Excel dengan
 * **satu baris per ITEM** (sama seperti halaman cetak — keputusan A3a).
 *
 * Sheet:
 *   1. `Ringkasan`              — informasi laporan, ringkasan, peringatan bila
 *                                 data terpotong (limit server).
 *   2. `Detail Transaksi`       — baris per item + baris TOTAL.
 *   3. `Rekap Metode Pembayaran`— omzet & persentase per metode (sumber sama
 *                                 dengan halaman cetak: `report.payment_methods`).
 *   4. `Produk Terlaris`        — 5 produk teratas (urut qty) + omzet.
 *
 * Angka omzet memakai `transactions.total` (bukan `payments.amount`) karena
 * `payments.amount` adalah UANG DITERIMA (memuat kembalian tunai) — lihat
 * catatan pada `report/service.js` dan `docs/35` §9.
 *
 * @param {object} args
 * @param {object} args.business    - { name, business_type, currency, timezone }
 * @param {object} args.report      - hasil `service.transactionReport()`
 * @param {object} args.filters     - filter terpakai (termasuk outletLabel/cashierLabel)
 * @param {string} args.generatedAt - waktu lokal zona bisnis (untuk kop berkas)
 * @returns {Promise<Buffer>}
 */
export const buildTransactionReportWorkbook = async ({
  business,
  report,
  filters,
  generatedAt,
}) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'KASIR NOVA';
  wb.created = new Date();

  const { period, summary, rows } = report;
  const methods = report.payment_methods ?? [];
  const topProducts = report.top_products ?? [];
  const sumQty = rows.reduce((n, r) => n + Number(r.qty ?? 0), 0);
  const sumLine = rows.reduce((n, r) => n + Number(r.line_total ?? 0), 0);
  const sumMethodOmzet = methods.reduce((n, m) => n + Number(m.total ?? 0), 0);

  // ------------------------------------------------ Sheet: Ringkasan ------
  const ws = wb.addWorksheet('Ringkasan');
  ws.columns = [
    { key: 'label', width: 44 },
    { key: 'value', width: 34 },
  ];

  ws.mergeCells('A1:B1');
  const heading = ws.getCell('A1');
  heading.value = 'KASIR NOVA — Laporan Transaksi';
  heading.font = { bold: true, size: 15, color: { argb: NAVY } };
  ws.getCell('A2').value = `Dibuat: ${generatedAt}`;
  ws.getCell('A2').font = { italic: true, color: { argb: 'FF5A6B85' } };

  const { section, info, money, count } = summaryParts(ws);

  ws.addRow([]);
  section('INFORMASI LAPORAN');
  info('Nama Bisnis', business.name);
  info('Jenis Usaha', business.business_type || 'Tidak diisi');
  info('Mata Uang', business.currency || 'IDR');
  info('Zona Waktu', business.timezone || 'Asia/Jakarta');
  info('Periode', `${formatDateID(period.from)} s.d. ${formatDateID(period.to)}`);
  info(
    'Filter Outlet',
    filters.outletId ? filters.outletLabel || 'Tidak ditemukan pada bisnis ini' : 'Semua outlet'
  );
  info(
    'Filter Kasir',
    filters.cashierId ? filters.cashierLabel || 'Tidak ditemukan pada bisnis ini' : 'Semua kasir'
  );
  info(
    'Filter Status Transaksi',
    filterLabel(TRANSACTION_STATUS_LABELS, filters.status, 'Selesai (bawaan)')
  );
  info(
    'Filter Metode Pembayaran',
    filterLabel(PAYMENT_METHOD_LABELS, filters.paymentMethod, 'Semua metode')
  );
  info(
    'Filter Status Pembayaran',
    filterLabel(PAYMENT_STATUS_LABELS, filters.paymentStatus, 'Semua status')
  );
  info('Kata Kunci Pencarian', filters.search || '—');

  ws.addRow([]);
  section('RINGKASAN');
  count('Jumlah transaksi', summary.transactions);
  money('Total omzet', summary.total, true);
  money('Rata-rata per transaksi', summary.avg_total);
  count('Jumlah item (qty) pada berkas ini', sumQty);
  count('Jumlah baris item pada berkas ini', rows.length);
  count('Transaksi dibatalkan (void)', summary.voided_transactions);
  money('Nilai transaksi void', summary.voided_total);
  count('Transaksi refund', summary.refunded_transactions);
  money('Nilai transaksi refund', summary.refunded_total);

  if (report.truncated) {
    ws.addRow([]);
    const warn = ws.addRow([
      'PERINGATAN',
      `Data TERPOTONG pada ${rows.length} baris pertama. Persempit rentang tanggal/outlet lalu unduh ulang agar lengkap.`,
    ]);
    warn.font = { bold: true, color: { argb: 'FFB00020' } };
    warn.getCell(2).alignment = { wrapText: true, vertical: 'middle' };
  }

  ws.addRow([]);
  section('REKAP METODE PEMBAYARAN (PEMBAYARAN LUNAS)');
  if (!methods.length) {
    ws.addRow(['—', 'Tidak ada pembayaran lunas pada periode ini']);
  } else {
    for (const m of methods) {
      const r = ws.addRow([
        `${m.label ?? labelOf(PAYMENT_METHOD_LABELS, m.method)} (${m.transactions} transaksi)`,
        senToRupiah(m.total),
      ]);
      r.getCell(2).numFmt = CURRENCY_FMT;
      r.getCell(2).alignment = { horizontal: 'right' };
    }
  }

  // ------------------------------------------ Sheet: Detail Transaksi -----
  const det = wb.addWorksheet('Detail Transaksi', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  det.columns = [
    { header: 'No', key: 'no', width: 6 },
    { header: 'Nomor Transaksi', key: 'invoice', width: 24 },
    { header: 'Tanggal', key: 'date', width: 12 },
    { header: 'Waktu', key: 'time', width: 9 },
    { header: 'Outlet', key: 'outlet', width: 22 },
    { header: 'Kasir', key: 'cashier', width: 20 },
    { header: 'Produk', key: 'product', width: 32 },
    { header: 'SKU', key: 'sku', width: 16 },
    { header: 'Qty', key: 'qty', width: 8 },
    { header: 'Harga Satuan', key: 'price', width: 15 },
    { header: 'Diskon', key: 'discount', width: 13 },
    { header: 'Subtotal Baris', key: 'line', width: 16 },
    { header: 'Metode Pembayaran', key: 'method', width: 20 },
  ];
  styleHeader(det.getRow(1));

  rows.forEach((r, i) => {
    det.addRow({
      no: i + 1,
      invoice: sanitizeText(r.invoice_no),
      date: formatDateID(r.date),
      time: r.time ?? '',
      outlet: sanitizeText(r.outlet_name),
      cashier: sanitizeText(r.cashier_name || '—'),
      product: sanitizeText(r.product_name),
      sku: sanitizeText(r.sku),
      qty: Number(r.qty ?? 0),
      price: senToRupiah(r.unit_price),
      discount: senToRupiah(r.discount_amount),
      line: senToRupiah(r.line_total),
      method: (r.methods ?? []).map((m) => labelOf(PAYMENT_METHOD_LABELS, m)).join(', ') || '—',
    });
  });

  const totalRow = det.addRow({
    invoice: 'TOTAL',
    qty: sumQty,
    line: senToRupiah(sumLine),
  });
  totalRow.font = { bold: true };
  ['price', 'discount', 'line'].forEach((k) => applyCurrency(det, k, 2));
  det.autoFilter = { from: 'A1', to: 'M1' };

  // ------------------------------------ Sheet: Rekap Metode Pembayaran ----
  const met = wb.addWorksheet('Rekap Metode Pembayaran', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  met.columns = [
    { header: 'Metode Pembayaran', key: 'method', width: 24 },
    { header: 'Jumlah Transaksi', key: 'count', width: 18 },
    { header: 'Omzet', key: 'total', width: 18 },
    { header: 'Persentase', key: 'percent', width: 14 },
  ];
  styleHeader(met.getRow(1));

  if (!methods.length) {
    met.addRow({ method: '—', count: 0, total: 0, percent: 0 });
  } else {
    for (const m of methods) {
      met.addRow({
        method: sanitizeText(m.label ?? labelOf(PAYMENT_METHOD_LABELS, m.method)),
        count: m.transactions,
        total: senToRupiah(m.total),
        percent: Number(m.percent ?? 0) / 100,
      });
    }
    const metTotal = met.addRow({
      method: 'TOTAL',
      count: methods.reduce((n, m) => n + Number(m.transactions ?? 0), 0),
      total: senToRupiah(sumMethodOmzet),
      percent: sumMethodOmzet > 0 ? 1 : 0,
    });
    metTotal.font = { bold: true };
  }
  applyCurrency(met, 'total', 2);
  const percentCol = met.getColumn('percent').number;
  for (let r = 2; r <= met.rowCount; r += 1) met.getCell(r, percentCol).numFmt = '0.0%';

  // ------------------------------------------- Sheet: Produk Terlaris -----
  const prod = wb.addWorksheet('Produk Terlaris', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  prod.columns = [
    { header: 'No', key: 'no', width: 6 },
    { header: 'Produk', key: 'name', width: 36 },
    { header: 'Qty Terjual', key: 'qty', width: 14 },
    { header: 'Omzet', key: 'revenue', width: 18 },
  ];
  styleHeader(prod.getRow(1));
  if (!topProducts.length) {
    prod.addRow({ no: '—', name: 'Tidak ada penjualan pada periode ini', qty: 0, revenue: 0 });
  } else {
    topProducts.forEach((p, i) => {
      prod.addRow({
        no: i + 1,
        name: sanitizeText(p.product_name),
        qty: Number(p.qty ?? 0),
        revenue: senToRupiah(p.revenue),
      });
    });
  }
  applyCurrency(prod, 'revenue', 2);
  prod.autoFilter = { from: 'A1', to: 'D1' };

  return Buffer.from(await wb.xlsx.writeBuffer());
};

/**
 * Laporan Transaksi **KASIR** (17 Okt 2026) sebagai berkas Excel — **satu baris
 * per TRANSAKSI** (keputusan pemilik B1) untuk outlet milik akun kasir.
 *
 * Sheet:
 *   1. `Ringkasan`               — informasi laporan, ringkasan, peringatan bila
 *                                  baris terpotong (`limit` server).
 *   2. `Daftar Transaksi`        — satu baris per transaksi + baris TOTAL.
 *   3. `Rekap Metode Pembayaran` — omzet & persentase per metode.
 *
 * Penyimpangan yang disengaja dari berkas Owner: **tanpa** sheet
 * `Produk Terlaris` (layar kasir memilih daftar transaksi; dicatat di `docs/37`).
 * Omzet tetap memakai `transactions.total`, bukan `payments.amount` (uang
 * diterima memuat kembalian tunai).
 *
 * @param {object} args
 * @param {object} args.business    - { name, business_type, currency, timezone }
 * @param {object} args.report      - hasil `service.cashierTransactionReport()`
 * @param {object} args.filters     - filter terpakai (termasuk `outletLabel`)
 * @param {string} args.generatedAt - waktu lokal zona bisnis (untuk kop berkas)
 * @returns {Promise<Buffer>}
 */
export const buildCashierTransactionReportWorkbook = async ({
  business,
  report,
  filters,
  generatedAt,
}) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'KASIR NOVA';
  wb.created = new Date();

  const { period, summary, rows } = report;
  const methods = report.payment_methods ?? [];
  const sumTotal = rows.reduce((n, r) => n + Number(r.total ?? 0), 0);
  const sumItems = rows.reduce((n, r) => n + Number(r.items ?? 0), 0);
  const sumMethodOmzet = methods.reduce((n, m) => n + Number(m.total ?? 0), 0);

  // ------------------------------------------------ Sheet: Ringkasan ------
  const ws = wb.addWorksheet('Ringkasan');
  ws.columns = [
    { key: 'label', width: 44 },
    { key: 'value', width: 34 },
  ];

  ws.mergeCells('A1:B1');
  const heading = ws.getCell('A1');
  heading.value = 'KASIR NOVA — Laporan Transaksi (Kasir)';
  heading.font = { bold: true, size: 15, color: { argb: NAVY } };
  ws.getCell('A2').value = `Dibuat: ${generatedAt}`;
  ws.getCell('A2').font = { italic: true, color: { argb: 'FF5A6B85' } };

  const { section, info, money, count } = summaryParts(ws);

  ws.addRow([]);
  section('INFORMASI LAPORAN');
  info('Nama Bisnis', business.name);
  info('Jenis Usaha', business.business_type || 'Tidak diisi');
  info('Outlet', report.outlet?.name || filters.outletLabel || '—');
  info('Mata Uang', business.currency || 'IDR');
  info('Zona Waktu', business.timezone || 'Asia/Jakarta');
  info('Periode', `${formatDateID(period.from)} s.d. ${formatDateID(period.to)}`);
  info(
    'Filter Status Transaksi',
    filterLabel(TRANSACTION_STATUS_LABELS, filters.status, 'Selesai (bawaan)')
  );
  info('Kata Kunci Pencarian', filters.search || '—');
  info('Cakupan', 'Semua kasir pada outlet ini (keputusan A5a)');

  ws.addRow([]);
  section('RINGKASAN');
  count('Jumlah transaksi', summary.transactions);
  money('Total omzet', summary.total, true);
  money('Rata-rata per transaksi', summary.avg_total);
  count('Jumlah item (qty) pada berkas ini', sumItems);
  count('Jumlah baris transaksi pada berkas ini', rows.length);
  count('Transaksi dibatalkan (void)', summary.voided_transactions);
  money('Nilai transaksi void', summary.voided_total);
  count('Transaksi refund', summary.refunded_transactions);
  money('Nilai transaksi refund', summary.refunded_total);

  if (report.truncated) {
    ws.addRow([]);
    const warn = ws.addRow([
      'PERINGATAN',
      `Data TERPOTONG pada ${rows.length} transaksi pertama. Persempit rentang tanggal lalu unduh ulang agar lengkap.`,
    ]);
    warn.font = { bold: true, color: { argb: 'FFB00020' } };
    warn.getCell(2).alignment = { wrapText: true, vertical: 'middle' };
  }

  ws.addRow([]);
  section('REKAP METODE PEMBAYARAN (PEMBAYARAN LUNAS)');
  if (!methods.length) {
    ws.addRow(['—', 'Tidak ada pembayaran lunas pada periode ini']);
  } else {
    for (const m of methods) {
      const r = ws.addRow([
        `${m.label ?? labelOf(PAYMENT_METHOD_LABELS, m.method)} (${m.transactions} transaksi)`,
        senToRupiah(m.total),
      ]);
      r.getCell(2).numFmt = CURRENCY_FMT;
      r.getCell(2).alignment = { horizontal: 'right' };
    }
  }

  // -------------------------------------------- Sheet: Daftar Transaksi ---
  const det = wb.addWorksheet('Daftar Transaksi', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  det.columns = [
    { header: 'No', key: 'no', width: 6 },
    { header: 'Nomor Transaksi', key: 'invoice', width: 24 },
    { header: 'Tanggal', key: 'date', width: 12 },
    { header: 'Waktu', key: 'time', width: 9 },
    { header: 'Jumlah Item', key: 'items', width: 13 },
    { header: 'Total', key: 'total', width: 16 },
    { header: 'Metode Pembayaran', key: 'method', width: 20 },
    { header: 'Kasir', key: 'cashier', width: 22 },
    { header: 'Status', key: 'status', width: 14 },
  ];
  styleHeader(det.getRow(1));

  rows.forEach((r, i) => {
    det.addRow({
      no: i + 1,
      invoice: sanitizeText(r.invoice_no),
      date: formatDateID(r.date),
      time: r.time ?? '',
      items: Number(r.items ?? 0),
      total: senToRupiah(r.total),
      method: (r.methods ?? []).map((m) => labelOf(PAYMENT_METHOD_LABELS, m)).join(', ') || '—',
      cashier: sanitizeText(r.cashier_name || '—'),
      status: labelOf(TRANSACTION_STATUS_LABELS, r.status),
    });
  });

  const totalRow = det.addRow({
    invoice: 'TOTAL',
    items: sumItems,
    total: senToRupiah(sumTotal),
  });
  totalRow.font = { bold: true };
  applyCurrency(det, 'total', 2);
  det.autoFilter = { from: 'A1', to: 'I1' };

  // ------------------------------------ Sheet: Rekap Metode Pembayaran ----
  const met = wb.addWorksheet('Rekap Metode Pembayaran', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  met.columns = [
    { header: 'Metode Pembayaran', key: 'method', width: 24 },
    { header: 'Jumlah Transaksi', key: 'count', width: 18 },
    { header: 'Omzet', key: 'total', width: 18 },
    { header: 'Persentase', key: 'percent', width: 14 },
  ];
  styleHeader(met.getRow(1));

  if (!methods.length) {
    met.addRow({ method: '—', count: 0, total: 0, percent: 0 });
  } else {
    for (const m of methods) {
      met.addRow({
        method: sanitizeText(m.label ?? labelOf(PAYMENT_METHOD_LABELS, m.method)),
        count: m.transactions,
        total: senToRupiah(m.total),
        percent: Number(m.percent ?? 0) / 100,
      });
    }
    const metTotal = met.addRow({
      method: 'TOTAL',
      count: methods.reduce((n, m) => n + Number(m.transactions ?? 0), 0),
      total: senToRupiah(sumMethodOmzet),
      percent: sumMethodOmzet > 0 ? 1 : 0,
    });
    metTotal.font = { bold: true };
  }
  applyCurrency(met, 'total', 2);
  const percentCol = met.getColumn('percent').number;
  for (let r = 2; r <= met.rowCount; r += 1) met.getCell(r, percentCol).numFmt = '0.0%';

  return Buffer.from(await wb.xlsx.writeBuffer());
};

export default {
  buildTransactionsWorkbook,
  buildComparisonWorkbook,
  buildFinanceWorkbook,
  buildTransactionReportWorkbook,
  buildCashierTransactionReportWorkbook,
  sanitizeText,
};
