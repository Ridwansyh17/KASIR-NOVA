/**
 * Layanan paket langganan (subscription_plans) — dikelola Admin Platform.
 *
 * Aturan: paling banyak SATU paket default (index parsial unik) dan paket
 * default tidak boleh di-nonaktifkan/hapus bila itu satu-satunya, karena
 * pembuatan bisnis baru bergantung padanya (createDefaultSubscription).
 */
import { query, withTransaction } from '../../config/db.js';
import { NotFoundError, ConflictError } from '../../middleware/error.js';
import { writeAudit } from '../audit/service.js';

const PLAN_COLUMNS = `id, name, slug, max_outlets, max_cashiers, price, price_monthly, price_yearly,
  duration_days, features, is_active, is_default, is_public, is_custom_price, created_at, updated_at`;

const auditShape = (p) =>
  p
    ? {
        name: p.name,
        slug: p.slug,
        max_outlets: p.max_outlets,
        max_cashiers: p.max_cashiers,
        price: p.price,
        price_monthly: p.price_monthly,
        price_yearly: p.price_yearly,
        is_public: p.is_public,
        is_custom_price: p.is_custom_price,
        duration_days: p.duration_days,
        is_active: p.is_active,
        is_default: p.is_default,
      }
    : null;

const asConflict = (err, message) =>
  err?.code === '23505' ? new ConflictError(message) : err;

/** Daftar semua paket (termasuk nonaktif), paket default di urutan awal. */
export const listPlans = async () => {
  const { rows } = await query(
    `SELECT ${PLAN_COLUMNS} FROM subscription_plans
      ORDER BY is_default DESC, name ASC`
  );
  return rows;
};

/** Ambil satu paket. */
export const getPlan = async (id) => {
  const { rows } = await query(
    `SELECT ${PLAN_COLUMNS} FROM subscription_plans WHERE id = $1`,
    [id]
  );
  if (!rows[0]) throw new NotFoundError('Paket tidak ditemukan');
  return rows[0];
};

/** Ciptakan paket baru. */
export const createPlan = async (data, actor, ip) => {
  try {
    return await withTransaction(async (client) => {
      // Pastikan tidak ada default lain bila paket ini default.
      if (data.isDefault) await ensureNoOtherDefault(client, null);

      const { rows } = await client.query(
        `INSERT INTO subscription_plans
           (name, slug, max_outlets, max_cashiers, price, price_monthly, price_yearly,
            duration_days, features, is_active, is_default, is_public, is_custom_price)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING ${PLAN_COLUMNS}`,
        [
          data.name,
          data.slug ?? null,
          data.maxOutlets,
          data.maxCashiers,
          data.priceMonthly ?? data.price,
          data.priceMonthly ?? data.price,
          data.priceYearly ?? null,
          data.durationDays,
          data.features ?? {},
          data.isActive,
          data.isDefault,
          data.isPublic,
          data.isCustomPrice,
        ]
      );
      const plan = rows[0];

      await writeAudit({
        client,
        actorRole: actor.role,
        actorId: actor.id,
        action: 'plan.create',
        entityType: 'subscription_plan',
        entityId: plan.id,
        after: auditShape(plan),
        ip,
      });

      return plan;
    });
  } catch (err) {
    throw asConflict(err, 'Nama paket sudah digunakan');
  }
};

