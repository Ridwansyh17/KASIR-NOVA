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

export default {
  buildTransactionsWorkbook,
  buildComparisonWorkbook,
  buildFinanceWorkbook,
  sanitizeText,
};
