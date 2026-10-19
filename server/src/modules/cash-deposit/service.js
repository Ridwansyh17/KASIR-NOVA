/**
 * Layanan setoran kasir.
 *
 * Ada dua generasi data pada tabel `cash_deposits`:
 *   1. Legacy (migrasi 0011): `amount` manual, status `recorded`/`voided`.
 *      Tetap didukung agar data lama dan UI lama tidak rusak.
 *   2. Settlement (migrasi 0012): nominal DIHITUNG dari transaksi tunai/QRIS
 *      dan pengeluaran outlet pada satu periode. Status `draft`/`completed`;
 *      `recorded` lama diperlakukan sebagai SELESAI pada laporan.
 *
 * Prinsip:
 *   - Nominal SEN (BIGINT), semua perhitungan final di server.
 *   - QRIS bukan uang fisik: tidak menambah setoran tunai wajib.
 *   - Hanya pengeluaran metode `cash` yang mengurangi setoran tunai wajib.
 *   - Satu transaksi/pengeluaran hanya boleh berada di SATU setoran aktif
 *     (unique index parsial); koreksi dilakukan dengan void + setoran baru.
 *   - Snapshot disimpan agar cetak ulang tidak menghitung ulang data terbaru.
 */
import { query, withTransaction } from '../../config/db.js';
import {
  AppError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
} from '../../middleware/error.js';
import { writeAudit } from '../audit/service.js';
import { todayInTimezone } from '../expense/service.js';

export const CASH_DEPOSIT_COLUMNS = `id, business_id, outlet_id, amount, method,
  note, receipt_url, status, deposited_on, cashier_id, created_by_role,
  created_by_id, voided_at, voided_by_role, voided_by_id, void_reason,
  settlement_no, period_start, period_end, shift_label,
  cash_revenue, qris_revenue, total_revenue, total_expense, cash_expense,
  noncash_expense, required_cash, actual_cash, difference, shortfall,
  cashier_note, recipient_name, snapshot, completed_at,
  created_at, updated_at`;

/** Status yang dianggap setoran selesai pada laporan. */
export const DONE_STATUSES = ['completed', 'recorded'];

/**
 * Jendela shift dalam jam (bisa melewati tengah malam).
 * Label mengikuti contoh struk pada assets/references.
 */
export const SHIFT_WINDOWS = {
  full: { startHour: 0, endHour: 24, label: 'Sehari (00:00 - 24:00)' },
  pagi: { startHour: 8, endHour: 15, label: 'Pagi (08:00 - 15:00)' },
  sore: { startHour: 15, endHour: 21, label: 'Sore (15:00 - 21:00)' },
  malam: { startHour: 21, endHour: 32, label: 'Malam (21:00 - 08:00)' },
};

const getBusiness = async (db, businessId) => {
  const { rows } = await db.query(
    `SELECT id, name, timezone, status FROM businesses
      WHERE id = $1 AND deleted_at IS NULL`,
    [businessId]
  );
  if (!rows[0]) throw new NotFoundError('Bisnis tidak ditemukan');
  return rows[0];
};

