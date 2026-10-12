/**
 * Layanan modul laporan (Fase 9).
 *
 * Aturan:
 *   - Semua agregat dihitung di server dengan SQL dan selalu difilter
 *     business_id (cakupan tenant); laporan Owner hanya bisnis miliknya,
 *     laporan Admin lintas platform read-only.
 *   - Hanya transaksi `completed` yang dihitung sebagai pendapatan; transaksi
 *     `voided` tampil terpisah sebagai `voided_total`.
 *   - Rentang `from`/`to` diinterpretasikan dalam ZONA WAKTU BISNIS; default
 *     = awal bulan kalender berjalan s.d. hari ini (zona bisnis).
 *   - Angka BIGINT/NUMERIC dari pg berupa string -> dikonversi Number().
 */
import { query } from '../../config/db.js';
import { NotFoundError } from '../../middleware/error.js';
import { buildTransactionsWorkbook, buildComparisonWorkbook } from './xlsx.js';

const GROUPED_NUMERIC = [
  'subtotal',
  'discount_total',
  'tax_total',
  'total',
  'voided_total',
  'refunded_total',
];

/**
 * Jumlah item terjual (hanya transaksi selesai) sebagai SUBQUERY berkorelasi,
 * bukan `JOIN transaction_items`. JOIN akan menggandakan baris transaksi
 * sebanyak jumlah item sehingga `SUM(t.total)` ikut berlipat (bug fan-out).
 */
const ITEMS_SOLD = `COALESCE(SUM((SELECT COUNT(*) FROM transaction_items ti
                                    WHERE ti.transaction_id = t.id))
                            FILTER (WHERE t.status = 'completed'), 0)::int`;

/** Escaping wildcard LIKE agar `%`/`_` dari pengguna tidak jadi pola liar. */
const escapeLike = (value) => String(value).replace(/[\\%_]/g, (c) => `\\${c}`);

/** Zona waktu + identitas bisnis (404 bila bisnis tidak ditemukan / terhapus). */
const getBusiness = async (businessId) => {
  const { rows } = await query(
    `SELECT id, name, business_type, currency, timezone
       FROM businesses WHERE id = $1 AND deleted_at IS NULL`,
    [businessId]
  );
  if (!rows[0]) throw new NotFoundError('Bisnis tidak ditemukan');
  return rows[0];
};

/**
 * Tambahkan klausa filter transaksi ke `values` (placeholder melanjutkan
 * `values.length`) dan kembalikan potongan SQL `extra` (diawali ` AND ...`).
 *
 * Dipakai bersama laporan per-bisnis (`buildStory`) dan lintas-bisnis.
 * Filter `paymentMethod`/`paymentStatus` memakai EXISTS agar transaksi dengan
 * pembayaran cocok tetap terpilih tanpa menggandakan baris bila kelak ada
 * lebih dari satu pembayaran per transaksi.
 */
const appendFilters = (filters, values) => {
  let extra = '';
  if (filters.outletId) {
    values.push(filters.outletId);
    extra += ` AND t.outlet_id = $${values.length}`;
  }
  if (filters.cashierId) {
    values.push(filters.cashierId);
    extra += ` AND t.cashier_id = $${values.length}`;
  }
  if (filters.status) {
    values.push(filters.status);
    extra += ` AND t.status = $${values.length}`;
  }
  if (filters.paymentMethod) {
    values.push(filters.paymentMethod);
    extra += ` AND EXISTS (SELECT 1 FROM payments p
                            WHERE p.transaction_id = t.id AND p.method = $${values.length})`;
  }
  if (filters.paymentStatus) {
    values.push(filters.paymentStatus);
    extra += ` AND EXISTS (SELECT 1 FROM payments p
                            WHERE p.transaction_id = t.id AND p.status = $${values.length})`;
  }
  if (filters.search) {
    values.push(`%${escapeLike(filters.search)}%`);
    extra += ` AND (t.invoice_no ILIKE $${values.length} ESCAPE '\\'
                    OR COALESCE(t.note, '') ILIKE $${values.length} ESCAPE '\\')`;
  }
  return extra;
};

/**
 * Bangun nilai/klausa filter untuk SATU bisnis. Placeholder tetap: $1
 * businessId, $2 from, $3 timezone, $4 to; filter tambahan dimulai dari $5.
 */
const buildStory = (businessId, tz, filters) => {
  const values = [businessId, filters.from ?? null, tz, filters.to ?? null];
  return { values, extra: appendFilters(filters, values) };
};

