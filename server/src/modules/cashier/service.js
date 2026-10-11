/**
 * Layanan modul kasir (dikelola Owner, scoped business_id via outlet).
 *
 * Aturan:
 *   - 1 kasir = 1 outlet: `outlet_id` NOT NULL dan milik bisnis sesi.
 *   - Email UNIQUE (case-insensitive, index DB) => satu akun tidak bisa
 *     didaftarkan ke dua outlet (kriteria selesai Fase 5).
 *   - Membuat kasir melewati gerbang kuota langganan (`enforceCashierQuota`)
 *     di transaksi yang sama + baris bisnis dikunci FOR UPDATE.
 *   - Suspend / reset password mencabut SEMUA sesi kasir (di transaksi sama).
 *   - Semua operasi memverifikasi `business_id` (defense-in-depth) selain
 *     middleware tenant.
 */
import { query, withTransaction } from '../../config/db.js';
import { NotFoundError, ConflictError } from '../../middleware/error.js';
import { hashPassword, hashPin } from '../../utils/hash.js';
import { enforceCashierQuota } from '../subscription/service.js';
import { writeAudit } from '../audit/service.js';

export const CASHIER_COLUMNS = `id, outlet_id, email, full_name, status, created_by, created_at, updated_at`;

const auditShape = (c, outletName) =>
  c
    ? {
        id: c.id,
        outlet_id: c.outlet_id,
        outlet_name: outletName ?? null,
        email: c.email,
        full_name: c.full_name,
        status: c.status,
      }
    : null;

/** Daftar kasir milik sebuah bisnis (ikut nama outlet). */
export const listCashiers = async (businessId) => {
  const { rows } = await query(
    `SELECT c.id, c.outlet_id, c.email, c.full_name, c.status,
            c.created_by, c.created_at, c.updated_at, o.name AS outlet_name
       FROM cashiers c
       JOIN outlets o ON o.id = c.outlet_id
      WHERE o.business_id = $1
      ORDER BY c.created_at DESC`,
    [businessId]
  );
  return rows;
};

/** Buat kasir — gerbang kuota langganan wajib lulus. */
export const createCashier = async ({ businessId, data, actor, ip }) => {
  try {
    return await withTransaction(async (client) => {
      const biz = await client.query(
        `SELECT id, status FROM businesses
          WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [businessId]
      );
      if (!biz.rows[0]) throw new NotFoundError('Bisnis tidak ditemukan');
      if (biz.rows[0].status !== 'active') {
        throw new ConflictError('Bisnis sedang nonaktif; tidak dapat membuat kasir');
      }

      // Outlet harus milik bisnis sesi ini.
      const outlet = await client.query(
        `SELECT id, name FROM outlets
          WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
        [data.outletId, businessId]
      );
      if (!outlet.rows[0]) throw new NotFoundError('Outlet tidak ditemukan');

      await enforceCashierQuota(client, businessId);

      const pinHash = data.pin ? await hashPin(data.pin) : null;
      const passwordHash = await hashPassword(data.password);

      const { rows } = await client.query(
        `INSERT INTO cashiers (outlet_id, email, password_hash, pin_hash, full_name, status, created_by)
         VALUES ($1, $2, $3, $4, $5, 'active', $6)
         RETURNING ${CASHIER_COLUMNS}`,
        [data.outletId, data.email, passwordHash, pinHash, data.fullName, actor.id]
      );
      const cashier = rows[0];

      await writeAudit({
        client,
        actorRole: actor.role,
        actorId: actor.id,
        businessId,
        action: 'cashier.create',
        entityType: 'cashier',
        entityId: cashier.id,
        after: auditShape(cashier, outlet.rows[0].name),
        ip,
      });

      return cashier;
    });
  } catch (err) {
    throw mapUniqueConflict(err);
  }
};

/** Detail kasir (dipastikan milik bisnis sesi). */
export const getCashier = async (businessId, cashierId) => {
  const { rows } = await query(
    `SELECT c.id, c.outlet_id, c.email, c.full_name, c.status,
            c.created_by, c.created_at, c.updated_at, o.name AS outlet_name
       FROM cashiers c
       JOIN outlets o ON o.id = c.outlet_id
      WHERE c.id = $1 AND o.business_id = $2`,
    [cashierId, businessId]
  );
  if (!rows[0]) throw new NotFoundError('Kasir tidak ditemukan');
  return rows[0];
};