const getOutlet = async (db, businessId, outletId) => {
  const { rows } = await db.query(
    `SELECT id, name FROM outlets
      WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
    [outletId, businessId]
  );
  if (!rows[0]) throw new NotFoundError('Outlet tidak ditemukan');
  return rows[0];
};

/** Nama pelaku (kasir/owner) untuk snapshot struk. */
const getActorName = async (db, actor) => {
  if (!actor?.id) return '';
  if (actor.role === 'cashier') {
    const { rows } = await db.query(`SELECT full_name FROM cashiers WHERE id = $1`, [actor.id]);
    return rows[0]?.full_name ?? '';
  }
  if (actor.role === 'owner') {
    const { rows } = await db.query(`SELECT full_name FROM owners WHERE id = $1`, [actor.id]);
    return rows[0]?.full_name ?? '';
  }
  return '';
};

/** Hitung batas periode [start, end) di zona waktu bisnis. */
export const resolvePeriod = async (db, { date, shift = 'full', timezone }) => {
  const win = SHIFT_WINDOWS[shift] ?? SHIFT_WINDOWS.full;
  const { rows } = await db.query(
    `SELECT (($1::date + make_interval(hours => $2::int)) AT TIME ZONE $3) AS start_ts,
            (($1::date + make_interval(hours => $4::int)) AT TIME ZONE $3) AS end_ts,
            ($1::date)::text AS day`,
    [date, win.startHour, timezone, win.endHour]
  );
  return {
    start: rows[0].start_ts,
    end: rows[0].end_ts,
    date: rows[0].day,
    shift,
    shiftLabel: win.label,
    timezone,
  };
};

/**
 * Hitung pendapatan & pengeluaran yang BELUM masuk setoran lain.
 * Semua nilai dalam sen.
 */
export const computeSettlement = async (db, { businessId, outletId, period }) => {
  // Omzet per metode HARUS memakai `t.total` (nilai bersih), BUKAN
  // `p.amount`. `payments.amount` menyimpan uang DITERIMA sehingga untuk tunai
  // termasuk kembalian (mis. total Rp40.000 dibayar Rp100.000 -> amount
  // Rp100.000) dan akan MELEBIHKAN kas wajib. Definisi ini sama dengan
  // `paymentMethodRecap` di laporan agar angka setoran tidak pernah berbeda.
  const tx = await db.query(
    `SELECT t.id, t.invoice_no, t.created_at,
            COALESCE(SUM(t.total) FILTER (WHERE p.method = 'cash'), 0)::bigint AS cash_amount,
            COALESCE(SUM(t.total) FILTER (WHERE p.method = 'qr'), 0)::bigint AS qris_amount,
            COALESCE(SUM(t.total) FILTER (WHERE p.method NOT IN ('cash','qr')), 0)::bigint AS other_amount
       FROM transactions t
       JOIN payments p ON p.transaction_id = t.id
      WHERE t.business_id = $1
        AND t.outlet_id = $2
        AND t.status = 'completed'
        AND p.status = 'paid'
        AND t.created_at >= $3
        AND t.created_at < $4
        AND NOT EXISTS (
          SELECT 1 FROM cash_deposit_transactions cdt
           WHERE cdt.transaction_id = t.id AND cdt.is_active
        )
      GROUP BY t.id, t.invoice_no, t.created_at
      ORDER BY t.created_at ASC, t.id ASC`,
    [businessId, outletId, period.start, period.end]
  );

  const expense = await db.query(
    `SELECT e.id, e.category, e.method, e.amount, e.note, e.spent_on
       FROM expenses e
      WHERE e.business_id = $1
        AND e.outlet_id = $2
        AND e.status = 'recorded'
        AND e.spent_on >= ($3::timestamptz AT TIME ZONE $5::text)::date
        AND e.spent_on <= (($4::timestamptz - interval '1 microsecond') AT TIME ZONE $5::text)::date
        AND NOT EXISTS (
          SELECT 1 FROM cash_deposit_expenses cde
           WHERE cde.expense_id = e.id AND cde.is_active
        )
      ORDER BY e.spent_on ASC, e.created_at ASC, e.id ASC`,
    [businessId, outletId, period.start, period.end, period.timezone]
  );

  const transactions = tx.rows.map((r) => ({
    id: r.id,
    invoice_no: r.invoice_no,
    created_at: r.created_at,
    cash_amount: Number(r.cash_amount),
    qris_amount: Number(r.qris_amount),
    other_amount: Number(r.other_amount),
    method:
      Number(r.cash_amount) > 0 && Number(r.qris_amount) === 0
        ? 'cash'
        : Number(r.qris_amount) > 0 && Number(r.cash_amount) === 0
          ? 'qr'
          : 'mixed',
    amount: Number(r.cash_amount) + Number(r.qris_amount) + Number(r.other_amount),
  }));

  const expenses = expense.rows.map((r) => ({
    id: r.id,
    category: r.category,
    method: r.method,
    note: r.note,
    amount: Number(r.amount),
    spent_on: r.spent_on,
  }));

  const cashRevenue = transactions.reduce((s, t) => s + t.cash_amount, 0);
  const qrisRevenue = transactions.reduce((s, t) => s + t.qris_amount, 0);
  const otherRevenue = transactions.reduce((s, t) => s + t.other_amount, 0);
  const cashExpense = expenses
    .filter((e) => e.method === 'cash')
    .reduce((s, e) => s + e.amount, 0);
  const noncashExpense = expenses
    .filter((e) => e.method !== 'cash')
    .reduce((s, e) => s + e.amount, 0);

  return {
    transactions,
    expenses,
    cash_revenue: cashRevenue,
    qris_revenue: qrisRevenue,
    other_revenue: otherRevenue,
    total_revenue: cashRevenue + qrisRevenue,
    total_expense: cashExpense + noncashExpense,
    cash_expense: cashExpense,
    noncash_expense: noncashExpense,
    required_cash: Math.max(0, cashRevenue - cashExpense),
    shortfall: Math.max(0, cashExpense - cashRevenue),
  };
};

const findOverlap = async (db, { outletId, period, excludeId = null }) => {
  const { rows } = await db.query(
    `SELECT id, settlement_no, period_start, period_end
       FROM cash_deposits
      WHERE outlet_id = $1
        AND status IN ('draft','completed')
        AND period_start IS NOT NULL
        AND period_end IS NOT NULL
        AND period_start < $3
        AND period_end > $2
        AND ($4::uuid IS NULL OR id <> $4)
      ORDER BY period_start ASC
      LIMIT 1`,
    [outletId, period.start, period.end, excludeId]
  );
  return rows[0] ?? null;
};

const nextSettlementNo = async (db, { businessId, date }) => {
  const compact = String(date).replace(/-/g, '');
  const prefix = `STR-${compact}-`;
  const { rows } = await db.query(
    `SELECT COALESCE(MAX(NULLIF(split_part(settlement_no, '-', 3), '')::int), 0) + 1 AS n
       FROM cash_deposits
      WHERE business_id = $1 AND settlement_no LIKE $2`,
    [businessId, `${prefix}%`]
  );
  return `${prefix}${String(rows[0].n).padStart(3, '0')}`;
};

const periodToJson = (period) => ({
  start: new Date(period.start).toISOString(),
  end: new Date(period.end).toISOString(),
  date: period.date,
  shift: period.shift,
  shift_label: period.shiftLabel,
});

/**
 * Pratinjau perhitungan setoran (read-only, tidak menyimpan apa pun).
 */
export const previewSettlement = async ({ businessId, outletId, date, shift, actor }) => {
  const biz = await getBusiness({ query }, businessId);
  const outlet = await getOutlet({ query }, businessId, outletId);
  const today = await todayInTimezone({ query }, biz.timezone);
  const day = date ?? today;
  if (day > today) throw new ConflictError('Tanggal setoran tidak boleh melebihi hari ini');

  const period = await resolvePeriod({ query }, { date: day, shift, timezone: biz.timezone });
  const calc = await computeSettlement({ query }, { businessId, outletId, period });
  const overlap = await findOverlap({ query }, { outletId, period });

  return {
    business: { id: biz.id, name: biz.name, timezone: biz.timezone },
    outlet: { id: outlet.id, name: outlet.name },
    cashier: { id: actor?.id ?? null, name: await getActorName({ query }, actor) },
    period: { ...periodToJson(period), timezone: biz.timezone },
    overlap,
    totals: {
      cash_revenue: calc.cash_revenue,
      qris_revenue: calc.qris_revenue,
      other_revenue: calc.other_revenue,
      total_revenue: calc.total_revenue,
      total_expense: calc.total_expense,
      cash_expense: calc.cash_expense,
      noncash_expense: calc.noncash_expense,
      required_cash: calc.required_cash,
      shortfall: calc.shortfall,
    },
    transactions: calc.transactions,
    expenses: calc.expenses,
  };
};

const insertSettlementLinks = async (db, { depositId, calc }) => {
  for (const t of calc.transactions) {
    await db.query(
      `INSERT INTO cash_deposit_transactions
         (deposit_id, transaction_id, invoice_no, method, amount)
       VALUES ($1,$2,$3,$4,$5)`,
      [depositId, t.id, t.invoice_no, t.method, t.amount]
    );
  }
  for (const e of calc.expenses) {
    await db.query(
      `INSERT INTO cash_deposit_expenses
         (deposit_id, expense_id, category, method, note, amount)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [depositId, e.id, e.category, e.method, e.note, e.amount]
    );
  }
};