/** CTE batas tanggal (default: awal bulan ini s.d. hari ini, zona bisnis). */
const BOUNDS_CTE = /* sql */ `
  WITH bounds AS (
    SELECT COALESCE($2::date, (date_trunc('month', now() AT TIME ZONE $3::text))::date) AS from_date,
           COALESCE($4::date, (now() AT TIME ZONE $3::text))::date                     AS to_date
  )`;

/** Predikat rentang: created_at dalam [from_date, to_date) pada zona bisnis. */
const RANGE_PRED = /* sql */ `
  t.created_at >= (b.from_date)::timestamp AT TIME ZONE $3::text
  AND t.created_at < ((b.to_date)::timestamp + interval '1 day') AT TIME ZONE $3::text`;

/**
 * Laporan agregat per periode (day/week/month/year).
 * @returns {Array<{period_start, transactions, items_sold, subtotal,
 *   discount_total, tax_total, total, voided_total}>}
 */
export const groupedReport = async ({ businessId, filters }) => {
  const biz = await getBusiness(businessId);
  const { values, extra } = buildStory(businessId, biz.timezone, filters);

  const groupIdx = values.length + 1;
  const { rows } = await query(
    `${BOUNDS_CTE}
     SELECT to_char(DATE_TRUNC($${groupIdx}::text, t.created_at AT TIME ZONE $3::text), 'YYYY-MM-DD') AS period_start,
            COUNT(*) FILTER (WHERE t.status = 'completed')::int                  AS transactions,
            ${ITEMS_SOLD}                                                        AS items_sold,
            COALESCE(SUM(t.subtotal) FILTER (WHERE t.status = 'completed'), 0)   AS subtotal,
            COALESCE(SUM(t.discount_total) FILTER (WHERE t.status = 'completed'), 0) AS discount_total,
            COALESCE(SUM(t.tax_total) FILTER (WHERE t.status = 'completed'), 0)  AS tax_total,
            COALESCE(SUM(t.total) FILTER (WHERE t.status = 'completed'), 0)      AS total,
            COALESCE(SUM(t.total) FILTER (WHERE t.status = 'voided'), 0)         AS voided_total,
            COALESCE(SUM(t.total) FILTER (WHERE t.status = 'refunded'), 0)       AS refunded_total
       FROM bounds b
       CROSS JOIN transactions t
      WHERE t.business_id = $1
        AND ${RANGE_PRED}
        ${extra}
      GROUP BY 1
      ORDER BY 1`,
    [...values, filters.groupBy ?? 'day']
  );

  return rows.map((r) => {
    const out = { period_start: r.period_start, transactions: r.transactions, items_sold: r.items_sold };
    for (const k of GROUPED_NUMERIC) out[k] = Number(r[k]);
    return out;
  });
};

/**
 * Ringkasan rentang + produk terlaris.
 * @returns {{summary: {transactions, total, avg_total, voided_total,
 *   active_outlets}, top_products: Array<{product_name, qty, revenue}>}}
 */
export const summary = async ({ businessId, filters }) => {
  const biz = await getBusiness(businessId);
  const { values, extra } = buildStory(businessId, biz.timezone, filters);

  const { rows: sumRows } = await query(
    `${BOUNDS_CTE}
     SELECT COUNT(*) FILTER (WHERE t.status = 'completed')::int              AS transactions,
            COALESCE(SUM(t.total) FILTER (WHERE t.status = 'completed'), 0)  AS total,
            COALESCE(AVG(t.total) FILTER (WHERE t.status = 'completed'), 0)  AS avg_total,
            COALESCE(SUM(t.total) FILTER (WHERE t.status = 'voided'), 0)     AS voided_total,
            COALESCE(COUNT(DISTINCT t.outlet_id) FILTER (WHERE t.status = 'completed'), 0)::int AS active_outlets
       FROM transactions t, bounds b
      WHERE t.business_id = $1
        AND ${RANGE_PRED}
        ${extra}`,
    values
  );

  const { rows: prodRows } = await query(
    `${BOUNDS_CTE}
     SELECT ti.product_name,
            SUM(ti.qty)::int AS qty,
            COALESCE(SUM(ti.line_total), 0) AS revenue
       FROM transaction_items ti
       JOIN transactions t ON t.id = ti.transaction_id
       JOIN bounds b ON true
      WHERE t.business_id = $1 AND t.status = 'completed'
        AND ${RANGE_PRED}
        ${extra}
      GROUP BY ti.product_name
      ORDER BY revenue DESC, product_name ASC
      LIMIT 5`,
    values
  );

  const s = sumRows[0];
  return {
    summary: {
      transactions: s.transactions,
      total: Number(s.total),
      avg_total: Math.round(Number(s.avg_total)),
      voided_total: Number(s.voided_total),
      active_outlets: s.active_outlets,
    },
    top_products: prodRows.map((p) => ({
      product_name: p.product_name,
      qty: p.qty,
      revenue: Number(p.revenue),
    })),
  };
};

