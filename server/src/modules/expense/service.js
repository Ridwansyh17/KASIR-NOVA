/**
 * Layanan modul pengeluaran outlet (Fase 5).
 *
 * Aturan:
 *   - Nominal SEN (BIGINT/INTEGER), selalu > 0.
 *   - Riwayat finansial TIDAK PERNAH dihapus: pembatalan memakai status
 *     'recorded' -> 'voided' + alasan + pelaku (audit log).
 *   - Kasir hanya boleh MEMBATALKAN catatannya sendiri; Owner boleh semua.
 *   - `spent_on` (DATE) dihitung di ZONA WAKTU BISNIS dan tidak boleh melebihi
 *     hari ini; dipakai sebagai dasar laporan (bukan `created_at`).
 *   - Kategori `inventory_purchase` adalah pembelian persediaan dagang: TIDAK
 *     dihitung sebagai biaya operasional pada laba bersih (HPP sudah menutup
 *     biaya barang terjual) sehingga tidak terjadi penghitungan ganda.
 */
import { query, withTransaction } from '../../config/db.js';
import { NotFoundError, ConflictError, ForbiddenError } from '../../middleware/error.js';
import { writeAudit } from '../audit/service.js';

export const EXPENSE_COLUMNS = `id, business_id, outlet_id, category, amount, method,
  note, receipt_url, status, spent_on, cashier_id, created_by_role, created_by_id,
  voided_at, voided_by_role, voided_by_id, void_reason, created_at, updated_at`;

/** Kategori yang dihitung sebagai biaya operasional pada laba bersih. */
export const OPERATING_EXPENSE_PREDICATE = `category <> 'inventory_purchase'`;

const getBusiness = async (db, businessId) => {
  const { rows } = await db.query(
    `SELECT id, name, timezone, status FROM businesses
      WHERE id = $1 AND deleted_at IS NULL`,
    [businessId]
  );
  if (!rows[0]) throw new NotFoundError('Bisnis tidak ditemukan');
  return rows[0];
};

/** Tanggal hari ini pada zona waktu bisnis (`YYYY-MM-DD`). */
export const todayInTimezone = async (db, timezone) => {
  const { rows } = await db.query(
    `SELECT (now() AT TIME ZONE $1::text)::date::text AS today`,
    [timezone]
  );
  return rows[0].today;
};