/**
 * Buat setoran baru (langsung SELESAI atau simpan DRAFT).
 */
export const createSettlement = async ({
  businessId,
  outletId,
  data,
  actor,
  ip,
  saveAs = 'completed',
}) => {
  return withTransaction(async (client) => {
    const biz = await getBusiness(client, businessId);
    if (biz.status !== 'active') {
      throw new ConflictError('Bisnis sedang nonaktif; tidak dapat menyimpan setoran');
    }
    const outlet = await getOutlet(client, businessId, outletId);
    const today = await todayInTimezone(client, biz.timezone);
    const day = data.date ?? today;
    if (day > today) throw new ConflictError('Tanggal setoran tidak boleh melebihi hari ini');

    const period = await resolvePeriod(client, {
      date: day,
      shift: data.shift ?? 'full',
      timezone: biz.timezone,
    });
    period.timezone = biz.timezone;

    // Serialisasi pembuatan setoran per outlet+hari agar nomor dan periode unik.
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
      `settlement:${businessId}:${outletId}:${day}`,
    ]);

    const overlap = await findOverlap(client, { outletId, period });
    if (overlap) {
      throw new ConflictError(
        `Periode ini tumpang tindih dengan setoran ${overlap.settlement_no ?? overlap.id}`
      );
    }

    const calc = await computeSettlement(client, { businessId, outletId, period });
    const isCompleted = saveAs !== 'draft';
    const actual = data.actualCash;
    if (isCompleted && (actual === undefined || actual === null)) {
      throw new AppError('Uang tunai aktual wajib diisi untuk menyelesaikan setoran', 422);
    }
    const difference = isCompleted ? Number(actual) - calc.required_cash : null;
    const note = (data.note ?? '').trim();
    if (isCompleted && difference !== 0 && note.length < 3) {
      throw new AppError('Alasan selisih wajib diisi (minimal 3 karakter)', 422);
    }

    const cashierName = await getActorName(client, actor);
    const settlementNo = await nextSettlementNo(client, { businessId, date: day });
    const status = isCompleted ? 'completed' : 'draft';
    const snapshot = {
      version: 1,
      settlement_no: settlementNo,
      status,
      business: { id: biz.id, name: biz.name },
      outlet: { id: outlet.id, name: outlet.name },
      cashier: { id: actor?.id ?? null, name: cashierName },
      recipient_name: data.recipientName ?? null,
      period: { ...periodToJson(period), timezone: biz.timezone },
      totals: {
        cash_revenue: calc.cash_revenue,
        qris_revenue: calc.qris_revenue,
        other_revenue: calc.other_revenue,
        total_revenue: calc.total_revenue,
        total_expense: calc.total_expense,
        cash_expense: calc.cash_expense,
        noncash_expense: calc.noncash_expense,
        required_cash: calc.required_cash,
        actual_cash: isCompleted ? Number(actual) : null,
        difference,
        shortfall: calc.shortfall,
      },
      note: note || null,
      transactions: calc.transactions,
      expenses: calc.expenses,
    };

    const { rows } = await client.query(
      `INSERT INTO cash_deposits
         (business_id, outlet_id, amount, method, note, status, deposited_on,
          cashier_id, created_by_role, created_by_id, settlement_no,
          period_start, period_end, shift_label, cash_revenue, qris_revenue,
          total_revenue, total_expense, cash_expense, noncash_expense,
          required_cash, actual_cash, difference, shortfall, cashier_note,
          recipient_name, snapshot, completed_at)
       VALUES ($1,$2,$3,'cash',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
               $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,
                CASE WHEN $5::cash_deposit_status = 'completed' THEN now() ELSE NULL END)
       RETURNING ${CASH_DEPOSIT_COLUMNS}`,
      [
        businessId,
        outletId,
        isCompleted ? Number(actual) : 0,
        note || null,
        status,
        day,
        actor.role === 'cashier' ? actor.id : null,
        actor.role,
        actor.id,
        settlementNo,
        period.start,
        period.end,
        period.shiftLabel,
        calc.cash_revenue,
        calc.qris_revenue,
        calc.total_revenue,
        calc.total_expense,
        calc.cash_expense,
        calc.noncash_expense,
        calc.required_cash,
        isCompleted ? Number(actual) : null,
        difference,
        calc.shortfall,
        note || null,
        data.recipientName ?? null,
        snapshot,
      ]
    );
    const deposit = rows[0];
    await insertSettlementLinks(client, { depositId: deposit.id, calc });

    await writeAudit({
      client,
      actorRole: actor.role,
      actorId: actor.id,
      businessId,
      action: isCompleted ? 'cash_deposit.settlement_create' : 'cash_deposit.settlement_draft',
      entityType: 'cash_deposit',
      entityId: deposit.id,
      after: {
        settlement_no: settlementNo,
        outlet_id: outletId,
        period_start: period.start,
        period_end: period.end,
        required_cash: calc.required_cash,
        actual_cash: isCompleted ? Number(actual) : null,
        difference,
      },
      ip,
    });

    return { deposit, outlet_name: outlet.name };
  });
};

