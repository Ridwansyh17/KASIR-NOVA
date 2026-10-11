/**
 * Layanan modul outlet (dimiliki Owner, scoped business_id).
 *
 * Aturan:
 *   - Membuat outlet melewati gerbang kuota langganan (`enforceOutletQuota`)
 *     di dalam transaksi yang sama + baris bisnis dikunci (FOR UPDATE) agar
 *     pembuatan bersamaan tidak melampaui batas plan.
 *   - Semua operasi memverifikasi `business_id` (defense-in-depth), selain
 *     middleware tenant.
 *   - Hapus outlet = soft delete (`deleted_at`). Pemeriksaan "tidak ada
 *     transaksi aktif" akan ditambahkan di Fase 7 saat tabel transactions ada.
 */
import { query, withTransaction } from '../../config/db.js';
import { NotFoundError, ConflictError } from '../../middleware/error.js';
import { enforceOutletQuota } from '../subscription/service.js';
import { writeAudit } from '../audit/service.js';

export const OUTLET_COLUMNS = `id, business_id, name, address, phone, tax_rate, tax_inclusive, status, created_at, updated_at`;

const auditShape = (o) =>
  o
    ? {
        id: o.id,
        name: o.name,
        address: o.address,
        phone: o.phone,
        tax_rate: Number(o.tax_rate),
        tax_inclusive: o.tax_inclusive,
      }
    : null;

/** Daftar outlet aktif milik sebuah bisnis. */
export const listOutlets = async (businessId) => {
  const { rows } = await query(
    `SELECT ${OUTLET_COLUMNS} FROM outlets
      WHERE business_id = $1 AND deleted_at IS NULL
      ORDER BY created_at DESC`,
    [businessId]
  );
  return rows;
};

/** Buat outlet — gerbang kuota langganan wajib lulus. */
export const createOutlet = async ({ businessId, data, actor, ip }) => {
  return withTransaction(async (client) => {
    // Kunci baris bisnis: serialkan pembuatan outlet agar kuota aman.
    const biz = await client.query(
      `SELECT id, status FROM businesses
        WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [businessId]
    );
    if (!biz.rows[0]) throw new NotFoundError('Bisnis tidak ditemukan');
    if (biz.rows[0].status !== 'active') {
      throw new ConflictError('Bisnis sedang nonaktif; tidak dapat membuat outlet');
    }

    await enforceOutletQuota(client, businessId);

    const { rows } = await client.query(
      `INSERT INTO outlets (business_id, name, address, phone, tax_rate, tax_inclusive, status)
       VALUES ($1, $2, $3, $4, COALESCE($5, 0), COALESCE($6, false), 'active')
       RETURNING ${OUTLET_COLUMNS}`,
      [
        businessId,
        data.name,
        data.address ?? null,
        data.phone ?? null,
        data.taxRate ?? null,
        data.taxInclusive ?? null,
      ]
    );
    const outlet = rows[0];

    // Invarian stok: outlet baru mendapat baris stok 0 untuk setiap produk
    // ber-`track_stock` milik bisnis (agar penjualan selalu bisa dikurangi).
    await client.query(
      `INSERT INTO product_stocks (product_id, outlet_id)
       SELECT p.id, $2 FROM products p
        WHERE p.business_id = $1 AND p.track_stock = true AND p.deleted_at IS NULL
       ON CONFLICT (product_id, outlet_id) DO NOTHING`,
      [businessId, outlet.id]
    );

    await writeAudit({
      client,
      actorRole: actor.role,
      actorId: actor.id,
      businessId,
      action: 'outlet.create',
      entityType: 'outlet',
      entityId: outlet.id,
      after: auditShape(outlet),
      ip,
    });

    return outlet;
  });
};

/** Detail outlet (dipastikan milik business_id). */
export const getOutlet = async (businessId, outletId) => {
  const { rows } = await query(
    `SELECT ${OUTLET_COLUMNS} FROM outlets
      WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
    [outletId, businessId]
  );
  if (!rows[0]) throw new NotFoundError('Outlet tidak ditemukan');
  return rows[0];
};

/** Ubah data outlet. */
export const updateOutlet = async (businessId, outletId, patch, actor, ip) => {
  return withTransaction(async (client) => {
    const { rows: currentRows } = await client.query(
      `SELECT ${OUTLET_COLUMNS} FROM outlets
        WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [outletId, businessId]
    );
    const before = currentRows[0];
    if (!before) throw new NotFoundError('Outlet tidak ditemukan');

    const fields = [];
    const values = [];
    let i = 1;
    if (patch.name !== undefined) {
      fields.push(`name = $${i++}`);
      values.push(patch.name);
    }
    if (patch.address !== undefined) {
      fields.push(`address = $${i++}`);
      values.push(patch.address);
    }
    if (patch.phone !== undefined) {
      fields.push(`phone = $${i++}`);
      values.push(patch.phone);
    }
    if (patch.taxRate !== undefined) {
      fields.push(`tax_rate = $${i++}`);
      values.push(patch.taxRate);
    }
    if (patch.taxInclusive !== undefined) {
      fields.push(`tax_inclusive = $${i++}`);
      values.push(patch.taxInclusive);
    }
    if (fields.length === 0) return before;

    values.push(outletId);
    const { rows } = await client.query(
      `UPDATE outlets SET ${fields.join(', ')} WHERE id = $${i} RETURNING ${OUTLET_COLUMNS}`,
      values
    );

    await writeAudit({
      client,
      actorRole: actor.role,
      actorId: actor.id,
      businessId,
      action: 'outlet.update',
      entityType: 'outlet',
      entityId: outletId,
      before: auditShape(before),
      after: auditShape(rows[0]),
      ip,
    });

    return rows[0];
  });
};

/**
 * Soft delete outlet. Menolak (409) bila masih ada transaksi penjualan aktif
 * yang mereferensikan outlet — sesuai matriks hak akses ("hapus outlet cek:
 * tidak ada transaksi aktif"). Riwayat transaksi tetap terjaga.
 */
export const softDeleteOutlet = async (businessId, outletId, actor, ip) => {
  return withTransaction(async (client) => {
    const { rows: currentRows } = await client.query(
      `SELECT ${OUTLET_COLUMNS} FROM outlets
        WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [outletId, businessId]
    );
    const before = currentRows[0];
    if (!before) throw new NotFoundError('Outlet tidak ditemukan');

    const activeTx = await client.query(
      `SELECT count(*)::int AS n FROM transactions
        WHERE outlet_id = $1 AND status = 'completed'`,
      [outletId]
    );
    if (activeTx.rows[0].n > 0) {
      throw new ConflictError(
        `Outlet masih memiliki ${activeTx.rows[0].n} transaksi aktif; tidak dapat dihapus`
      );
    }

    const { rows } = await client.query(
      `UPDATE outlets SET deleted_at = now() WHERE id = $1 RETURNING ${OUTLET_COLUMNS}`,
      [outletId]
    );

    await writeAudit({
      client,
      actorRole: actor.role,
      actorId: actor.id,
      businessId,
      action: 'outlet.delete',
      entityType: 'outlet',
      entityId: outletId,
      before: auditShape(before),
      after: { deleted_at: rows[0]?.deleted_at ?? null },
      ip,
    });

    return rows[0];
  });
};

export default { listOutlets, createOutlet, getOutlet, updateOutlet, softDeleteOutlet };