const COMPARISON_NUMERIC = ['subtotal', 'discount_total', 'tax_total', 'total', 'voided_total', 'refunded_total'];

/** Konversi kolom BIGINT/NUMERIC (string) menjadi Number() dan jumlahkan total. */
const tallyComparison = (rows, extraKeys) => {
  const items = rows.map((r) => {
    const out = { ...extraKeys(r) };
    out.transactions = r.transactions;
    out.items_sold = r.items_sold;
    for (const k of COMPARISON_NUMERIC) out[k] = Number(r[k]);
    return out;
  });
  const totals = { transactions: 0, items_sold: 0 };
  for (const k of COMPARISON_NUMERIC) totals[k] = 0;
  for (const it of items) {
    totals.transactions += it.transactions;
    totals.items_sold += it.items_sold;
    for (const k of COMPARISON_NUMERIC) totals[k] += it[k];
  }
  return { items, totals };
};

/**
 * Perbandingan agregat tiap OUTLET dalam SATU bisnis (menyertakan outlet yang
 * belum punya transaksi pada rentang, agar terlihat outlet yang kosong).
 * Filter sama dengan laporan lain; rentang mengikuti zona waktu bisnis.
 * @returns {{business, period, items, totals}}
 */
export const outletComparison = async ({ businessId, filters }) => {
  const biz = await getBusiness(businessId);
  const { values, extra } = buildStory(businessId, biz.timezone, filters);

  const { rows } = await query(
    `${BOUNDS_CTE}
     SELECT o.id AS outlet_id, o.name AS outlet_name, o.status AS outlet_status,
            COUNT(t.id) FILTER (WHERE t.status = 'completed')::int              AS transactions,
            ${ITEMS_SOLD}                                                       AS items_sold,
            COALESCE(SUM(t.subtotal) FILTER (WHERE t.status = 'completed'), 0)  AS subtotal,
            COALESCE(SUM(t.discount_total) FILTER (WHERE t.status = 'completed'), 0) AS discount_total,
            COALESCE(SUM(t.tax_total) FILTER (WHERE t.status = 'completed'), 0) AS tax_total,
            COALESCE(SUM(t.total) FILTER (WHERE t.status = 'completed'), 0)     AS total,
            COALESCE(SUM(t.total) FILTER (WHERE t.status = 'voided'), 0)        AS voided_total,
            COALESCE(SUM(t.total) FILTER (WHERE t.status = 'refunded'), 0)      AS refunded_total
       FROM bounds b
       CROSS JOIN outlets o
       LEFT JOIN transactions t
         ON t.outlet_id = o.id
        AND t.business_id = $1
        AND ${RANGE_PRED}
        ${extra}
      WHERE o.business_id = $1 AND o.deleted_at IS NULL
      GROUP BY o.id, o.name, o.status
      ORDER BY total DESC, o.name ASC`,
    values
  );

  const period = await resolvePeriod(businessId, biz.timezone, filters);
  const { items, totals } = tallyComparison(rows, (r) => ({
    outlet_id: r.outlet_id,
    outlet_name: r.outlet_name,
    outlet_status: r.outlet_status,
  }));
  totals.outlets = items.length;
  return {
    business: {
      id: biz.id,
      name: biz.name,
      business_type: biz.business_type,
      currency: biz.currency,
      timezone: biz.timezone,
    },
    period,
    items,
    totals,
  };
};

/**
 * Perbandingan agregat LINTAS-BISNIS untuk SATU Owner (semua bisnis miliknya,
 * termasuk yang belum punya transaksi pada rentang). Setiap bisnis memakai
 * ZONA WAKTUNYA SENDIRI untuk batas rentang; `from`/`to` adalah tanggal
 * `YYYY-MM-DD` yang diterapkan pada zona masing-masing.
 * @returns {{period, items, totals}}
 */