/** Selesaikan setoran DRAFT dengan uang tunai aktual. */
export const completeSettlement = async ({
  businessId,
  depositId,
  data,
  actor,
  ip,
  restrictToCashierId = null,
  restrictToOutletId = null,
}) => {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT ${CASH_DEPOSIT_COLUMNS} FROM cash_deposits
        WHERE id = $1 AND business_id = $2 FOR UPDATE`,
      [depositId, businessId]
    );
    const deposit = rows[0];
    if (!deposit) throw new NotFoundError('Setoran tidak ditemukan');
    if (deposit.status !== 'draft') {
      throw new ConflictError('Hanya setoran berstatus DRAFT yang dapat diselesaikan');
    }
    if (restrictToCashierId && deposit.created_by_id !== restrictToCashierId) {
      throw new ForbiddenError('Kasir hanya dapat menyelesaikan setoran miliknya');
    }
    if (restrictToOutletId && deposit.outlet_id !== restrictToOutletId) {
      throw new NotFoundError('Setoran tidak ditemukan');
    }

    const actual = Number(data.actualCash);
    const required = Number(deposit.required_cash);
    const difference = actual - required;
    const note = (data.note ?? deposit.cashier_note ?? '').trim();
    if (difference !== 0 && note.length < 3) {
      throw new AppError('Alasan selisih wajib diisi (minimal 3 karakter)', 422);
    }

    const snapshot = {
      ...(deposit.snapshot ?? {}),
      status: 'completed',
      recipient_name: data.recipientName ?? deposit.recipient_name ?? null,
      note: note || null,
      totals: {
        ...(deposit.snapshot?.totals ?? {}),
        actual_cash: actual,
        difference,
      },
    };

    const { rows: updated } = await client.query(
      `UPDATE cash_deposits
          SET status = 'completed', amount = $2, actual_cash = $2,
              difference = $3, cashier_note = $4, recipient_name = $5,
              snapshot = $6, completed_at = now()
        WHERE id = $1
        RETURNING ${CASH_DEPOSIT_COLUMNS}`,
      [depositId, actual, difference, note || null, data.recipientName ?? null, snapshot]
    );

    await writeAudit({
      client,
      actorRole: actor.role,
      actorId: actor.id,
      businessId,
      action: 'cash_deposit.settlement_complete',
      entityType: 'cash_deposit',
      entityId: depositId,
      before: { status: 'draft' },
      after: { status: 'completed', actual_cash: actual, difference },
      ip,
    });

    return updated[0];
  });
};

/** Detail setoran + snapshot relasi (dipakai layar detail & cetak ulang). */
export const getCashDepositDetail = async ({
  businessId,
  depositId,
  restrictToOutletId = null,
}) => {
  const { rows } = await query(
     `SELECT d.*,
             o.name AS outlet_name,
             COALESCE(ca.full_name, ow.full_name) AS officer_name
        FROM cash_deposits d
       JOIN outlets o ON o.id = d.outlet_id
       LEFT JOIN cashiers ca ON ca.id = d.cashier_id
       LEFT JOIN owners ow ON ow.id = d.created_by_id AND d.created_by_role = 'owner'
      WHERE d.id = $1 AND d.business_id = $2
        AND ($3::uuid IS NULL OR d.outlet_id = $3)`,
    [depositId, businessId, restrictToOutletId]
  );
  const deposit = rows[0];
  if (!deposit) throw new NotFoundError('Setoran tidak ditemukan');

  const [tx, ex] = await Promise.all([
    query(
      `SELECT cdt.transaction_id AS id, cdt.invoice_no, cdt.method, cdt.amount,
              t.created_at
         FROM cash_deposit_transactions cdt
         LEFT JOIN transactions t ON t.id = cdt.transaction_id
        WHERE cdt.deposit_id = $1
        ORDER BY t.created_at ASC NULLS LAST, cdt.transaction_id ASC`,
      [depositId]
    ),
    query(
      `SELECT cde.expense_id AS id, cde.category, cde.method, cde.note,
              cde.amount, e.spent_on
         FROM cash_deposit_expenses cde
         LEFT JOIN expenses e ON e.id = cde.expense_id
        WHERE cde.deposit_id = $1
        ORDER BY e.spent_on ASC NULLS LAST, cde.expense_id ASC`,
      [depositId]
    ),
  ]);

  return { deposit, transactions: tx.rows, expenses: ex.rows };
};

/** Hapus DRAFT (belum pernah menjadi bukti setoran). */
export const deleteDraft = async ({
  businessId,
  depositId,
  actor,
  ip,
  restrictToCashierId = null,
  restrictToOutletId = null,
}) => {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT ${CASH_DEPOSIT_COLUMNS} FROM cash_deposits
        WHERE id = $1 AND business_id = $2 FOR UPDATE`,
      [depositId, businessId]
    );
    const deposit = rows[0];
    if (!deposit) throw new NotFoundError('Setoran tidak ditemukan');
    if (deposit.status !== 'draft') {
      throw new ConflictError('Setoran yang sudah SELESAI tidak dapat dihapus');
    }
    if (restrictToCashierId && deposit.created_by_id !== restrictToCashierId) {
      throw new ForbiddenError('Kasir hanya dapat menghapus draft miliknya');
    }
    if (restrictToOutletId && deposit.outlet_id !== restrictToOutletId) {
      throw new NotFoundError('Setoran tidak ditemukan');
    }

    await client.query(`DELETE FROM cash_deposits WHERE id = $1`, [depositId]);
    await writeAudit({
      client,
      actorRole: actor.role,
      actorId: actor.id,
      businessId,
      action: 'cash_deposit.draft_delete',
      entityType: 'cash_deposit',
      entityId: depositId,
      before: {
        status: 'draft',
        settlement_no: deposit.settlement_no,
        outlet_id: deposit.outlet_id,
      },
      ip,
    });
    return { id: depositId };
  });
};

