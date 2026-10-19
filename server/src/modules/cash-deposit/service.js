/**
 * Layanan modul setoran kas (Fase lanjutan — migrasi 0011).
 *
 * Aturan:
 *   - Nominal SEN (BIGINT), selalu > 0.
 *   - Riwayat finansial TIDAK PERNAH dihapus: pembatalan memakai status
 *     'recorded' -> 'voided' + alasan + pelaku (audit log).
 *   - Kasir hanya boleh MEMBATALKAN catatannya sendiri; Owner boleh semua.
 *   - `deposited_on` (DATE) dihitung di ZONA WAKTU BISNIS dan tidak boleh
 *     melebihi hari ini.
 *   - Setoran kas adalah PERPINDAHAN uang tunai (kas kasir -> Owner), bukan
 *     pendapatan maupun beban: TIDAK memengaruhi laba/rugi pada laporan.
 */
import { query, withTransaction } from '../../config/db.js';
import { NotFoundError, ConflictError, ForbiddenError } from '../../middleware/error.js';
import { writeAudit } from '../audit/service.js';
import { todayInTimezone } from '../expense/service.js';

export const CASH_DEPOSIT_COLUMNS = `id, business_id, outlet_id, amount, method,
  note, receipt_url, status, deposited_on, cashier_id, created_by_role,
  created_by_id, voided_at, voided_by_role, voided_by_id, void_reason,
  created_at, updated_at`;

const getBusiness = async (db, businessId) => {
  const { rows } = await db.query(
    `SELECT id, name, timezone, status FROM businesses
      WHERE id = $1 AND deleted_at IS NULL`,
    [businessId]
  );
  if (!rows[0]) throw new NotFoundError('Bisnis tidak ditemukan');
  return rows[0];
};

export const createCashDeposit = async ({ businessId, outletId, data, actor, ip }) => {
  return withTransaction(async (client) => {
    const biz = await getBusiness(client, businessId);
    if (biz.status !== 'active') {
      throw new ConflictError('Bisnis sedang nonaktif; tidak dapat mencatat setoran kas');
    }

    const outlet = await client.query(
      `SELECT id, name FROM outlets
        WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
      [outletId, businessId]
    );
    if (!outlet.rows[0]) throw new NotFoundError('Outlet tidak ditemukan');

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

    return { deposit, outlet_name: outlet.rows[0].name };
  });
};

/** Daftar setoran kas (Owner: seluruh bisnis; Kasir: outletnya). */
export const listCashDeposits = async ({ businessId, filters }) => {
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
  if (filters.status) {
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

  const { rows } = await query(
    `SELECT d.id, d.outlet_id, o.name AS outlet_name, d.amount, d.method,
            d.note, d.receipt_url, d.status, d.deposited_on,
            d.cashier_id, d.created_by_role, d.created_by_id,
            d.voided_at, d.voided_by_role, d.voided_by_id, d.void_reason,
            d.created_at, d.updated_at,
            COALESCE(ca.full_name, ow.full_name) AS officer_name
       FROM cash_deposits d
       JOIN outlets o ON o.id = d.outlet_id
       LEFT JOIN cashiers ca ON ca.id = d.cashier_id
       LEFT JOIN owners ow ON ow.id = d.created_by_id AND d.created_by_role = 'owner'
      WHERE ${whereSql}
      ORDER BY d.deposited_on DESC, d.created_at DESC, d.id DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, filters.limit, (filters.page - 1) * filters.limit]
  );

  const count = await query(
    `SELECT count(*)::int AS n FROM cash_deposits d WHERE ${whereSql}`,
    values
  );

  const totals = await query(
    `SELECT COALESCE(SUM(d.amount) FILTER (WHERE d.status = 'recorded'), 0) AS recorded_total,
            COALESCE(SUM(d.amount) FILTER (WHERE d.status = 'voided'), 0) AS voided_total
       FROM cash_deposits d WHERE ${whereSql}`,
    values
  );

  return {
    items: rows,
    total: count.rows[0].n,
    totals: {
      recorded_total: Number(totals.rows[0].recorded_total),
      voided_total: Number(totals.rows[0].voided_total),
    },
    business: { id: biz.id, timezone: biz.timezone },
  };
};

/**
 * Batalkan (void) setoran kas — TIDAK menghapus baris.
 * @param {{ restrictToCashierId?: string|null }} opts - kasir hanya boleh
 *   membatalkan catatannya sendiri.
 */
export const voidCashDeposit = async (
  { businessId, depositId, reason, actor, ip },
  { restrictToCashierId = null } = {}
) => {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT ${CASH_DEPOSIT_COLUMNS} FROM cash_deposits
        WHERE id = $1 AND business_id = $2 FOR UPDATE`,
      [depositId, businessId]
    );
    const deposit = rows[0];
    if (!deposit) throw new NotFoundError('Setoran kas tidak ditemukan');
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
  createCashDeposit,
  listCashDeposits,
  voidCashDeposit,
};
