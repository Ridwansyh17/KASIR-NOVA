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
import { buildTransactionsWorkbook, buildComparisonWorkbook, buildFinanceWorkbook, buildTransactionReportWorkbook, PAYMENT_METHOD_LABELS } from './xlsx.js';
import { expensesInRange, expensesByCategory, exportExpenseRows } from '../expense/service.js';

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

// ------------------------------- Laporan Transaksi siap-cetak (17 Okt 2026) ---
/** Tanggal hari ini (YYYY-MM-DD) pada zona waktu bisnis. */
const todayInZone = (tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());

/**
 * Laporan Transaksi detail siap-cetak: SATU BARIS PER ITEM
 * (permintaan Owner 17 Okt 2026 — keputusan A3a).
 *
 * Aturan:
 *   - Cakupan tenant dijamin `business_id` (+ filter outlet/kasir dari
 *     pemanggil). Rute hanya Owner/Admin sehingga Kasir tidak dapat mengakses
 *     (keputusan A2b: hanya Owner yang membuat laporan ini).
 *   - Baris & omzet DEFAULT hanya transaksi `completed`; bila `status` diminta,
 *     baris mengikuti pilihan itu. Hitungan `voided`/`refunded` selalu
 *     disertakan sebagai informasi agar tidak ada angka tersembunyi.
 *   - Rekap metode pembayaran mengikuti definisi laporan keuangan (hanya
 *     pembayaran `paid`) dan persentasenya dihitung dari total pembayaran lunas
 *     yang direkap, sehingga totalnya selalu 100%.
 *   - `rows` dibatasi `limit`; `truncated` menandai bila terpotong.
 *
 * CATATAN: `transaction_items` tidak menyimpan `created_at`, sehingga urutan
 * item di dalam satu transaksi memakai nama produk (deterministik).
 *
 * @returns {{business, outlet, cashier, period, printed_at, summary,
 *   payment_methods, top_products, rows, truncated}}
 */