export const businessComparison = async ({ ownerId, filters }) => {
  const values = [ownerId, filters.from ?? null, filters.to ?? null];
  const extra = appendFilters(
    {
      status: filters.status,
      paymentMethod: filters.paymentMethod,
      paymentStatus: filters.paymentStatus,
      search: filters.search,
    },
    values
  );

  const { rows } = await query(
    `SELECT bu.id AS business_id, bu.name, bu.business_type, bu.currency, bu.timezone,
            COUNT(t.id) FILTER (WHERE t.status = 'completed')::int              AS transactions,
            ${ITEMS_SOLD}                                                       AS items_sold,
            COALESCE(SUM(t.subtotal) FILTER (WHERE t.status = 'completed'), 0)  AS subtotal,
            COALESCE(SUM(t.discount_total) FILTER (WHERE t.status = 'completed'), 0) AS discount_total,
            COALESCE(SUM(t.tax_total) FILTER (WHERE t.status = 'completed'), 0) AS tax_total,
            COALESCE(SUM(t.total) FILTER (WHERE t.status = 'completed'), 0)     AS total,
            COALESCE(SUM(t.total) FILTER (WHERE t.status = 'voided'), 0)        AS voided_total,
            COALESCE(SUM(t.total) FILTER (WHERE t.status = 'refunded'), 0)      AS refunded_total,
            COUNT(DISTINCT t.outlet_id) FILTER (WHERE t.status = 'completed')::int AS active_outlets
       FROM businesses bu
       LEFT JOIN transactions t
         ON t.business_id = bu.id
        AND t.created_at >= (COALESCE($2::date,
              (date_trunc('month', now() AT TIME ZONE bu.timezone))::date))::timestamp
              AT TIME ZONE bu.timezone
        AND t.created_at <  ((COALESCE($3::date,
              (now() AT TIME ZONE bu.timezone))::date)::timestamp + interval '1 day')
              AT TIME ZONE bu.timezone
        ${extra}
      WHERE bu.owner_id = $1 AND bu.deleted_at IS NULL
      GROUP BY bu.id, bu.name, bu.business_type, bu.currency, bu.timezone
      ORDER BY total DESC, bu.name ASC`,
    values
  );

  const { items, totals } = tallyComparison(rows, (r) => ({
    business_id: r.business_id,
    name: r.name,
    business_type: r.business_type,
    currency: r.currency,
    timezone: r.timezone,
    active_outlets: r.active_outlets,
  }));
  totals.businesses = items.length;
  return {
    period: { from: filters.from ?? null, to: filters.to ?? null },
    items,
    totals,
  };
};

/**
 * Baris transaksi (tanpa agregasi) untuk kebutuhan ekspor.
 *
 * Menyertakan metode & status pembayaran (pembayaran pertama bila ada),
 * nama outlet/kasir, serta tanggal & jam lokal bisnis untuk penataan Excel.
 */
export const exportRows = async ({ businessId, filters }) => {
  const biz = await getBusiness(businessId);
  const { values, extra } = buildStory(businessId, biz.timezone, filters);

  const { rows } = await query(
    `${BOUNDS_CTE}
     SELECT t.invoice_no, t.status, t.subtotal, t.discount_total, t.tax_total,
            t.total, t.paid_amount, t.change_amount, t.note, t.created_at,
            to_char(t.created_at AT TIME ZONE $3::text, 'YYYY-MM-DD') AS local_date,
            to_char(t.created_at AT TIME ZONE $3::text, 'HH24:MI:SS') AS local_time,
            o.name AS outlet_name, c.full_name AS cashier_name,
            pay.method AS payment_method, pay.status AS payment_status,
            pay.reference AS payment_reference
       FROM bounds b
       CROSS JOIN transactions t
       LEFT JOIN outlets o ON o.id = t.outlet_id
       LEFT JOIN cashiers c ON c.id = t.cashier_id
       LEFT JOIN LATERAL (
         SELECT method, status, reference
           FROM payments p
          WHERE p.transaction_id = t.id
          ORDER BY p.created_at ASC, p.id ASC
          LIMIT 1
       ) pay ON true
      WHERE t.business_id = $1
        AND ${RANGE_PRED}
        ${extra}
      ORDER BY t.created_at ASC, t.id ASC`,
    values
  );

  return rows.map((r) => ({
    ...r,
    subtotal: Number(r.subtotal),
    discount_total: Number(r.discount_total),
    tax_total: Number(r.tax_total),
    total: Number(r.total),
    paid_amount: Number(r.paid_amount),
    change_amount: Number(r.change_amount),
  }));
};