/** Daftar setoran (Owner: bisnis; Kasir: outlet). */
export const listCashDeposits = async ({ businessId, filters = {} }) => {
  const biz = await getBusiness({ query }, businessId);

  const where = ['d.business_id = $1'];
  const values = [businessId];
  let i = 2;

  if (filters.outletId) {
    where.push(`d.outlet_id = $${i++}`);
    values.push(filters.outletId);
  }
  if (filters.cashierId) {
    where.push(`d.cashier_id = $${i++}`);
    values.push(filters.cashierId);
  }
  if (filters.status && filters.status !== 'all') {
    where.push(`d.status = $${i++}`);
    values.push(filters.status);
  }
  if (filters.from) {
    where.push(`d.deposited_on >= $${i++}::date`);
    values.push(filters.from);
  }
  if (filters.to) {
    where.push(`d.deposited_on <= $${i++}::date`);
    values.push(filters.to);
  }

  const whereSql = where.join(' AND ');
  const limit = filters.limit ?? 20;
  const page = filters.page ?? 1;

  const { rows } = await query(
    `SELECT d.id, d.outlet_id, o.name AS outlet_name, d.amount, d.method,
            d.note, d.receipt_url, d.status, d.deposited_on,
            d.cashier_id, d.created_by_role, d.created_by_id,
            d.voided_at, d.voided_by_role, d.voided_by_id, d.void_reason,
            d.settlement_no, d.period_start, d.period_end, d.shift_label,
            d.cash_revenue, d.qris_revenue, d.total_revenue, d.total_expense,
            d.cash_expense, d.noncash_expense, d.required_cash, d.actual_cash,
            d.difference, d.shortfall, d.cashier_note, d.recipient_name,
            d.completed_at, d.created_at, d.updated_at,
            COALESCE(ca.full_name, ow.full_name) AS officer_name,
            ca.full_name AS cashier_name
       FROM cash_deposits d
       JOIN outlets o ON o.id = d.outlet_id
       LEFT JOIN cashiers ca ON ca.id = d.cashier_id
       LEFT JOIN owners ow ON ow.id = d.created_by_id AND d.created_by_role = 'owner'
      WHERE ${whereSql}
      ORDER BY d.deposited_on DESC, d.created_at DESC, d.id DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, limit, (page - 1) * limit]
  );

  const count = await query(
    `SELECT count(*)::int AS n FROM cash_deposits d WHERE ${whereSql}`,
    values
  );

  const totals = await query(
    `SELECT
       COALESCE(SUM(d.amount) FILTER (WHERE d.status = 'recorded'), 0) AS recorded_total,
       COALESCE(SUM(d.amount) FILTER (WHERE d.status = 'voided'), 0) AS voided_total,
       COALESCE(SUM(d.amount) FILTER (WHERE d.status = 'completed'), 0) AS completed_total,
       COALESCE(SUM(d.amount) FILTER (WHERE d.status = 'draft'), 0) AS draft_total,
       COALESCE(SUM(d.cash_revenue) FILTER (WHERE d.status IN ('completed','recorded')), 0) AS cash_revenue,
       COALESCE(SUM(d.qris_revenue) FILTER (WHERE d.status IN ('completed','recorded')), 0) AS qris_revenue,
       COALESCE(SUM(d.total_revenue) FILTER (WHERE d.status IN ('completed','recorded')), 0) AS total_revenue,
       COALESCE(SUM(d.total_expense) FILTER (WHERE d.status IN ('completed','recorded')), 0) AS total_expense,
       COALESCE(SUM(d.actual_cash) FILTER (WHERE d.status IN ('completed','recorded')), 0) AS actual_cash,
       COALESCE(SUM(d.difference) FILTER (WHERE d.status IN ('completed','recorded')), 0) AS difference,
       count(*) FILTER (WHERE d.status = 'draft')::int AS draft_count,
       count(*) FILTER (WHERE d.status IN ('completed','recorded'))::int AS completed_count
       FROM cash_deposits d WHERE ${whereSql}`,
    values
  );

  const t = totals.rows[0];
  return {
    items: rows,
    total: count.rows[0].n,
    totals: {
      recorded_total: Number(t.recorded_total),
      voided_total: Number(t.voided_total),
      completed_total: Number(t.completed_total),
      draft_total: Number(t.draft_total),
      cash_revenue: Number(t.cash_revenue),
      qris_revenue: Number(t.qris_revenue),
      total_revenue: Number(t.total_revenue),
      total_expense: Number(t.total_expense),
      actual_cash: Number(t.actual_cash),
      difference: Number(t.difference),
      draft_count: t.draft_count,
      completed_count: t.completed_count,
    },
    business: { id: biz.id, timezone: biz.timezone },
  };
};

/** Rekap laporan setoran per hari/minggu/bulan (Owner). */
export const settlementReport = async ({ businessId, filters = {} }) => {
  const biz = await getBusiness({ query }, businessId);
  const group = filters.group ?? 'day';
  const expr =
    group === 'month'
      ? `date_trunc('month', d.deposited_on)::date`
      : group === 'week'
        ? `date_trunc('week', d.deposited_on)::date`
        : `d.deposited_on`;

  const where = [`d.business_id = $1`, `d.status IN ('completed','recorded')`];
  const values = [businessId];
  let i = 2;
  if (filters.outletId) {
    where.push(`d.outlet_id = $${i++}`);
    values.push(filters.outletId);
  }
  if (filters.cashierId) {
    where.push(`d.cashier_id = $${i++}`);
    values.push(filters.cashierId);
  }
  if (filters.from) {
    where.push(`d.deposited_on >= $${i++}::date`);
    values.push(filters.from);
  }
  if (filters.to) {
    where.push(`d.deposited_on <= $${i++}::date`);
    values.push(filters.to);
  }
  const whereSql = where.join(' AND ');

  const groups = await query(
    `SELECT ${expr} AS period,
            count(*)::int AS count,
            COALESCE(SUM(d.cash_revenue), 0) AS cash_revenue,
            COALESCE(SUM(d.qris_revenue), 0) AS qris_revenue,
            COALESCE(SUM(d.total_revenue), 0) AS total_revenue,
            COALESCE(SUM(d.total_expense), 0) AS total_expense,
            COALESCE(SUM(d.cash_expense), 0) AS cash_expense,
            COALESCE(SUM(d.required_cash), 0) AS required_cash,
            COALESCE(SUM(d.actual_cash), 0) AS actual_cash,
            COALESCE(SUM(d.difference), 0) AS difference,
            COALESCE(SUM(d.shortfall), 0) AS shortfall
       FROM cash_deposits d
      WHERE ${whereSql}
      GROUP BY 1
      ORDER BY 1 DESC`,
    values
  );

  const tot = await query(
    `SELECT count(*)::int AS count,
            COALESCE(SUM(d.cash_revenue), 0) AS cash_revenue,
            COALESCE(SUM(d.qris_revenue), 0) AS qris_revenue,
            COALESCE(SUM(d.total_revenue), 0) AS total_revenue,
            COALESCE(SUM(d.total_expense), 0) AS total_expense,
            COALESCE(SUM(d.cash_expense), 0) AS cash_expense,
            COALESCE(SUM(d.required_cash), 0) AS required_cash,
            COALESCE(SUM(d.actual_cash), 0) AS actual_cash,
            COALESCE(SUM(d.difference), 0) AS difference,
            COALESCE(SUM(d.shortfall), 0) AS shortfall
       FROM cash_deposits d WHERE ${whereSql}`,
    values
  );

  const map = (r) => ({
    count: Number(r.count),
    cash_revenue: Number(r.cash_revenue),
    qris_revenue: Number(r.qris_revenue),
    total_revenue: Number(r.total_revenue),
    total_expense: Number(r.total_expense),
    cash_expense: Number(r.cash_expense),
    required_cash: Number(r.required_cash),
    actual_cash: Number(r.actual_cash),
    difference: Number(r.difference),
    shortfall: Number(r.shortfall),
  });

  return {
    group,
    groups: groups.rows.map((r) => ({
      period: String(r.period),
      ...map(r),
    })),
    totals: map(tot.rows[0]),
    business: { id: biz.id, timezone: biz.timezone },
  };
};

/** Seluruh baris setoran pada filter (tanpa paginasi) untuk ekspor Excel. */
export const exportSettlementRows = async ({ businessId, filters = {} }) => {
  const biz = await getBusiness({ query }, businessId);
  const where = ['d.business_id = $1'];
  const values = [businessId];
  let i = 2;
  if (filters.outletId) {
    where.push(`d.outlet_id = $${i++}`);
    values.push(filters.outletId);
  }
  if (filters.cashierId) {
    where.push(`d.cashier_id = $${i++}`);
    values.push(filters.cashierId);
  }
  if (filters.status && filters.status !== 'all') {
    where.push(`d.status = $${i++}`);
    values.push(filters.status);
  }
  if (filters.from) {
    where.push(`d.deposited_on >= $${i++}::date`);
    values.push(filters.from);
  }
  if (filters.to) {
    where.push(`d.deposited_on <= $${i++}::date`);
    values.push(filters.to);
  }

  const { rows } = await query(
    `SELECT d.settlement_no, d.deposited_on, o.name AS outlet_name,
            COALESCE(ca.full_name, ow.full_name) AS officer_name,
            d.shift_label, d.status, d.cash_revenue, d.qris_revenue,
            d.total_revenue, d.total_expense, d.cash_expense, d.noncash_expense,
            d.required_cash, d.actual_cash, d.difference, d.shortfall,
            d.cashier_note, d.recipient_name, d.completed_at, d.created_at
       FROM cash_deposits d
       JOIN outlets o ON o.id = d.outlet_id
       LEFT JOIN cashiers ca ON ca.id = d.cashier_id
       LEFT JOIN owners ow ON ow.id = d.created_by_id AND d.created_by_role = 'owner'
      WHERE ${where.join(' AND ')}
      ORDER BY d.deposited_on ASC, d.created_at ASC`,
    values
  );
  return { rows, business: biz };
};

/** Monitoring Platform Admin lintas bisnis (read-only). */
export const listPlatformSettlements = async ({ filters = {} } = {}) => {
  const where = [];
  const values = [];
  let i = 1;
  if (filters.businessId) {
    where.push(`d.business_id = $${i++}`);
    values.push(filters.businessId);
  }
  if (filters.outletId) {
    where.push(`d.outlet_id = $${i++}`);
    values.push(filters.outletId);
  }
  if (filters.cashierId) {
    where.push(`d.cashier_id = $${i++}`);
    values.push(filters.cashierId);
  }
  if (filters.status && filters.status !== 'all') {
    where.push(`d.status = $${i++}`);
    values.push(filters.status);
  }
  if (filters.from) {
    where.push(`d.deposited_on >= $${i++}::date`);
    values.push(filters.from);
  }
  if (filters.to) {
    where.push(`d.deposited_on <= $${i++}::date`);
    values.push(filters.to);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = filters.limit ?? 20;
  const page = filters.page ?? 1;

  const { rows } = await query(
    `SELECT d.id, d.settlement_no, d.deposited_on, d.status, d.shift_label,
            d.business_id, b.name AS business_name,
            d.outlet_id, o.name AS outlet_name,
            d.cashier_id, COALESCE(ca.full_name, ow.full_name) AS officer_name,
            d.cash_revenue, d.qris_revenue, d.total_revenue, d.total_expense,
            d.required_cash, d.actual_cash, d.difference, d.shortfall,
            d.completed_at, d.created_at
       FROM cash_deposits d
       JOIN businesses b ON b.id = d.business_id
       JOIN outlets o ON o.id = d.outlet_id
       LEFT JOIN cashiers ca ON ca.id = d.cashier_id
       LEFT JOIN owners ow ON ow.id = d.created_by_id AND d.created_by_role = 'owner'
       ${whereSql}
      ORDER BY d.created_at DESC, d.id DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, limit, (page - 1) * limit]
  );

  const count = await query(
    `SELECT count(*)::int AS n FROM cash_deposits d ${whereSql}`,
    values
  );

  return { items: rows, total: count.rows[0].n };
};

