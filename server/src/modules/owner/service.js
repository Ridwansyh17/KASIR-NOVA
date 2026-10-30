/**
 * Layanan modul owner — pengelolaan bisnis milik Owner.
 *
 * Semua operasi dibatasi `owner_id` pemanggil (defense-in-depth selain
 * middleware tenant). Setiap mutasi menulis audit log dengan `business_id`.
 */
import { query, withTransaction } from '../../config/db.js';
import { NotFoundError } from '../../middleware/error.js';
import { writeAudit } from '../audit/service.js';
import { createDefaultSubscription, createTrialSubscription } from '../subscription/service.js';

const BUSINESS_COLUMNS = `id, owner_id, name, business_type, currency, timezone, status, created_at, updated_at`;

/** Daftar bisnis milik seorang owner. */
export const listBusinesses = async (ownerId) => {
  const { rows } = await query(
    `SELECT ${BUSINESS_COLUMNS}
       FROM businesses
      WHERE owner_id = $1 AND deleted_at IS NULL
      ORDER BY created_at DESC`,
    [ownerId]
  );
  return rows;
};

/**
 * Buat bisnis + langganan default di dalam transaksi milik pemanggil.
 * Dipakai `createBusiness` (panel Owner), verifikasi pendaftaran mandiri,
 * dan verifikasi Admin via WhatsApp (bisnis pertama + langganan Gratis atomik).
 */
export const createBusinessInTransaction = async (
  client,
  { ownerId, name, businessType, currency, timezone, actor, ip, initialSubscription = null }
) => {
  const { rows } = await client.query(
    `INSERT INTO businesses (owner_id, name, business_type, currency, timezone, status)
     VALUES ($1, $2, $3, COALESCE($4, 'IDR'), COALESCE($5, 'Asia/Jakarta'), 'active')
     RETURNING ${BUSINESS_COLUMNS}`,
    [ownerId, name, businessType ?? null, currency ?? null, timezone ?? null]
  );
  const business = rows[0];

  // Pendaftaran mandiri yang disetujui Admin memakai paket pilihan + trial
  // 30 hari. Alur lain (panel Owner / Admin) tetap memakai paket default.
  if (initialSubscription?.planId) {
    await createTrialSubscription(client, {
      businessId: business.id,
      planId: initialSubscription.planId,
      trialDays: initialSubscription.trialDays ?? 30,
    });
  } else {
    // Keputusan pemilik (OPSI A): bisnis baru otomatis diberi langganan
    // plan default, dalam transaksi yang sama dengan pembuatan bisnis.
    await createDefaultSubscription(client, business.id);
  }

  await writeAudit({
    client,
    actorRole: actor.role,
    actorId: actor.id,
    businessId: business.id,
    action: 'business.create',
    entityType: 'business',
    entityId: business.id,
    after: { name: business.name, business_type: business.business_type },
    ip,
  });

  return business;
};

/** Buat bisnis baru + langganan default Gratis (satu transaksi database). */
export const createBusiness = async ({
  ownerId,
  name,
  businessType,
  currency,
  timezone,
  actor,
  ip,
}) => {
  return withTransaction((client) =>
    createBusinessInTransaction(client, {
      ownerId,
      name,
      businessType,
      currency,
      timezone,
      actor,
      ip,
    })
  );
};

/** Ubah data bisnis milik owner. */
export const updateBusiness = async (id, ownerId, patch, actor, ip) => {
  return withTransaction(async (client) => {
    const { rows: currentRows } = await client.query(
      `SELECT ${BUSINESS_COLUMNS} FROM businesses
        WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [id, ownerId]
    );
    const before = currentRows[0];
    if (!before) throw new NotFoundError('Bisnis tidak ditemukan');

    const fields = [];
    const values = [];
    let i = 1;
    if (patch.name !== undefined) {
      fields.push(`name = $${i++}`);
      values.push(patch.name);
    }
    if (patch.businessType !== undefined) {
      fields.push(`business_type = $${i++}`);
      values.push(patch.businessType);
    }
    if (patch.currency !== undefined) {
      fields.push(`currency = $${i++}`);
      values.push(patch.currency);
    }
    if (patch.timezone !== undefined) {
      fields.push(`timezone = $${i++}`);
      values.push(patch.timezone);
    }
    if (fields.length === 0) return before;

    values.push(id);
    const { rows } = await client.query(
      `UPDATE businesses SET ${fields.join(', ')} WHERE id = $${i} RETURNING ${BUSINESS_COLUMNS}`,
      values
    );

    await writeAudit({
      client,
      actorRole: actor.role,
      actorId: actor.id,
      businessId: id,
      action: 'business.update',
      entityType: 'business',
      entityId: id,
      before: { name: before.name, business_type: before.business_type },
      after: { name: rows[0].name, business_type: rows[0].business_type },
      ip,
    });

    return rows[0];
  });
};

/** Aktifkan / nonaktifkan bisnis milik owner. */
export const setBusinessStatus = async (id, ownerId, status, actor, ip) => {
  return withTransaction(async (client) => {
    const { rows: currentRows } = await client.query(
      `SELECT ${BUSINESS_COLUMNS} FROM businesses
        WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [id, ownerId]
    );
    const before = currentRows[0];
    if (!before) throw new NotFoundError('Bisnis tidak ditemukan');

    const { rows } = await client.query(
      `UPDATE businesses SET status = $1 WHERE id = $2 RETURNING ${BUSINESS_COLUMNS}`,
      [status, id]
    );

    await writeAudit({
      client,
      actorRole: actor.role,
      actorId: actor.id,
      businessId: id,
      action: 'business.status_change',
      entityType: 'business',
      entityId: id,
      before: { status: before.status },
      after: { status },
      ip,
    });

    return rows[0];
  });
};

export default {
  listBusinesses,
  createBusiness,
  updateBusiness,
  setBusinessStatus,
};
