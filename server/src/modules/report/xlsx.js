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

  const section = (text) => {
    const r = ws.addRow([text, '']);
    r.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    r.eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    });
  };
  const info = (label, value) => {
    ws.addRow([label, sanitizeText(value)]);
  };
  const money = (label, sen, bold = false) => {
    const r = ws.addRow([label, senToRupiah(sen)]);
    r.getCell(2).numFmt = CURRENCY_FMT;
    if (bold) r.getCell(2).font = { bold: true };
  };
  const count = (label, value, bold = false) => {
    const r = ws.addRow([label, Number(value ?? 0)]);
    if (bold) r.getCell(2).font = { bold: true };
  };

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

export default { buildTransactionsWorkbook, sanitizeText };
