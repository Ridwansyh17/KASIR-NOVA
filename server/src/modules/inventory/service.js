/**
 * Layanan modul inventori (Fase 2) — histori pergerakan stok, APPEND-ONLY.
 *
 * Aturan:
 *   - Setiap perubahan stok (set stok, penjualan, void, tandai habis) menulis
 *     satu baris `inventory_movements` di transaksi DB yang sama, sehingga
 *     jejaknya tidak pernah hilang bila mutasi gagal dan tidak ada mutasi
 *     tanpa jejak.
 *   - `product_name` disimpan sebagai snapshot agar riwayat tetap terbaca bila
 *     produk kemudian dihapus (soft delete) atau namanya berubah.
 *   - `qty_delta = qty_after - qty_before`; aksi tanpa perubahan jumlah
 *     (mark_out / restore) bernilai 0 tetapi tetap tercatat sebagai kejadian.
 *   - Tidak ada endpoint hapus.
 */
import { query } from '../../config/db.js';
import { NotFoundError } from '../../middleware/error.js';

export const MOVEMENT_COLUMNS = `id, business_id, outlet_id, product_id, product_name,
  type, qty_delta, qty_before, qty_after, reason, ref_type, ref_id,
  actor_role, actor_id, created_at`;

/**
 * Catat satu pergerakan stok (dipakai di dalam transaksi pemanggil).
 * @param {import('pg').PoolClient} client
 * @param {object} p
 * @param {string} p.businessId
 * @param {string} p.outletId
 * @param {string|null} p.productId
 * @param {string} p.productName
 * @param {'initial'|'adjustment'|'sale'|'void'|'refund'|'mark_out'|'restore'} p.type
 * @param {number} p.qtyBefore
 * @param {number} p.qtyAfter
 */
export const recordMovement = async (
  client,
  {
    businessId,
    outletId,
    productId = null,
    productName,
    type,
    qtyBefore,
    qtyAfter,
    reason = null,
    refType = null,
    refId = null,
    actorRole = null,
    actorId = null,
  }
) => {
  const { rows } = await client.query(
    `INSERT INTO inventory_movements
       (business_id, outlet_id, product_id, product_name, type, qty_delta,
        qty_before, qty_after, reason, ref_type, ref_id, actor_role, actor_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING ${MOVEMENT_COLUMNS}`,
    [
      businessId,
      outletId,
      productId,
      productName,
      type,
      qtyAfter - qtyBefore,
      qtyBefore,
      qtyAfter,
      reason,
      refType,
      refId,
      actorRole,
      actorId,
    ]
  );
  return rows[0];
};

/** Zona waktu bisnis (404 bila bisnis tidak ada / terhapus). */
const getBusiness = async (businessId) => {
  const { rows } = await query(
    `SELECT id, name, timezone FROM businesses WHERE id = $1 AND deleted_at IS NULL`,
    [businessId]
  );
  if (!rows[0]) throw new NotFoundError('Bisnis tidak ditemukan');
  return rows[0];
};

/**
 * Daftar pergerakan stok (Owner: seluruh bisnis; filter opsional per outlet,
 * produk, jenis, dan rentang tanggal dalam zona waktu bisnis).
 */
export const listMovements = async ({ businessId, filters }) => {
  const biz = await getBusiness(businessId);
  const tz = biz.timezone;

  const where = ['m.business_id = $1'];
  const values = [businessId];
  let i = 2;

  if (filters.outletId) {
    where.push(`m.outlet_id = $${i++}`);
    values.push(filters.outletId);
  }
  if (filters.productId) {
    where.push(`m.product_id = $${i++}`);
    values.push(filters.productId);
  }
  if (filters.type) {
    where.push(`m.type = $${i++}`);
    values.push(filters.type);
  }
  if (filters.from) {
    values.push(filters.from);
    where.push(`m.created_at >= ($${i++}::date)::timestamp AT TIME ZONE $${i++}::text`);
    values.push(tz);
  }
  if (filters.to) {
    values.push(filters.to);
    where.push(
      `m.created_at < ((($${i++}::date)::timestamp + interval '1 day') AT TIME ZONE $${i++}::text)`
    );
    values.push(tz);
  }

  const whereSql = where.join(' AND ');
  const limit = filters.limit;
  const offset = (filters.page - 1) * limit;

  const { rows } = await query(
    `SELECT m.id, m.product_id, m.product_name, m.type, m.qty_delta,
            m.qty_before, m.qty_after, m.reason, m.ref_type, m.ref_id,
            m.actor_role, m.actor_id, m.created_at,
            m.outlet_id, o.name AS outlet_name,
            COALESCE(ow.full_name, ca.full_name, pa.full_name) AS actor_name
       FROM inventory_movements m
       JOIN outlets o ON o.id = m.outlet_id
       LEFT JOIN owners ow ON ow.id = m.actor_id AND m.actor_role = 'owner'
       LEFT JOIN cashiers ca ON ca.id = m.actor_id AND m.actor_role = 'cashier'
       LEFT JOIN platform_admins pa ON pa.id = m.actor_id AND m.actor_role = 'platform_admin'
      WHERE ${whereSql}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT $${i++} OFFSET $${i++}`,
    [...values, limit, offset]
  );

  const count = await query(
    `SELECT count(*)::int AS n FROM inventory_movements m WHERE ${whereSql}`,
    values
  );

  return { items: rows, total: count.rows[0].n };
};

export default { recordMovement, listMovements };