export const createExpense = async ({ businessId, outletId, data, actor, ip }) => {
  return withTransaction(async (client) => {
    const biz = await getBusiness(client, businessId);
    if (biz.status !== 'active') {
      throw new ConflictError('Bisnis sedang nonaktif; tidak dapat mencatat pengeluaran');
    }

    const outlet = await client.query(
      `SELECT id, name FROM outlets
        WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
      [outletId, businessId]
    );
    if (!outlet.rows[0]) throw new NotFoundError('Outlet tidak ditemukan');

    const today = await todayInTimezone(client, biz.timezone);
    const spentOn = data.date ?? today;
    if (spentOn > today) {
      throw new ConflictError('Tanggal pengeluaran tidak boleh melebihi hari ini');
    }

    const { rows } = await client.query(
      `INSERT INTO expenses
         (business_id, outlet_id, category, amount, method, note, receipt_url,
          status, spent_on, cashier_id, created_by_role, created_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'recorded',$8,$9,$10,$11)
       RETURNING ${EXPENSE_COLUMNS}`,
      [
        businessId,
        outletId,
        data.category,
        data.amount,
        data.method,
        data.note ?? null,
        data.receiptUrl ?? null,
        spentOn,
        actor.role === 'cashier' ? actor.id : null,
        actor.role,
        actor.id,
      ]
    );
    const expense = rows[0];

    await writeAudit({
      client,
      actorRole: actor.role,
      actorId: actor.id,
      businessId,
      action: 'expense.create',
      entityType: 'expense',
      entityId: expense.id,
      after: {
        outlet_id: outletId,
        category: data.category,
        amount: data.amount,
        method: data.method,
        spent_on: spentOn,
      },
      ip,
    });

    return { expense, outlet_name: outlet.rows[0].name };
  });
};

/** Daftar pengeluaran (Owner: seluruh bisnis; Kasir: outletnya). */
export const listExpenses = async ({ businessId, filters }) => {
  const biz = await getBusiness({ query }, businessId);

  const where = ['e.business_id = $1'];
  const values = [businessId];
  let i = 2;

  if (filters.outletId) {
    where.push(`e.outlet_id = $${i++}`);
    values.push(filters.outletId);
  }
  if (filters.cashierId) {
    where.push(`e.cashier_id = $${i++}`);
    values.push(filters.cashierId);
  }
  if (filters.category) {
    where.push(`e.category = $${i++}`);
    values.push(filters.category);
  }
  if (filters.status) {
    where.push(`e.status = $${i++}`);
    values.push(filters.status);
  }
  if (filters.from) {
    where.push(`e.spent_on >= $${i++}::date`);
    values.push(filters.from);
  }
  if (filters.to) {
    where.push(`e.spent_on <= $${i++}::date`);
    values.push(filters.to);
  }

  const whereSql = where.join(' AND ');

  const { rows } = await query(
    `SELECT e.id, e.outlet_id, o.name AS outlet_name, e.category, e.amount,
            e.method, e.note, e.receipt_url, e.status, e.spent_on,
            e.cashier_id, e.created_by_role, e.created_by_id,
            e.voided_at, e.voided_by_role, e.voided_by_id, e.void_reason,
            e.created_at, e.updated_at,
            COALESCE(ca.full_name, ow.full_name) AS officer_name
       FROM expenses e
       JOIN outlets o ON o.id = e.outlet_id
       LEFT JOIN cashiers ca ON ca.id = e.cashier_id
       LEFT JOIN owners ow ON ow.id = e.created_by_id AND e.created_by_role = 'owner'
      WHERE ${whereSql}
      ORDER BY e.spent_on DESC, e.created_at DESC, e.id DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, filters.limit, (filters.page - 1) * filters.limit]
  );

  const count = await query(
    `SELECT count(*)::int AS n FROM expenses e WHERE ${whereSql}`,
    values
  );

  const totals = await query(
    `SELECT COALESCE(SUM(e.amount) FILTER (WHERE e.${OPERATING_EXPENSE_PREDICATE}), 0) AS operating_total,
            COALESCE(SUM(e.amount) FILTER (WHERE e.category = 'inventory_purchase'), 0) AS inventory_total,
            COALESCE(SUM(e.amount), 0) AS total
       FROM expenses e WHERE ${whereSql}`,
    values
  );

  return {
    items: rows,
    total: count.rows[0].n,
    totals: {
      operating_total: Number(totals.rows[0].operating_total),
      inventory_total: Number(totals.rows[0].inventory_total),
      total: Number(totals.rows[0].total),
    },
    business: { id: biz.id, timezone: biz.timezone },
  };
};

/**
 * Batalkan (void) pengeluaran — TIDAK menghapus baris.
 * @param {{ restrictToCashierId?: string|null }} opts - kasir hanya boleh
 *   membatalkan catatannya sendiri.
 */
export const voidExpense = async (
  { businessId, expenseId, reason, actor, ip },
  { restrictToCashierId = null } = {}
) => {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT ${EXPENSE_COLUMNS} FROM expenses
        WHERE id = $1 AND business_id = $2 FOR UPDATE`,
      [expenseId, businessId]
    );
    const expense = rows[0];
    if (!expense) throw new NotFoundError('Pengeluaran tidak ditemukan');
    if (expense.status === 'voided') {
      throw new ConflictError('Pengeluaran ini sudah dibatalkan');
    }
    if (restrictToCashierId && expense.created_by_id !== restrictToCashierId) {
      throw new ForbiddenError('Kasir hanya dapat membatalkan pengeluaran yang ia catat');
    }

    const { rows: updated } = await client.query(
      `UPDATE expenses
          SET status = 'voided', voided_at = now(), voided_by_role = $2,
              voided_by_id = $3, void_reason = $4
        WHERE id = $1
        RETURNING ${EXPENSE_COLUMNS}`,
      [expenseId, actor.role, actor.id, reason]
    );

    await writeAudit({
      client,
      actorRole: actor.role,
      actorId: actor.id,
      businessId,
      action: 'expense.void',
      entityType: 'expense',
      entityId: expenseId,
      before: { status: expense.status, amount: Number(expense.amount) },
      after: { status: 'voided', reason },
      ip,
    });

    return updated[0];
  });
};

/**
 * Total pengeluaran pada rentang tanggal (dasar `spent_on`, zona bisnis).
 * Hanya status 'recorded' yang dihitung.
 * @returns {{operating_total:number, inventory_total:number, total:number, entries:number}}
 */
export const expensesInRange = async (
  db,
  { businessId, outletId = null, from, to }
) => {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(e.amount) FILTER (WHERE e.${OPERATING_EXPENSE_PREDICATE}), 0) AS operating_total,
            COALESCE(SUM(e.amount) FILTER (WHERE e.category = 'inventory_purchase'), 0) AS inventory_total,
            COALESCE(SUM(e.amount), 0) AS total,
            count(*)::int AS entries
       FROM expenses e
      WHERE e.business_id = $1
        AND e.status = 'recorded'
        AND e.spent_on >= $2::date
        AND e.spent_on <= $3::date
        AND ($4::uuid IS NULL OR e.outlet_id = $4)`,
    [businessId, from, to, outletId]
  );
  const r = rows[0];
  return {
    operating_total: Number(r.operating_total),
    inventory_total: Number(r.inventory_total),
    total: Number(r.total),
    entries: r.entries,
  };
};

