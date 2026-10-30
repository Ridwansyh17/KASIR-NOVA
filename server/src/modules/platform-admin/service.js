/**
 * Layanan modul platform-admin.
 *
 * Mengelola akun Owner: daftar, buat, detail, ubah, suspend/aktivasi,
 * reset password, dan soft delete. Setiap mutasi menulis audit log di dalam
 * transaksi yang sama.
 *
 * Catatan: Admin Platform TIDAK mengelola data bisnis di sini — itu ranah
 * modul owner/business (Fase 3). Modul ini murni pengelolaan akun Owner.
 */
import { query, withTransaction } from '../../config/db.js';
import { hashPassword } from '../../utils/hash.js';
import { NotFoundError, ConflictError } from '../../middleware/error.js';
import { writeAudit } from '../audit/service.js';

const OWNER_COLUMNS = `id, email, full_name, phone, status, created_by, created_at, updated_at, deleted_at,
  email_verified_at, pending_business_name, email_verification_method,
  (firebase_uid IS NOT NULL) AS firebase_linked`;

// Bentuk owner yang aman dicatat ke audit (tanpa password_hash).
const auditShape = (o) =>
  o
    ? {
        id: o.id,
        email: o.email,
        full_name: o.full_name,
        phone: o.phone,
        status: o.status,
      }
    : null;

// Ubah pelanggaran constraint unik menjadi 409 yang ramah.
const asConflict = (err, message = 'Email sudah terdaftar') =>
  err?.code === '23505' ? new ConflictError(message) : err;

// Cabut semua sesi owner (dipakai saat suspend / delete / reset password).
const revokeOwnerSessions = (client, ownerId) =>
  client.query(
    `UPDATE refresh_tokens
        SET revoked_at = now()
      WHERE user_role = 'owner' AND user_id = $1 AND revoked_at IS NULL`,
    [ownerId]
  );

/**
 * Daftar owner (aktif, ter-paginasi, bisa dicari & difilter status).
 */
export const listOwners = async ({ search = null, status = null, page = 1, limit = 20 }) => {
  const offset = (page - 1) * limit;
  const filters = `
      WHERE deleted_at IS NULL
        AND ($1::text IS NULL
             OR lower(email) LIKE '%' || lower($1) || '%'
             OR lower(full_name) LIKE '%' || lower($1) || '%')
        AND ($2::account_status IS NULL OR status = $2::account_status)`;

  const { rows } = await query(
    `SELECT ${OWNER_COLUMNS},
            (SELECT r.status FROM owner_registrations r WHERE r.owner_id = owners.id)
              AS registration_status
       FROM owners ${filters}
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4`,
    [search, status, limit, offset]
  );

  const { rows: countRows } = await query(
    `SELECT count(*)::int AS total FROM owners ${filters}`,
    [search, status]
  );

  return { items: rows, total: countRows[0].total, page, limit };
};

/** Detail satu owner. */
export const getOwner = async (id) => {
  const { rows } = await query(
    `SELECT ${OWNER_COLUMNS},
            (SELECT r.status FROM owner_registrations r WHERE r.owner_id = owners.id)
              AS registration_status
       FROM owners WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (!rows[0]) throw new NotFoundError('Owner tidak ditemukan');
  return rows[0];
};

/** Buat owner baru (dibuat oleh admin). */
export const createOwner = async ({ email, password, fullName, phone, actor, ip }) => {
  const passwordHash = await hashPassword(password);

  try {
    return await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO owners (email, password_hash, full_name, phone, status, created_by)
         VALUES ($1, $2, $3, $4, 'active', $5)
         RETURNING ${OWNER_COLUMNS}`,
        [email, passwordHash, fullName, phone ?? null, actor.id]
      );
      const owner = rows[0];

      await writeAudit({
        client,
        actorRole: actor.role,
        actorId: actor.id,
        action: 'owner.create',
        entityType: 'owner',
        entityId: owner.id,
        after: auditShape(owner),
        ip,
      });

      return owner;
    });
  } catch (err) {
    throw asConflict(err);
  }
};