// ---------------------------------------------------------------------------
// Legacy manual setoran (tetap didukung untuk kompatibilitas)
// ---------------------------------------------------------------------------

export const createCashDeposit = async ({ businessId, outletId, data, actor, ip }) => {
  return withTransaction(async (client) => {
    const biz = await getBusiness(client, businessId);
    if (biz.status !== 'active') {
      throw new ConflictError('Bisnis sedang nonaktif; tidak dapat mencatat setoran kas');
    }

    const outlet = await getOutlet(client, businessId, outletId);
    const today = await todayInTimezone(client, biz.timezone);
    const depositedOn = data.date ?? today;
    if (depositedOn > today) {
      throw new ConflictError('Tanggal setoran tidak boleh melebihi hari ini');
    }

    const { rows } = await client.query(
      `INSERT INTO cash_deposits
         (business_id, outlet_id, amount, method, note, receipt_url,
          status, deposited_on, cashier_id, created_by_role, created_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,'recorded',$7,$8,$9,$10)
       RETURNING ${CASH_DEPOSIT_COLUMNS}`,
      [
        businessId,
        outletId,
        data.amount,
        data.method,
        data.note ?? null,
        data.receiptUrl ?? null,
        depositedOn,
        actor.role === 'cashier' ? actor.id : null,
        actor.role,
        actor.id,
      ]
    );
    const deposit = rows[0];

    await writeAudit({
      client,
      actorRole: actor.role,
      actorId: actor.id,
      businessId,
      action: 'cash_deposit.create',
      entityType: 'cash_deposit',
      entityId: deposit.id,
      after: {
        outlet_id: outletId,
        amount: data.amount,
        method: data.method,
        deposited_on: depositedOn,
      },
      ip,
    });

    return { deposit, outlet_name: outlet.name };
  });
};