/** Ubah paket. */
export const updatePlan = async (id, patch, actor, ip) => {
  try {
    return await withTransaction(async (client) => {
      const { rows: currentRows } = await client.query(
        `SELECT ${PLAN_COLUMNS} FROM subscription_plans WHERE id = $1 FOR UPDATE`,
        [id]
      );
      const before = currentRows[0];
      if (!before) throw new NotFoundError('Paket tidak ditemukan');

      if (patch.isDefault === true) await ensureNoOtherDefault(client, id);
      if (patch.isDefault === false) {
        await ensureDefaultExistsAfterRemoval(client, id);
      }
      if (patch.isActive === false && before.is_default && patch.isDefault !== true) {
        // Menonaktifkan paket default tanpa mengganti default -> tidak boleh.
        const otherDefault = await findDefault(client, id);
        if (!otherDefault) {
          throw new ConflictError('Paket default tidak boleh dinonaktifkan tanpa pengganti');
        }
      }

      const fields = [];
      const values = [];
      let i = 1;
      if (patch.name !== undefined) {
        fields.push(`name = $${i++}`);
        values.push(patch.name);
      }
      if (patch.maxOutlets !== undefined) {
        fields.push(`max_outlets = $${i++}`);
        values.push(patch.maxOutlets);
      }
      if (patch.maxCashiers !== undefined) {
        fields.push(`max_cashiers = $${i++}`);
        values.push(patch.maxCashiers);
      }
      // `price` lama = harga bulanan. Bila salah satu diubah, keduanya
      // disinkronkan agar klien lama dan baru melihat nominal yang sama.
      const monthlyPrice =
        patch.priceMonthly !== undefined ? patch.priceMonthly : patch.price;
      if (monthlyPrice !== undefined) {
        fields.push(`price = $${i++}`);
        values.push(monthlyPrice);
        fields.push(`price_monthly = $${i++}`);
        values.push(monthlyPrice);
      }
      if (patch.priceYearly !== undefined) {
        fields.push(`price_yearly = $${i++}`);
        values.push(patch.priceYearly);
      }
      if (patch.slug !== undefined) {
        fields.push(`slug = $${i++}`);
        values.push(patch.slug);
      }
      if (patch.isPublic !== undefined) {
        fields.push(`is_public = $${i++}`);
        values.push(patch.isPublic);
      }
      if (patch.isCustomPrice !== undefined) {
        fields.push(`is_custom_price = $${i++}`);
        values.push(patch.isCustomPrice);
      }
      if (patch.durationDays !== undefined) {
        fields.push(`duration_days = $${i++}`);
        values.push(patch.durationDays);
      }
      if (patch.features !== undefined) {
        fields.push(`features = $${i++}`);
        values.push(patch.features);
      }
      if (patch.isActive !== undefined) {
        fields.push(`is_active = $${i++}`);
        values.push(patch.isActive);
      }
      if (patch.isDefault !== undefined) {
        fields.push(`is_default = $${i++}`);
        values.push(patch.isDefault);
      }
      if (fields.length === 0) return before;

      values.push(id);
      const { rows } = await client.query(
        `UPDATE subscription_plans SET ${fields.join(', ')} WHERE id = $${i} RETURNING ${PLAN_COLUMNS}`,
        values
      );
      const after = rows[0];

      await writeAudit({
        client,
        actorRole: actor.role,
        actorId: actor.id,
        action: 'plan.update',
        entityType: 'subscription_plan',
        entityId: id,
        before: auditShape(before),
        after: auditShape(after),
        ip,
      });

      return after;
    });
  } catch (err) {
    throw asConflict(err, 'Nama paket sudah digunakan');
  }
};

const findDefault = async (client, excludeId) => {
  const { rows } = await client.query(
    `SELECT id FROM subscription_plans
      WHERE is_default = true AND ($1::uuid IS NULL OR id <> $1) LIMIT 1`,
    [excludeId]
  );
  return rows[0] ?? null;
};

const ensureNoOtherDefault = async (client, excludeId) => {
  const other = await findDefault(client, excludeId);
  if (other) {
    throw new ConflictError('Hanya satu paket default yang diperbolehkan');
  }
};

const ensureDefaultExistsAfterRemoval = async (client, id) => {
  const other = await findDefault(client, id);
  if (!other) {
    throw new ConflictError('Setidaknya satu paket default harus ada');
  }
};

export default { listPlans, getPlan, createPlan, updatePlan };