/** Ubah data kasir (nama & PIN). */
export const updateCashier = async (businessId, cashierId, patch, actor, ip) => {
  return withTransaction(async (client) => {
    const { rows: currentRows } = await client.query(
      `SELECT c.id, c.outlet_id, c.email, c.full_name, c.status, o.name AS outlet_name
         FROM cashiers c
         JOIN outlets o ON o.id = c.outlet_id
        WHERE c.id = $1 AND o.business_id = $2
        FOR UPDATE`,
      [cashierId, businessId]
    );
    const before = currentRows[0];
    if (!before) throw new NotFoundError('Kasir tidak ditemukan');

    const fields = [];
    const values = [];
    let i = 1;
    if (patch.fullName !== undefined) {
      fields.push(`full_name = $${i++}`);
      values.push(patch.fullName);
    }
    if (patch.pin !== undefined) {
      fields.push(`pin_hash = $${i++}`);
      values.push(await hashPin(patch.pin));
    }
    if (fields.length === 0) return before;

    values.push(cashierId);
    const { rows } = await client.query(
      `UPDATE cashiers SET ${fields.join(', ')} WHERE id = $${i}
       RETURNING ${CASHIER_COLUMNS}`,
      values
    );

    await writeAudit({
      client,
      actorRole: actor.role,
      actorId: actor.id,
      businessId,
      action: 'cashier.update',
      entityType: 'cashier',
      entityId: cashierId,
      before: auditShape(before),
      after: auditShape(rows[0]),
      ip,
    });

    return rows[0];
  });
};

/** Suspend / aktivasi kasir; suspend mencabut semua sesinya. */
export const setCashierStatus = async (businessId, cashierId, status, actor, ip) => {
  return withTransaction(async (client) => {
    const { rows: currentRows } = await client.query(
      `SELECT c.id, c.status, o.name AS outlet_name, o.business_id
         FROM cashiers c
         JOIN outlets o ON o.id = c.outlet_id
        WHERE c.id = $1 AND o.business_id = $2
        FOR UPDATE`,
      [cashierId, businessId]
    );
    const current = currentRows[0];
    if (!current) throw new NotFoundError('Kasir tidak ditemukan');

    const { rows } = await client.query(
      `UPDATE cashiers SET status = $1 WHERE id = $2
       RETURNING ${CASHIER_COLUMNS}`,
      [status, cashierId]
    );

    if (status === 'suspended') {
      await revokeCashierSessions(client, cashierId);
    }

    await writeAudit({
      client,
      actorRole: actor.role,
      actorId: actor.id,
      businessId,
      action: 'cashier.status_change',
      entityType: 'cashier',
      entityId: cashierId,
      before: { status: current.status },
      after: { status },
      ip,
    });

    return rows[0];
  });
};

/** Reset password kasir; semua sesi lama dicabut. */
export const resetCashierPassword = async (businessId, cashierId, newPassword, actor, ip) => {
  return withTransaction(async (client) => {
    const found = await client.query(
      `SELECT c.id, o.business_id
         FROM cashiers c
         JOIN outlets o ON o.id = c.outlet_id
        WHERE c.id = $1 AND o.business_id = $2
        FOR UPDATE`,
      [cashierId, businessId]
    );
    if (!found.rows[0]) throw new NotFoundError('Kasir tidak ditemukan');

    const passwordHash = await hashPassword(newPassword);
    await client.query(`UPDATE cashiers SET password_hash = $1 WHERE id = $2`, [
      passwordHash,
      cashierId,
    ]);
    await revokeCashierSessions(client, cashierId);

    await writeAudit({
      client,
      actorRole: actor.role,
      actorId: actor.id,
      businessId,
      action: 'cashier.password_reset',
      entityType: 'cashier',
      entityId: cashierId,
      after: { password_changed: true },
      ip,
    });

    return { id: cashierId, password_changed: true };
  });
};

/** Cabut semua sesi kasir di dalam transaksi pemanggil. */
const revokeCashierSessions = (client, cashierId) =>
  client.query(
    `UPDATE refresh_tokens
        SET revoked_at = now()
      WHERE user_role = 'cashier' AND user_id = $1 AND revoked_at IS NULL`,
    [cashierId]
  );

const mapUniqueConflict = (err) =>
  err?.code === '23505'
    ? new ConflictError('Email sudah digunakan oleh kasir lain')
    : err;

export default {
  listCashiers,
  createCashier,
  getCashier,
  updateCashier,
  setCashierStatus,
  resetCashierPassword,
};