export const voidCashDeposit = async (
  { businessId, depositId, reason, actor, ip },
  { restrictToCashierId = null, restrictToOutletId = null } = {}
) => {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT ${CASH_DEPOSIT_COLUMNS} FROM cash_deposits
        WHERE id = $1 AND business_id = $2 FOR UPDATE`,
      [depositId, businessId]
    );
    const deposit = rows[0];
    if (!deposit) throw new NotFoundError('Setoran kas tidak ditemukan');
    if (restrictToOutletId && deposit.outlet_id !== restrictToOutletId) {
      throw new NotFoundError('Setoran kas tidak ditemukan');
    }
    if (deposit.status === 'voided') {
      throw new ConflictError('Setoran kas ini sudah dibatalkan');
    }
    if (restrictToCashierId && deposit.created_by_id !== restrictToCashierId) {
      throw new ForbiddenError('Kasir hanya dapat membatalkan setoran yang ia catat');
    }

    const { rows: updated } = await client.query(
      `UPDATE cash_deposits
          SET status = 'voided', voided_at = now(), voided_by_role = $2,
              voided_by_id = $3, void_reason = $4
        WHERE id = $1
        RETURNING ${CASH_DEPOSIT_COLUMNS}`,
      [depositId, actor.role, actor.id, reason]
    );

    // Lepaskan relasi agar transaksi/pengeluaran bisa masuk setoran koreksi.
    await client.query(
      `UPDATE cash_deposit_transactions SET is_active = false WHERE deposit_id = $1`,
      [depositId]
    );
    await client.query(
      `UPDATE cash_deposit_expenses SET is_active = false WHERE deposit_id = $1`,
      [depositId]
    );

    await writeAudit({
      client,
      actorRole: actor.role,
      actorId: actor.id,
      businessId,
      action: 'cash_deposit.void',
      entityType: 'cash_deposit',
      entityId: depositId,
      before: { status: deposit.status, amount: Number(deposit.amount) },
      after: { status: 'voided', reason },
      ip,
    });

    return updated[0];
  });
};

export default {
  CASH_DEPOSIT_COLUMNS,
  DONE_STATUSES,
  SHIFT_WINDOWS,
  resolvePeriod,
  computeSettlement,
  previewSettlement,
  createSettlement,
  completeSettlement,
  getCashDepositDetail,
  deleteDraft,
  listCashDeposits,
  settlementReport,
  exportSettlementRows,
  listPlatformSettlements,
  createCashDeposit,
  voidCashDeposit,
};
