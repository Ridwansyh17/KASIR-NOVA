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

const GROUPED_NUMERIC = ['subtotal', 'discount_total', 'tax_total', 'total', 'voided_total'];

/** Zona waktu + nama bisnis (404 bila bisnis tidak ditemukan / terhapus). */
const getBusiness = async (businessId) => {
  const { rows } = await query(
    `SELECT id, name, timezone FROM businesses WHERE id = $1 AND deleted_at IS NULL`,
    [businessId]
  );
  if (!rows[0]) throw new NotFoundError('Bisnis tidak ditemukan');
  return rows[0];
};

/**
 * Bangun nilai/klausa filter. Placeholder tetap: $1 businessId, $2 from,
 * $3 timezone, $4 to; filter tambahan (outlet/kasir) dimulai dari $5.
 */
const buildStory = (businessId, tz, filters) => {
  const values = [businessId, filters.from ?? null, tz, filters.to ?? null];
  let extra = '';
  if (filters.outletId) {
    values.push(filters.outletId);
    extra += ` AND t.outlet_id = $${values.length}`;
  }
  if (filters.cashierId) {
    values.push(filters.cashierId);
    extra += ` AND t.cashier_id = $${values.length}`;
  }
  return { values, extra };
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
            COALESCE(COUNT(ti.id) FILTER (WHERE t.status = 'completed'), 0)::int AS items_sold,
            COALESCE(SUM(t.subtotal) FILTER (WHERE t.status = 'completed'), 0)   AS subtotal,
            COALESCE(SUM(t.discount_total) FILTER (WHERE t.status = 'completed'), 0) AS discount_total,
            COALESCE(SUM(t.tax_total) FILTER (WHERE t.status = 'completed'), 0)  AS tax_total,
            COALESCE(SUM(t.total) FILTER (WHERE t.status = 'completed'), 0)      AS total,
            COALESCE(SUM(t.total) FILTER (WHERE t.status = 'voided'), 0)         AS voided_total
       FROM bounds b
       CROSS JOIN transactions t
       LEFT JOIN transaction_items ti ON ti.transaction_id = t.id
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

/** Baris transaksi (tanpa agregasi) untuk kebutuhan ekspor. */
export const exportRows = async ({ businessId, filters }) => {
  const biz = await getBusiness(businessId);
  const { values, extra } = buildStory(businessId, biz.timezone, filters);

  const { rows } = await query(
    `${BOUNDS_CTE}
     SELECT t.invoice_no, t.status, t.subtotal, t.discount_total, t.tax_total,
            t.total, t.paid_amount, t.change_amount, t.created_at,
            o.name AS outlet_name, c.full_name AS cashier_name
       FROM bounds b
       CROSS JOIN transactions t
       LEFT JOIN outlets o ON o.id = t.outlet_id
       LEFT JOIN cashiers c ON c.id = t.cashier_id
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

export default { groupedReport, summary, exportRows, toCsv };