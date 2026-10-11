/**
 * Modul sesi — daftar sesi aktif & pencabutan paksa (Fase 11).
 *
 * - Sesi = baris `refresh_tokens` (hash token, sekali pakai dengan rotasi).
 *   Mencabut = `revoked_at` diisi; token lama langsung ditolak `/refresh`.
 * - Access token JWT berumur pendek (15 mnt) tidak bisa dicabut satu per satu
 *   tanpa blacklist; efek "paksa logout" berlaku penuh saat refresh berikutnya.
 * - Pencabutan dicatat ke audit (`session.revoke_all`) di transaksi yang sama.
 */
import { query, withTransaction } from '../../config/db.js';
import { NotFoundError } from '../../middleware/error.js';
import { writeAudit } from '../audit/service.js';

/** Admin: daftar kasir + jumlah sesi aktif (untuk manajemen terpusat). */
export const listCashierSessions = async ({ limit = 100 }) => {
  const { rows } = await query(
    `SELECT c.id, c.full_name, c.email, c.status,
            o.name AS outlet_name, o.business_id, b.name AS business_name,
            COUNT(rt.id) FILTER (
              WHERE rt.revoked_at IS NULL AND rt.expires_at > now()
            ) AS active_count,
            MAX(rt.created_at) FILTER (
              WHERE rt.revoked_at IS NULL AND rt.expires_at > now()
            ) AS last_active_at
       FROM cashiers c
       JOIN outlets o ON o.id = c.outlet_id
       JOIN businesses b ON b.id = o.business_id
       LEFT JOIN refresh_tokens rt
              ON rt.user_role = 'cashier' AND rt.user_id = c.id
      WHERE o.deleted_at IS NULL AND b.deleted_at IS NULL
      GROUP BY c.id, o.name, o.business_id, b.name
      ORDER BY last_active_at DESC NULLS LAST, c.created_at DESC
      LIMIT $1`,
    [limit]
  );
  return rows;
};

/** Verifikasi kasir milik bisnis (defense-in-depth selain middleware tenant). */
const getCashierInBusiness = async (cashierId, businessId) => {
  const { rows } = await query(
    `SELECT c.id, c.full_name, o.business_id
       FROM cashiers c
       JOIN outlets o ON o.id = c.outlet_id
      WHERE c.id = $1 AND o.business_id = $2`,
    [cashierId, businessId]
  );
  if (!rows[0]) throw new NotFoundError('Kasir tidak ditemukan');
  return rows[0];
};

/** Owner: daftar sesi milik satu kasir (baris refresh token terbaru dahulu). */
export const listSessionsByCashier = async ({ cashierId, businessId, limit = 25 }) => {
  await getCashierInBusiness(cashierId, businessId);
  const { rows } = await query(
    `SELECT id, created_at, expires_at, revoked_at, ip, user_agent
       FROM refresh_tokens
      WHERE user_role = 'cashier' AND user_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [cashierId, limit]
  );
  return rows;
};

/**
 * Cabut SEMUA sesi kasir (aktif ataupun kedaluwarsa yang belum dicabut).
 * Berlaku langsung di server: refresh token lama akan ditolak.
 */
const revokeAll = async ({ cashierId, businessId, actor, ip }) => {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE refresh_tokens
          SET revoked_at = now()
        WHERE user_role = 'cashier' AND user_id = $1 AND revoked_at IS NULL
        RETURNING id`,
      [cashierId]
    );

    await writeAudit({
      client,
      actorRole: actor.role,
      actorId: actor.id,
      businessId,
      action: 'session.revoke_all',
      entityType: 'cashier',
      entityId: cashierId,
      before: { active_sessions: rows.length },
      after: { active_sessions: 0 },
      ip,
    });

    return { revoked: rows.length };
  });
};

/** Admin: cabut sesi kasir lintas bisnis (need business context utk audit). */
export const revokeCashierByAdmin = async ({ cashierId, actor, ip }) => {
  const { rows } = await query(
    `SELECT c.id, c.full_name, o.business_id
       FROM cashiers c
       JOIN outlets o ON o.id = c.outlet_id
      WHERE c.id = $1`,
    [cashierId]
  );
  if (!rows[0]) throw new NotFoundError('Kasir tidak ditemukan');
  return revokeAll({ cashierId, businessId: rows[0].business_id, actor, ip });
};

/** Owner: cabut sesi kasir milik bisnisnya. */
export const revokeCashierByOwner = async ({ businessId, cashierId, actor, ip }) => {
  await getCashierInBusiness(cashierId, businessId);
  return revokeAll({ cashierId, businessId, actor, ip });
};

export default {
  listCashierSessions,
  listSessionsByCashier,
  revokeCashierByAdmin,
  revokeCashierByOwner,
};