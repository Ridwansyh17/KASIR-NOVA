/**
 * Layanan area kasir — daftar produk outlet kasir (Fase 6) + katalog kasir
 * (Fase 1).
 *
 * Kunci keamanan: outlet diturunkan dari akun kasir (`cashiers.outlet_id`),
 * BUKAN dari input klien — tidak ada parameter yang bisa dibajak untuk
 * melihat outlet lain (anti-IDOR bawaan).
 *
 * Visibilitas HPP (Fase 1): hanya ditampilkan bila `can_view_profit` kasir
 * bernilai true; keputusan ini dibuat di server, bukan di UI.
 */
import { query } from '../../config/db.js';
import { NotFoundError } from '../../middleware/error.js';

/** Ambil outlet & bisnis milik kasir + izin melihat laba. */
export const getCashierScope = async (cashierId) => {
  const { rows } = await query(
    `SELECT c.id AS cashier_id, c.full_name, c.can_view_profit,
            o.id AS outlet_id, o.business_id, o.name AS outlet_name,
            b.name AS business_name, b.timezone, b.currency
       FROM cashiers c
       JOIN outlets o ON o.id = c.outlet_id
       JOIN businesses b ON b.id = o.business_id
      WHERE c.id = $1 AND o.deleted_at IS NULL AND b.deleted_at IS NULL`,
    [cashierId]
  );
  if (!rows[0]) throw new NotFoundError('Outlet kasir tidak ditemukan');
  return rows[0];
};

/**
 * Daftar produk yang terlihat oleh kasir: produk AKTIF seluruh bisnis dengan
 * kuantitas pada OUTLET kasir. Mendukung pencarian, filter ketersediaan
 * (HABIS), dan pengurutan.
 */
export const listOutletProducts = async ({ cashierId, filters }) => {
  const scope = await getCashierScope(cashierId);
  const includeCost = Boolean(scope.can_view_profit);

  const limit = filters.limit;
  const offset = (filters.page - 1) * limit;

  const availSql = {
    all: 'true',
    available: 'out_of_stock = false',
    out_of_stock: 'out_of_stock = true',
  }[filters.availability ?? 'all'];

  const orderSql = {
    name: 'name ASC',
    stock_asc: 'quantity ASC NULLS FIRST, name ASC',
    stock_desc: 'quantity DESC NULLS LAST, name ASC',
  }[filters.sort ?? 'name'];

  /**
   * Bangun klausa filter + nilai parameternya. Dipanggil terpisah untuk query
   * daftar dan query hitung agar penomoran placeholder selalu konsisten
   * (`$1` = business id, lalu search/category, terakhir outlet).
   */
  const buildFilters = () => {
    const values = [scope.business_id];
    const clauses = ["p.deleted_at IS NULL", 'p.business_id = $1', "p.status = 'active'"];
    if (filters.search) {
      values.push(`%${filters.search}%`);
      const namePh = `$${values.length}`;
      values.push(`%${filters.search}%`);
      const skuPh = `$${values.length}`;
      clauses.push(
        `(lower(p.name) LIKE lower(${namePh}) OR lower(COALESCE(p.sku, '')) LIKE lower(${skuPh}))`
      );
    }
    if (filters.categoryId) {
      values.push(filters.categoryId);
      clauses.push(`p.category_id = $${values.length}`);
    }
    return { whereSql: clauses.join(' AND '), values };
  };

  /** Subquery produk + stok untuk SATU outlet (placeholder outlet eksplisit). */
  const productSelect = (whereSql, outletPh) => `
    SELECT p.id, p.name, p.sku, p.barcode, p.price, p.cost_price, p.unit,
           p.photo_url, p.track_stock, p.manual_out_of_stock, p.category_id,
           c.name AS category_name, ps.quantity,
           (p.manual_out_of_stock OR (p.track_stock AND COALESCE(ps.quantity, 0) <= 0))
             AS out_of_stock
      FROM products p
      LEFT JOIN product_categories c ON c.id = p.category_id
      LEFT JOIN product_stocks ps ON ps.product_id = p.id AND ps.outlet_id = ${outletPh}
     WHERE ${whereSql}`;

  // Daftar (dengan limit/offset).
  const listFilters = buildFilters();
  const listValues = [...listFilters.values, scope.outlet_id];
  const outletListPh = `$${listValues.length}`;
  const limitPh = `$${listValues.length + 1}`;
  const offsetPh = `$${listValues.length + 2}`;
  const { rows } = await query(
    `WITH base AS (${productSelect(listFilters.whereSql, outletListPh)})
     SELECT * FROM base
      WHERE ${availSql}
      ORDER BY ${orderSql}
      LIMIT ${limitPh} OFFSET ${offsetPh}`,
    [...listValues, limit, offset]
  );

  // Total baris (tanpa limit/offset).
  const countFilters = buildFilters();
  const countValues = [...countFilters.values, scope.outlet_id];
  const outletCountPh = `$${countValues.length}`;
  const count = await query(
    `SELECT count(*)::int AS n FROM (
       ${productSelect(countFilters.whereSql, outletCountPh)}
     ) q
     WHERE ${availSql}`,
    countValues
  );

  const items = rows.map((row) => {
    const out = { ...row };
    if (out.cost_price !== null && out.cost_price !== undefined) {
      out.cost_price = Number(out.cost_price);
    }
    if (!includeCost) delete out.cost_price;
    return out;
  });

  return {
    items,
    total: count.rows[0].n,
    outlet: { id: scope.outlet_id, name: scope.outlet_name },
    can_view_profit: includeCost,
  };
};

export default { getCashierScope, listOutletProducts };
