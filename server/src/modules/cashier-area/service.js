/**
 * Layanan area kasir (Fase 6): daftar produk READ-ONLY milik outlet kasir.
 *
 * Kunci keamanan: outlet diturunkan dari akun kasir (`cashiers.outlet_id`),
 * BUKAN dari input klien — tidak ada parameter yang bisa dibajak untuk
 * melihat outlet lain (anti-IDOR bawaan).
 */
import { query } from '../../config/db.js';
import { NotFoundError } from '../../middleware/error.js';

/** Ambil outlet & bisnis milik kasir (pastikan outlet/bisnis belum soft-deleted). */
export const getCashierScope = async (cashierId) => {
  const { rows } = await query(
    `SELECT o.id AS outlet_id, o.business_id
       FROM cashiers c
       JOIN outlets o ON o.id = c.outlet_id
       JOIN businesses b ON b.id = o.business_id
      WHERE c.id = $1 AND o.deleted_at IS NULL AND b.deleted_at IS NULL`,
    [cashierId]
  );
  if (!rows[0]) throw new NotFoundError('Outlet kasir tidak ditemukan');
  return rows[0];
};

export const listOutletProducts = async ({ cashierId, filters }) => {
  const scope = await getCashierScope(cashierId);

  const where = [
    'p.deleted_at IS NULL',
    'p.business_id = $1',
    'p.status = $2',
  ];
  const countValues = [scope.business_id, 'active'];
  let i = 3;
  if (filters.search) {
    where.push(`(lower(p.name) LIKE lower($${i++}) OR lower(COALESCE(p.sku,'')) LIKE lower($${i++}))`);
    countValues.push(`%${filters.search}%`, `%${filters.search}%`);
  }
  const whereSql = where.join(' AND ');
  // Placeholder khusus outlet (posisinya di deret parameter setelah search).
  const outletPlaceholder = `$${i++}`;
  const selectValues = [...countValues, scope.outlet_id];

  const limit = filters.limit;
  const offset = (filters.page - 1) * limit;

  const { rows } = await query(
    `SELECT p.id, p.name, p.sku, p.barcode, p.price, p.track_stock,
            c.name AS category_name,
            ps.quantity
       FROM products p
       LEFT JOIN product_categories c ON c.id = p.category_id
       LEFT JOIN product_stocks ps
              ON ps.product_id = p.id AND ps.outlet_id = ${outletPlaceholder}
      WHERE ${whereSql}
      ORDER BY p.name ASC
      LIMIT $${i++} OFFSET $${i++}`,
    [...selectValues, limit, offset]
  );

  const count = await query(
    `SELECT count(*)::int AS n FROM products p WHERE ${whereSql}`,
    countValues
  );

  return {
    items: rows,
    total: count.rows[0].n,
    outlet: { id: scope.outlet_id },
  };
};

export default { getCashierScope, listOutletProducts };