export const expensesByCategory = async (db, { businessId, outletId = null, from, to }) => {
  const { rows } = await db.query(
    `SELECT e.category,
            COALESCE(SUM(e.amount), 0) AS total,
            count(*)::int AS entries
       FROM expenses e
      WHERE e.business_id = $1 AND e.status = 'recorded'
        AND e.spent_on >= $3 AND e.spent_on <= $4
        AND ($2::uuid IS NULL OR e.outlet_id = $2)
      GROUP BY e.category
      ORDER BY total DESC, e.category ASC`,
    [businessId, outletId, from, to]
  );
  return rows.map((r) => ({
    category: r.category,
    total: Number(r.total),
    entries: r.entries,
    counts_as_operating: r.category !== 'inventory_purchase',
  }));
};

/**
 * Seluruh baris pengeluaran pada rentang tanggal (tanpa paginasi) untuk
 * ekspor Excel. Bila `filters.status` diisi, difilter; jika tidak, semua
 * status disertakan (termasuk `voided`) agar riwayat pembatalan tetap terlihat.
 */
export const exportExpenseRows = async ({ businessId, filters = {} }) => {
  const where = ['e.business_id = $1'];
  const values = [businessId];
  let i = 2;
  if (filters.outletId) {
    where.push(`e.outlet_id = $${i++}`);
    values.push(filters.outletId);
  }
  if (filters.cashierId) {
    where.push(`e.cashier_id = $${i++}`);
    values.push(filters.cashierId);
  }
  if (filters.category) {
    where.push(`e.category = $${i++}`);
    values.push(filters.category);
  }
  if (filters.status) {
    where.push(`e.status = $${i++}`);
    values.push(filters.status);
  }
  if (filters.from) {
    where.push(`e.spent_on >= $${i++}::date`);
    values.push(filters.from);
  }
  if (filters.to) {
    where.push(`e.spent_on <= $${i++}::date`);
    values.push(filters.to);
  }

  const { rows } = await query(
    `SELECT e.id, e.spent_on, o.name AS outlet_name, e.category, e.amount,
            e.method, e.note, e.status, e.voided_at, e.void_reason,
            e.cashier_id, e.created_by_role, e.created_by_id, e.created_at,
            COALESCE(ca.full_name, ow.full_name) AS officer_name
       FROM expenses e
       JOIN outlets o ON o.id = e.outlet_id
       LEFT JOIN cashiers ca ON ca.id = e.cashier_id
       LEFT JOIN owners ow ON ow.id = e.created_by_id AND e.created_by_role = 'owner'
      WHERE ${where.join(' AND ')}
      ORDER BY e.spent_on ASC, e.created_at ASC`,
    values
  );
  return rows;
};

export default {
  createExpense,
  listExpenses,
  voidExpense,
  expensesInRange,
  expensesByCategory,
  exportExpenseRows,
  todayInTimezone,
};