/** Ubah data owner (email / full_name / phone). */
export const updateOwner = async (id, patch, actor, ip) => {
  try {
    return await withTransaction(async (client) => {
      const { rows: currentRows } = await client.query(
        `SELECT ${OWNER_COLUMNS} FROM owners WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [id]
      );
      const before = currentRows[0];
      if (!before) throw new NotFoundError('Owner tidak ditemukan');
      if (
        before.firebase_linked &&
        patch.email !== undefined &&
        String(patch.email).toLowerCase() !== String(before.email).toLowerCase()
      ) {
        throw new ConflictError(
          'Email Owner terhubung Firebase tidak dapat diubah dari panel ini.'
        );
      }

      const fields = [];
      const values = [];
      let i = 1;
      if (patch.fullName !== undefined) {
        fields.push(`full_name = $${i++}`);
        values.push(patch.fullName);
      }
      if (patch.email !== undefined) {
        fields.push(`email = $${i++}`);
        values.push(patch.email);
      }
      if (patch.phone !== undefined) {
        fields.push(`phone = $${i++}`);
        values.push(patch.phone);
      }
      if (fields.length === 0) return before;

      values.push(id);
      const { rows } = await client.query(
        `UPDATE owners SET ${fields.join(', ')} WHERE id = $${i} RETURNING ${OWNER_COLUMNS}`,
        values
      );
      const after = rows[0];

      await writeAudit({
        client,
        actorRole: actor.role,
        actorId: actor.id,
        action: 'owner.update',
        entityType: 'owner',
        entityId: id,
        before: auditShape(before),
        after: auditShape(after),
        ip,
      });

      return after;
    });
  } catch (err) {
    throw asConflict(err);
  }
};

/**
 * Ubah status owner. Menonaktifkan akun (suspended) sekaligus mencabut seluruh
 * sesinya agar akses langsung berhenti walau access token belum kedaluwarsa.
 */
export const setOwnerStatus = async (id, status, actor, ip) => {
  return withTransaction(async (client) => {
    const { rows: currentRows } = await client.query(
      `SELECT ${OWNER_COLUMNS} FROM owners WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [id]
    );
    const before = currentRows[0];
    if (!before) throw new NotFoundError('Owner tidak ditemukan');

    const { rows } = await client.query(
      `UPDATE owners SET status = $1 WHERE id = $2 RETURNING ${OWNER_COLUMNS}`,
      [status, id]
    );

    if (status === 'suspended') await revokeOwnerSessions(client, id);

    await writeAudit({
      client,
      actorRole: actor.role,
      actorId: actor.id,
      action: 'owner.status_change',
      entityType: 'owner',
      entityId: id,
      before: { status: before.status },
      after: { status },
      ip,
    });

    return rows[0];
  });
};

/**
 * Reset password owner (admin menetapkan password baru) + cabut semua sesi.
 */
export const resetOwnerPassword = async (id, newPassword, actor, ip) => {
  const passwordHash = await hashPassword(newPassword);

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, email FROM owners WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [id]
    );
    if (!rows[0]) throw new NotFoundError('Owner tidak ditemukan');

    await client.query(`UPDATE owners SET password_hash = $1 WHERE id = $2`, [
      passwordHash,
      id,
    ]);
    await revokeOwnerSessions(client, id);

    await writeAudit({
      client,
      actorRole: actor.role,
      actorId: actor.id,
      action: 'owner.reset_password',
      entityType: 'owner',
      entityId: id,
      ip,
    });

    return { id, email: rows[0].email };
  });
};

/**
 * Soft delete owner: tandai deleted_at + suspend + cabut sesi.
 * Baris tetap ada agar relasi (bisnis/transaksi) tidak yatim.
 */
export const softDeleteOwner = async (id, actor, ip) => {
  return withTransaction(async (client) => {
    const { rows: currentRows } = await client.query(
      `SELECT ${OWNER_COLUMNS} FROM owners WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [id]
    );
    const before = currentRows[0];
    if (!before) throw new NotFoundError('Owner tidak ditemukan');

    const { rows } = await client.query(
      `UPDATE owners SET deleted_at = now(), status = 'suspended'
        WHERE id = $1 RETURNING ${OWNER_COLUMNS}`,
      [id]
    );
    await revokeOwnerSessions(client, id);

    await writeAudit({
      client,
      actorRole: actor.role,
      actorId: actor.id,
      action: 'owner.delete',
      entityType: 'owner',
      entityId: id,
      before: auditShape(before),
      after: auditShape(rows[0]),
      ip,
    });

    return rows[0];
  });
};

export default {
  listOwners,
  getOwner,
  createOwner,
  updateOwner,
  setOwnerStatus,
  resetOwnerPassword,
  softDeleteOwner,
};