export const transactionReport = async ({ businessId, filters = {} }) => {
  const biz = await getBusiness(businessId);
  const tz = biz.timezone;
  const limit = Number.isFinite(filters.limit) ? filters.limit : 1000;
  const status = filters.status ?? 'completed';

  // Rentang efektif (mengikuti default BOUNDS_CTE) agar label periode tertulis
  // benar walau Owner tidak mengisi tanggal.
  const period = {
    from: filters.from ?? `${todayInZone(tz).slice(0, 7)}-01`,
    to: filters.to ?? todayInZone(tz),
  };

  // --- Baris per item (dibatasi `limit`) ------------------------------------
  const rowFilters = { ...filters, status };
  const { values, extra } = buildStory(businessId, tz, rowFilters);
  const limitIdx = values.length + 1;
  const { rows: itemRows } = await query(
    `${BOUNDS_CTE}
     SELECT t.invoice_no,
            to_char(t.created_at AT TIME ZONE $3::text, 'YYYY-MM-DD') AS local_date,
            to_char(t.created_at AT TIME ZONE $3::text, 'HH24:MI')    AS local_time,
            ti.product_name, ti.sku, ti.qty, ti.unit_price,
            ti.discount_amount, ti.line_total,
            o.name AS outlet_name, c.full_name AS cashier_name,
            COALESCE(pay.methods, ARRAY[]::text[]) AS methods
       FROM bounds b
       CROSS JOIN transactions t
       JOIN transaction_items ti ON ti.transaction_id = t.id
       LEFT JOIN outlets o ON o.id = t.outlet_id
       LEFT JOIN cashiers c ON c.id = t.cashier_id
       LEFT JOIN LATERAL (
         SELECT array_agg(DISTINCT p.method) AS methods
           FROM payments p WHERE p.transaction_id = t.id
       ) pay ON true
      WHERE t.business_id = $1
        AND ${RANGE_PRED}
        ${extra}
      ORDER BY t.created_at ASC, t.invoice_no ASC, ti.product_name ASC
      LIMIT $${limitIdx}::int`,
    [...values, limit + 1]
  );
  const truncated = itemRows.length > limit;
  const rows = (truncated ? itemRows.slice(0, limit) : itemRows).map((r) => ({
    invoice_no: r.invoice_no,
    date: r.local_date,
    time: r.local_time,
    product_name: r.product_name,
    sku: r.sku,
    qty: Number(r.qty),
    unit_price: Number(r.unit_price),
    discount_amount: Number(r.discount_amount),
    line_total: Number(r.line_total),
    outlet_name: r.outlet_name,
    cashier_name: r.cashier_name,
    methods: r.methods ?? [],
  }));

  // --- Ringkasan per status (satu query, tanpa filter status) ---------------
  const allStory = buildStory(businessId, tz, { ...filters, status: undefined });
  const { rows: statusRows } = await query(
    `${BOUNDS_CTE}
     SELECT t.status,
            COUNT(*)::int             AS transactions,
            COALESCE(SUM(t.total), 0) AS total
       FROM transactions t, bounds b
      WHERE t.business_id = $1
        AND ${RANGE_PRED}
        ${allStory.extra}
      GROUP BY t.status`,
    allStory.values
  );
  const stats = {};
  for (const r of statusRows) {
    stats[r.status] = { transactions: r.transactions, total: Number(r.total) };
  }
  const picked = stats[status] ?? { transactions: 0, total: 0 };

  // --- Rekap metode pembayaran (hanya pembayaran LUNAS) ---------------------
  // PENTING: omzet per metode dihitung dari `t.total`, BUKAN `payments.amount`.
  // `payments.amount` menyimpan UANG DITERIMA; untuk tunai nilainya termasuk
  // kembalian (mis. total 40.000 dibayar 100.000 -> amount 100.000), sehingga
  // memakai `amount` akan MELEBIHKAN omzet tunai. Karena satu transaksi = satu
  // pembayaran (split belum ada), total per metode berjumlah tepat sama dengan
  // omzet periode sehingga persentasenya selalu 100%.
  // CATATAN: `incomeByMethod` pada laporan keuangan sudah disamakan (memakai
  // `t.total`) pada 17 Okt 2026 atas izin pemilik — lihat docs/35.
  const { rows: methodRows } = await query(
    `${BOUNDS_CTE}
     SELECT p.method,
            COALESCE(SUM(t.total), 0)  AS total,
            COUNT(DISTINCT t.id)::int  AS transactions
       FROM bounds b
       CROSS JOIN transactions t
       JOIN payments p ON p.transaction_id = t.id AND p.status = 'paid'
      WHERE t.business_id = $1
        AND ${RANGE_PRED}
        ${extra}
      GROUP BY p.method
      ORDER BY total DESC, p.method ASC`,
    values
  );
  const paidBase = methodRows.reduce((n, r) => n + Number(r.total), 0);
  const paymentMethods = methodRows.map((r) => {
    const total = Number(r.total);
    return {
      method: r.method,
      label: PAYMENT_METHOD_LABELS[r.method] ?? r.method,
      total,
      transactions: Number(r.transactions),
      percent: paidBase > 0 ? Math.round((total / paidBase) * 1000) / 10 : 0,
    };
  });

  // --- Produk terlaris (urut QTY, sesuai contoh Owner; + kolom omzet) -------
  const { rows: prodRows } = await query(
    `${BOUNDS_CTE}
     SELECT ti.product_name,
            SUM(ti.qty)::int                AS qty,
            COALESCE(SUM(ti.line_total), 0) AS revenue
       FROM transaction_items ti
       JOIN transactions t ON t.id = ti.transaction_id
       JOIN bounds b ON true
      WHERE t.business_id = $1
        AND ${RANGE_PRED}
        ${extra}
      GROUP BY ti.product_name
      ORDER BY qty DESC, revenue DESC, ti.product_name ASC
      LIMIT 5`,
    values
  );

  // --- Label outlet/kasir untuk kop laporan ---------------------------------
  let outlet = null;
  if (filters.outletId) {
    const { rows: oRows } = await query(
      `SELECT name FROM outlets WHERE id = $1 AND business_id = $2`,
      [filters.outletId, businessId]
    );
    outlet = oRows[0] ? { id: filters.outletId, name: oRows[0].name } : null;
  }
  let cashier = null;
  if (filters.cashierId) {
    // `cashiers` hanya punya outlet_id (1 kasir = 1 outlet), jadi kepemilikan
    // tenant diperiksa lewat outlet-nya agar kasir bisnis lain tidak dinamai.
    const { rows: cRows } = await query(
      `SELECT c.full_name
         FROM cashiers c
         JOIN outlets o ON o.id = c.outlet_id
        WHERE c.id = $1 AND o.business_id = $2`,
      [filters.cashierId, businessId]
    );
    cashier = cRows[0] ? { id: filters.cashierId, name: cRows[0].full_name } : null;
  }

  return {
    business: {
      id: biz.id,
      name: biz.name,
      business_type: biz.business_type,
      currency: biz.currency,
      timezone: tz,
    },
    outlet,
    cashier,
    period,
    printed_at: new Date().toISOString(),
    summary: {
      status,
      transactions: picked.transactions,
      total: picked.total,
      avg_total: picked.transactions ? Math.round(picked.total / picked.transactions) : 0,
      voided_transactions: stats.voided?.transactions ?? 0,
      voided_total: stats.voided?.total ?? 0,
      refunded_transactions: stats.refunded?.transactions ?? 0,
      refunded_total: stats.refunded?.total ?? 0,
    },
    payment_methods: paymentMethods,
    top_products: prodRows.map((p) => ({
      product_name: p.product_name,
      qty: p.qty,
      revenue: Number(p.revenue),
    })),
    rows,
    truncated,
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

// ==================================================== Fase 4/6: Keuangan ====
/** Geser tanggal `YYYY-MM-DD` sebanyak `days` (UTC) — aman dari DST/zona lokal. */
export const shiftDate = (dateStr, days) => {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

/**
 * Rentang efektif laporan keuangan/dashboard.
 * Prioritas: `date` > `period` > (`from`,`to`) > default `today`.
 * `period`: today | yesterday | week (7 hari terakhir termasuk hari ini) |
 * month (awal bulan s.d. hari ini). Semua dihitung pada ZONA WAKTU BISNIS.
 */
export const resolveFinanceRange = async (timezone, filters = {}) => {
  const { rows } = await query(
    `SELECT (now() AT TIME ZONE $1::text)::date::text AS today`,
    [timezone]
  );
  const today = rows[0].today;

  if (filters.date) return { from: filters.date, to: filters.date, period: 'date', today };

  switch (filters.period) {
    case 'yesterday': {
      const d = shiftDate(today, -1);
      return { from: d, to: d, period: 'yesterday', today };
    }
    case 'week':
      return { from: shiftDate(today, -6), to: today, period: 'week', today };
    case 'month':
      return { from: `${today.slice(0, 7)}-01`, to: today, period: 'month', today };
    case 'custom':
      if (!filters.from || !filters.to) {
        return { from: today, to: today, period: 'today', today };
      }
      return { from: filters.from, to: filters.to, period: 'custom', today };
    case 'today':
    default:
      if (filters.from || filters.to) {
        return {
          from: filters.from ?? filters.to,
          to: filters.to ?? filters.from,
          period: 'custom',
          today,
        };
      }
      return { from: today, to: today, period: 'today', today };
  }
};

/**
 * Pendapatan per metode pembayaran (hanya transaksi selesai & pembayaran lunas).
 *
 * PERBAIKAN 17 Okt 2026 (izin pemilik): omzet per metode dihitung dari
 * `t.total`, BUKAN `p.amount`. `payments.amount` menyimpan UANG DITERIMA;
 * untuk tunai nilainya termasuk kembalian (total 40.000 dibayar 100.000 ->
 * amount 100.000) sehingga `p.amount` MELEBIHKAN omzet tunai, laba kotor, dan
 * laba bersih. `p.fee_amount` tetap dari `payments` (biaya transaksi).
 * Asumsi: satu transaksi = satu pembayaran `paid` (split payment belum ada);
 * karenanya `SUM(t.total)` per metode tidak menghitung ganda.
 */
const incomeByMethod = async (businessId, range, tz, outletId) => {
  const { rows } = await query(
    `SELECT p.method,
            COALESCE(SUM(t.total), 0)      AS total,
            COALESCE(SUM(p.fee_amount), 0) AS fees,
            count(DISTINCT t.id)::int      AS transactions
       FROM payments p
       JOIN transactions t ON t.id = p.transaction_id
      WHERE t.business_id = $1
        AND t.status = 'completed'
        AND p.status = 'paid'
        AND t.created_at >= ($2::date)::timestamp AT TIME ZONE $4::text
        AND t.created_at < ((($3::date)::timestamp + interval '1 day') AT TIME ZONE $4::text)
        AND ($5::uuid IS NULL OR t.outlet_id = $5)
      GROUP BY p.method
      ORDER BY p.method ASC`,
    [businessId, range.from, range.to, tz, outletId]
  );
  return rows.map((r) => ({
    method: r.method,
    total: Number(r.total),
    fees: Number(r.fees),
    transactions: Number(r.transactions),
  }));
};

/**
 * Ringkasan keuangan satu periode (Fase 4 laporan harian kasir & Fase 6
 * dashboard Owner).
 *
 * Rumus (semua SEN):
 *   Total Pendapatan = Tunai + QRIS + metode lain
 *   Laba Kotor       = Total Pendapatan - HPP produk terjual
 *   Laba Bersih      = Laba Kotor - Pengeluaran Operasional - Biaya Transaksi
 *
 * Hanya transaksi `completed` + pembayaran `paid` yang dihitung; transaksi
 * pending/gagal/void/refund TIDAK masuk pendapatan. Pengeluaran kategori
 * `inventory_purchase` tidak dihitung dua kali (lihat modul expense).
 */
export const financeSummary = async ({ businessId, filters = {}, outletId = null }) => {
  const biz = await getBusiness(businessId);
  const tz = biz.timezone;
  const range = await resolveFinanceRange(tz, filters);
  const targetOutlet = filters.outletId ?? outletId ?? null;

  /**
   * Predikat rentang + cakupan outlet untuk transaksi (param: $1 bisnis,
   * $2 from, $3 to, $4 timezone, $5 outlet id / NULL).
   */
  const FINANCE_PREDICATE = `t.business_id = $1 AND t.status = 'completed'
    AND t.created_at >= ($2::date)::timestamp AT TIME ZONE $4::text
    AND t.created_at < ((($3::date)::timestamp + interval '1 day') AT TIME ZONE $4::text)
    AND ($5::uuid IS NULL OR t.outlet_id = $5)`;

  const [methods, hppRows, txRows, voidRows, outletRows, expenses, byCategory] =
    await Promise.all([
      incomeByMethod(businessId, range, biz.timezone, targetOutlet),
      query(
        `SELECT COALESCE(SUM(ti.cost_price * ti.qty), 0) AS hpp,
                COALESCE(SUM(ti.qty), 0)::int             AS items_sold
           FROM transaction_items ti
           JOIN transactions t ON t.id = ti.transaction_id
          WHERE ${FINANCE_PREDICATE}`,
        [businessId, range.from, range.to, biz.timezone, targetOutlet]
      ),
      query(
        `SELECT COUNT(*) FILTER (WHERE t.status = 'completed')::int AS completed
           FROM transactions t
          WHERE t.business_id = $1
            AND t.created_at >= ($2::date)::timestamp AT TIME ZONE $4::text
            AND t.created_at < ((($3::date)::timestamp + interval '1 day') AT TIME ZONE $4::text)
            AND ($5::uuid IS NULL OR t.outlet_id = $5)`,
        [businessId, range.from, range.to, biz.timezone, targetOutlet]
      ),
      query(
        `SELECT COALESCE(SUM(t.total) FILTER (WHERE t.status = 'voided'), 0)   AS voided_total,
                COALESCE(SUM(t.total) FILTER (WHERE t.status = 'refunded'), 0) AS refunded_total,
                COUNT(*) FILTER (WHERE t.status = 'voided')::int               AS voided_count,
                COUNT(*) FILTER (WHERE t.status = 'refunded')::int             AS refunded_count
           FROM transactions t
          WHERE t.business_id = $1
            AND t.created_at >= ($2::date)::timestamp AT TIME ZONE $4::text
            AND t.created_at < ((($3::date)::timestamp + interval '1 day') AT TIME ZONE $4::text)
            AND ($5::uuid IS NULL OR t.outlet_id = $5)`,
        [businessId, range.from, range.to, biz.timezone, targetOutlet]
      ),
      query(
        `WITH pay AS (
           SELECT t.outlet_id, COALESCE(SUM(t.total), 0) AS income,
                  COALESCE(SUM(p.fee_amount), 0)          AS fees,
                  COUNT(DISTINCT t.id)::int               AS transactions
             FROM payments p
             JOIN transactions t ON t.id = p.transaction_id
            WHERE t.business_id = $1 AND t.status = 'completed' AND p.status = 'paid'
              AND t.created_at >= ($2::date)::timestamp AT TIME ZONE $4::text
              AND t.created_at < ((($3::date)::timestamp + interval '1 day') AT TIME ZONE $4::text)
            GROUP BY t.outlet_id
         ), hpp AS (
           SELECT t.outlet_id, COALESCE(SUM(ti.cost_price * ti.qty), 0) AS hpp
             FROM transaction_items ti
             JOIN transactions t ON t.id = ti.transaction_id
            WHERE t.business_id = $1 AND t.status = 'completed'
              AND t.created_at >= ($2::date)::timestamp AT TIME ZONE $4::text
              AND t.created_at < ((($3::date)::timestamp + interval '1 day') AT TIME ZONE $4::text)
            GROUP BY t.outlet_id
         ), exp AS (
           SELECT outlet_id, COALESCE(SUM(amount) FILTER (WHERE category <> 'inventory_purchase'), 0) AS operating
             FROM expenses
            WHERE business_id = $1 AND status = 'recorded'
              AND spent_on >= $2::date AND spent_on <= $3::date
            GROUP BY outlet_id
         )
         SELECT o.id AS outlet_id, o.name AS outlet_name,
                COALESCE(pay.income, 0)  AS income,
                COALESCE(pay.fees, 0)    AS fees,
                COALESCE(pay.transactions, 0) AS transactions,
                COALESCE(hpp.hpp, 0)     AS hpp,
                COALESCE(exp.operating, 0) AS operating_expense
           FROM outlets o
           LEFT JOIN pay ON pay.outlet_id = o.id
           LEFT JOIN hpp ON hpp.outlet_id = o.id
           LEFT JOIN exp ON exp.outlet_id = o.id
          WHERE o.business_id = $1 AND o.deleted_at IS NULL
            AND ($5::uuid IS NULL OR o.id = $5)
          ORDER BY o.name ASC`,
        [businessId, range.from, range.to, biz.timezone, targetOutlet]
      ),
      expensesInRange({ query }, {
        businessId,
        outletId: targetOutlet,
        from: range.from,
        to: range.to,
      }),
      expensesByCategory({ query }, {
        businessId,
        outletId: targetOutlet,
        from: range.from,
        to: range.to,
      }),
    ]);

  const pick = (key) => Number(methods.find((m) => m.method === key)?.total ?? 0);
  const cash = pick('cash');
  const qris = pick('qr');
  const card = pick('card');
  const wallet = pick('wallet');
  const totalIncome = methods.reduce((a, m) => a + Number(m.total), 0);
  const feeTotal = methods.reduce((a, m) => a + Number(m.fees), 0);

  const hpp = Number(hppRows.rows[0].hpp);
  const itemsSold = hppRows.rows[0].items_sold;
  const grossProfit = totalIncome - hpp;
  const netProfit = grossProfit - expenses.operating_total - feeTotal;

  const s = voidRows.rows[0];
  const outlets = outletRows.rows.map((r) => {
    const income = Number(r.income);
    const outletHpp = Number(r.hpp);
    const operating = Number(r.operating_expense);
    const fees = Number(r.fees);
    return {
      outlet_id: r.outlet_id,
      outlet_name: r.outlet_name,
      transactions: r.transactions,
      income,
      hpp: outletHpp,
      operating_expense: operating,
      transaction_fees: fees,
      gross_profit: income - outletHpp,
      net_profit: income - outletHpp - operating - fees,
    };
  });

  return {
    business: {
      id: biz.id,
      name: biz.name,
      currency: biz.currency,
      timezone: biz.timezone,
    },
    period: { from: range.from, to: range.to, preset: range.period },
    scope: { outlet_id: targetOutlet },
    income: {
      cash,
      qris,
      card,
      wallet,
      other: 0,
      total: totalIncome,
      transaction_fees: feeTotal,
    },
    payment_methods: methods.map((m) => ({
      method: m.method,
      total: Number(m.total),
      fees: Number(m.fees),
      transactions: Number(m.transactions),
    })),
    transactions: {
      completed: txRows.rows[0].completed,
      voided: s.voided_count,
      refunded: s.refunded_count,
      items_sold: itemsSold,
      voided_total: Number(s.voided_total),
      refunded_total: Number(s.refunded_total),
    },
    hpp,
    expenses: { ...expenses, by_category: byCategory },
    gross_profit: grossProfit,
    net_profit: netProfit,
    outlets,
  };
};

/**
 * Ekspor laporan keuangan (Fase 6) ke .xlsx: sheet Ringkasan Keuangan +
 * sheet Pengeluaran Outlet. Memakai rumus & angka yang SAMA dengan dashboard
 * (bukan perhitungan ulang terpisah).
 * @returns {Promise<{buffer: Buffer, filename: string}>}
 */
export const exportFinanceXlsx = async ({ businessId, filters }) => {
  const business = await getBusiness(businessId);
  const [summary, expenses, outlet] = await Promise.all([
    financeSummary({ businessId, filters }),
    exportExpenseRows({ businessId, filters }),
    outletLabel(filters.outletId),
  ]);
  const generatedAt = new Date().toLocaleString('id-ID', { timeZone: business.timezone });
  const buffer = await buildFinanceWorkbook({
    business,
    summary,
    expenses,
    filters: { ...filters, outletLabel: outlet },
    generatedAt,
  });
  const filename = `KASIR_NOVA_Laporan_Keuangan_${summary.period.from}_sampai_${summary.period.to}.xlsx`;
  return { buffer, filename };
};

/**
 * Ekspor **Laporan Transaksi** (baris per item) ke .xlsx — 17 Okt 2026.
 *
 * Memakai `transactionReport()` yang sama dengan halaman cetak sehingga angka,
 * filter, dan cakupan tenant identik. `limit` diambil dari filter (skema ekspor
 * memakai batas lebih tinggi, bawaan 5000) dan bila masih terpotong, berkas
 * memuat peringatan pada sheet `Ringkasan`.
 *
 * @returns {Promise<{buffer: Buffer, filename: string}>}
 */
export const exportTransactionReportXlsx = async ({ businessId, filters = {} }) => {
  const business = await getBusiness(businessId);
  const report = await transactionReport({ businessId, filters });
  const generatedAt = new Date().toLocaleString('id-ID', { timeZone: business.timezone });

  const buffer = await buildTransactionReportWorkbook({
    business,
    report,
    filters: {
      ...filters,
      outletLabel: report.outlet?.name ?? '',
      cashierLabel: report.cashier?.name ?? '',
    },
    generatedAt,
  });

  const filename = `KASIR_NOVA_Laporan_Transaksi_${report.period.from}_sampai_${report.period.to}.xlsx`;
  return { buffer, filename };
};

export default {
  groupedReport,
  summary,
  transactionReport,
  outletComparison,
  businessComparison,
  exportRows,
  exportXlsx,
  exportOutletComparisonXlsx,
  exportBusinessComparisonXlsx,
  exportTransactionReportXlsx,
  resolvePeriod,
  resolveFinanceRange,
  financeSummary,
  shiftDate,
  toCsv,
};