/**
 * Rentang tanggal efektif (mengikuti default `BOUNDS_CTE`, zona bisnis).
 * @returns {Promise<{from:string,to:string}>} tanggal `YYYY-MM-DD`
 */
export const resolvePeriod = async (businessId, timezone, filters) => {
  const { rows } = await query(
    `SELECT COALESCE($1::date, (date_trunc('month', now() AT TIME ZONE $2::text))::date)::text AS from_date,
            COALESCE($3::date, (now() AT TIME ZONE $2::text))::date::text                  AS to_date`,
    [filters.from ?? null, timezone, filters.to ?? null]
  );
  return { from: rows[0].from_date, to: rows[0].to_date };
};

/** Nama outlet untuk label filter (bila ada). */
const outletLabel = async (outletId) => {
  if (!outletId) return null;
  const { rows } = await query(`SELECT name FROM outlets WHERE id = $1`, [outletId]);
  return rows[0]?.name ?? 'Outlet tidak ditemukan';
};

/**
 * Ekspor rekapan transaksi ke berkas .xlsx (4 sheet).
 * @returns {Promise<{buffer: Buffer, filename: string}>}
 */
export const exportXlsx = async ({ businessId, filters }) => {
  const business = await getBusiness(businessId);
  const [rows, summaryData, period, outlet] = await Promise.all([
    exportRows({ businessId, filters }),
    summary({ businessId, filters }),
    resolvePeriod(businessId, business.timezone, filters),
    outletLabel(filters.outletId),
  ]);

  const generatedAt = new Date().toLocaleString('id-ID', { timeZone: business.timezone });
  const buffer = await buildTransactionsWorkbook({
    business,
    filters: { ...filters, outletLabel: outlet },
    rows,
    summary: summaryData.summary,
    period,
    generatedAt,
  });

  const filename = `KASIR_NOVA_Rekapan_Transaksi_${period.from}_sampai_${period.to}.xlsx`;
  return { buffer, filename };
};

/**
 * Ekspor perbandingan outlet (satu bisnis) ke .xlsx (2 sheet).
 * @returns {Promise<{buffer: Buffer, filename: string}>}
 */
export const exportOutletComparisonXlsx = async ({ businessId, filters }) => {
  const data = await outletComparison({ businessId, filters });
  const generatedAt = new Date().toLocaleString('id-ID', {
    timeZone: data.business.timezone,
  });
  const buffer = await buildComparisonWorkbook({
    kind: 'outlet',
    title: 'KASIR NOVA — Perbandingan Outlet',
    business: data.business,
    filters,
    rows: data.items,
    totals: data.totals,
    period: data.period,
    generatedAt,
  });
  const filename = `KASIR_NOVA_Perbandingan_Outlet_${data.period.from}_sampai_${data.period.to}.xlsx`;
  return { buffer, filename };
};

/**
 * Ekspor perbandingan lintas-bisnis (satu Owner) ke .xlsx (2 sheet).
 * @returns {Promise<{buffer: Buffer, filename: string}>}
 */
export const exportBusinessComparisonXlsx = async ({ ownerId, filters }) => {
  const data = await businessComparison({ ownerId, filters });
  const generatedAt = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  const buffer = await buildComparisonWorkbook({
    kind: 'business',
    title: 'KASIR NOVA — Perbandingan Lintas-Bisnis',
    filters,
    rows: data.items,
    totals: data.totals,
    period: data.period,
    generatedAt,
  });
  const from = data.period.from ?? 'awal-bulan';
  const to = data.period.to ?? 'hari-ini';
  const filename = `KASIR_NOVA_Perbandingan_Bisnis_${from}_sampai_${to}.xlsx`;
  return { buffer, filename };
};

const CSV_COLUMNS = [
  'invoice_no',
  'status',
  'outlet_name',
  'cashier_name',
  'subtotal',
  'discount_total',
  'tax_total',
  'total',
  'paid_amount',
  'change_amount',
  'created_at',
];

/** Serialisasi baris transaksi menjadi CSV (RFC 4180). */
export const toCsv = (rows) => {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) => CSV_COLUMNS.map((k) => esc(r[k])).join(','));
  return [CSV_COLUMNS.join(','), ...lines].join('\r\n');
};

export default {
  groupedReport,
  summary,
  outletComparison,
  businessComparison,
  exportRows,
  exportXlsx,
  exportOutletComparisonXlsx,
  exportBusinessComparisonXlsx,
  resolvePeriod,
  toCsv,
};