/**
 * Ekspor laporan Setoran Kasir ke Excel (.xlsx) untuk panel Owner.
 *
 * Nominal di DB dalam SEN; pada berkas dikonversi ke Rupiah agar bisa
 * dijumlahkan/diformat sebagai mata uang. Teks dinetralkan dari formula
 * injection (diawali `= + - @ \t \r`).
 */
import ExcelJS from 'exceljs';

const CURRENCY_FMT = '"Rp"#,##0';
const NAVY = 'FF0C1A34';
const LIGHT = 'FFEAF4FF';

const STATUS_LABELS = {
  completed: 'SELESAI',
  recorded: 'SELESAI',
  draft: 'DRAFT',
  voided: 'DIBATALKAN',
};

const PAYMENT_METHOD_LABELS = { cash: 'Tunai', qr: 'QRIS', mixed: 'Campuran' };

const EXPENSE_CATEGORY_LABELS = {
  operational: 'Operasional',
  utilities: 'Listrik dan Air',
  supplies: 'Perlengkapan',
  transport: 'Transportasi',
  maintenance: 'Perawatan',
  inventory_purchase: 'Pembelian Persediaan',
  other: 'Lainnya',
};

const sanitizeText = (value) => {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};

const rp = (sen) => Number(sen ?? 0) / 100;

const formatDateID = (isoDate) => {
  if (!isoDate) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate).slice(0, 10));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(isoDate);
};

const styleHeader = (row) => {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
};

/**
 * Bangun workbook laporan setoran (sheet Ringkasan + Detail).
 */
export const buildSettlementWorkbook = async ({ rows = [], business = {}, filters = {} } = {}) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'KASIR NOVA';
  wb.created = new Date();

  // ------------------------------------------------------------- Ringkasan --
  const sum = wb.addWorksheet('Ringkasan');
  sum.columns = [
    { key: 'label', width: 38 },
    { key: 'value', width: 30 },
  ];

  sum.mergeCells('A1:B1');
  const title = sum.getCell('A1');
  title.value = 'KASIR NOVA — LAPORAN SETORAN KASIR';
  title.font = { bold: true, size: 15, color: { argb: NAVY } };

  const info = (label, value) => {
    const row = sum.addRow([label, value]);
    row.getCell(1).font = { bold: true };
    return row;
  };

  sum.addRow([]);
  info('Nama Bisnis', sanitizeText(business?.name ?? '—'));
  info(
    'Periode',
    filters.from || filters.to
      ? `${filters.from ? formatDateID(filters.from) : 'awal'} s.d. ${
          filters.to ? formatDateID(filters.to) : 'akhir'
        }`
      : 'Semua tanggal'
  );
  info('Filter Status', filters.status && filters.status !== 'all' ? statusLabel(filters.status) : 'Semua status');

  const done = rows.filter((r) => r.status === 'completed' || r.status === 'recorded');
  const totals = done.reduce(
    (acc, r) => {
      acc.cash_revenue += Number(r.cash_revenue ?? 0);
      acc.qris_revenue += Number(r.qris_revenue ?? 0);
      acc.total_revenue += Number(r.total_revenue ?? 0);
      acc.total_expense += Number(r.total_expense ?? 0);
      acc.cash_expense += Number(r.cash_expense ?? 0);
      acc.required_cash += Number(r.required_cash ?? 0);
      acc.actual_cash += Number(r.actual_cash ?? 0);
      acc.difference += Number(r.difference ?? 0);
      return acc;
    },
    {
      cash_revenue: 0,
      qris_revenue: 0,
      total_revenue: 0,
      total_expense: 0,
      cash_expense: 0,
      required_cash: 0,
      actual_cash: 0,
      difference: 0,
    }
  );

  sum.addRow([]);
  info('Jumlah setoran (SELESAI)', done.length);
  const money = (label, value) => {
    const row = sum.addRow([label, rp(value)]);
    row.getCell(1).font = { bold: true };
    row.getCell(2).numFmt = CURRENCY_FMT;
    return row;
  };
  money('Pendapatan Tunai', totals.cash_revenue);
  money('Pendapatan QRIS', totals.qris_revenue);
  money('Total Pendapatan', totals.total_revenue);
  money('Total Pengeluaran', totals.total_expense);
  money('Pengeluaran dari Kas', totals.cash_expense);
  money('Setoran Tunai Wajib', totals.required_cash);
  money('Uang Tunai Aktual', totals.actual_cash);
  money('Selisih Setoran', totals.difference);

  // ---------------------------------------------------------------- Detail --
  const ws = wb.addWorksheet('Detail Setoran', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  ws.columns = [
    { header: 'No. Setoran', key: 'no', width: 22 },
    { header: 'Tanggal', key: 'date', width: 13 },
    { header: 'Outlet', key: 'outlet', width: 22 },
    { header: 'Kasir', key: 'officer', width: 20 },
    { header: 'Shift', key: 'shift', width: 22 },
    { header: 'Status', key: 'status', width: 13 },
    { header: 'Tunai', key: 'cash', width: 14 },
    { header: 'QRIS', key: 'qris', width: 14 },
    { header: 'Total Pendapatan', key: 'revenue', width: 17 },
    { header: 'Total Pengeluaran', key: 'expense', width: 17 },
    { header: 'Pengeluaran Kas', key: 'cashExpense', width: 16 },
    { header: 'Setoran Wajib', key: 'required', width: 15 },
    { header: 'Tunai Aktual', key: 'actual', width: 15 },
    { header: 'Selisih', key: 'difference', width: 14 },
    { header: 'Alasan/Keterangan', key: 'note', width: 30 },
  ];
  styleHeader(ws.getRow(1));

  for (const r of rows) {
    ws.addRow({
      no: sanitizeText(r.settlement_no ?? '—'),
      date: formatDateID(r.deposited_on),
      outlet: sanitizeText(r.outlet_name),
      officer: sanitizeText(r.officer_name ?? '—'),
      shift: sanitizeText(r.shift_label ?? '—'),
      status: statusLabel(r.status),
      cash: rp(r.cash_revenue),
      qris: rp(r.qris_revenue),
      revenue: rp(r.total_revenue),
      expense: rp(r.total_expense),
      cashExpense: rp(r.cash_expense),
      required: rp(r.required_cash),
      actual: rp(r.actual_cash),
      difference: rp(r.difference),
      note: sanitizeText(r.cashier_note ?? '—'),
    });
  }

  for (const key of ['cash', 'qris', 'revenue', 'expense', 'cashExpense', 'required', 'actual', 'difference']) {
    ws.getColumn(key).numFmt = CURRENCY_FMT;
  }
  ws.autoFilter = { from: 'A1', to: 'O1' };

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
};

const statusLabel = (status) => STATUS_LABELS[status] ?? status ?? '—';

export { STATUS_LABELS, PAYMENT_METHOD_LABELS, EXPENSE_CATEGORY_LABELS, sanitizeText };

export default { buildSettlementWorkbook };
