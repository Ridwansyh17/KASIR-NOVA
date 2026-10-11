/**
 * Layanan modul produk, kategori & stok (dimiliki Owner, scoped business_id).
 *
 * Aturan:
 *   - Semua operasi memverifikasi `business_id` (defense-in-depth) selain
 *     middleware tenant.
 *   - Nama produk / SKU / barcode unik per bisnis (case-insensitive) untuk
 *     produk AKTIF; konflik -> 409 dengan pesan spesifik.
 *   - Harga dalam sen (BIGINT); stok per outlet (product_stocks) dengan
 *     quantity >= 0.
 *   - Produk track_stock=false tidak memiliki baris stok; setStock ditolak.
 *   - Hapus produk/kategori = soft delete produk; kategori diblokir bila
 *     masih direferensikan produk aktif.
 *   - Setiap mutasi menulis audit di transaksi yang sama.
 */
import { query, withTransaction } from '../../config/db.js';
import { NotFoundError, ConflictError } from '../../middleware/error.js';
import { writeAudit } from '../audit/service.js';

export const PRODUCT_COLUMNS = `id, business_id, category_id, name, sku, barcode, price, track_stock, status, created_at, updated_at`;

const auditProduct = (p) =>
  p
    ? {
        id: p.id,
        name: p.name,
        sku: p.sku,
        barcode: p.barcode,
        price: p.price === null || p.price === undefined ? null : Number(p.price),
        category_id: p.category_id,
        track_stock: p.track_stock,
        status: p.status,
      }
    : null;

const auditCategory = (c) => (c ? { id: c.id, name: c.name } : null);

const mapUniqueConflict = (err) => {
  if (err?.code !== '23505') return err;
  // pg mengisi `constraint` (nama index) dan/atau `detail` (ekspresi kolom).
  const who = `${err.constraint ?? ''} | ${err.detail ?? ''}`;
  if (who.includes('uq_product_categories_biz_name_lower')) {
    return new ConflictError('Kategori dengan nama tersebut sudah ada');
  }
  if (who.includes('uq_products_biz_name_lower_active')) {
    return new ConflictError('Produk dengan nama tersebut sudah ada');
  }
  if (who.includes('uq_products_biz_sku_lower_active')) {
    return new ConflictError('SKU tersebut sudah dipakai produk lain');
  }
  if (who.includes('uq_products_biz_barcode_lower_active')) {
    return new ConflictError('Barcode tersebut sudah dipakai produk lain');
  }
  return new ConflictError('Data sudah ada');
};

// ================================================================ Kategori ==
export const listCategories = async (businessId) => {
  const { rows } = await query(
    `SELECT c.id, c.name, c.created_at,
            (SELECT count(*) FROM products p
              WHERE p.category_id = c.id AND p.deleted_at IS NULL) AS product_count
       FROM product_categories c
      WHERE c.business_id = $1
      ORDER BY c.name ASC`,
    [businessId]
  );
  return rows;
};

export const createCategory = async (businessId, data, actor, ip) => {
  try {
    return await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO product_categories (business_id, name) VALUES ($1, $2)
         RETURNING id, name, created_at`,
        [businessId, data.name]
      );
      const category = rows[0];
      await writeAudit({
        client,
        actorRole: actor.role,
        actorId: actor.id,
        businessId,
        action: 'category.create',
        entityType: 'product_category',
        entityId: category.id,
        after: auditCategory(category),
        ip,
      });
      return category;
    });
  } catch (err) {
    throw mapUniqueConflict(err);
  }
};

export const updateCategory = async (businessId, categoryId, data, actor, ip) => {
  try {
    return await withTransaction(async (client) => {
      const { rows: currentRows } = await client.query(
        `SELECT id, name FROM product_categories
          WHERE id = $1 AND business_id = $2 FOR UPDATE`,
        [categoryId, businessId]
      );
      const before = currentRows[0];
      if (!before) throw new NotFoundError('Kategori tidak ditemukan');

      const { rows } = await client.query(
        `UPDATE product_categories SET name = $1 WHERE id = $2 RETURNING id, name, created_at`,
        [data.name, categoryId]
      );
      await writeAudit({
        client,
        actorRole: actor.role,
        actorId: actor.id,
        businessId,
        action: 'category.update',
        entityType: 'product_category',
        entityId: categoryId,
        before: auditCategory(before),
        after: auditCategory(rows[0]),
        ip,
      });
      return rows[0];
    });
  } catch (err) {
    throw mapUniqueConflict(err);
  }
};

export const deleteCategory = async (businessId, categoryId, actor, ip) => {
  return withTransaction(async (client) => {
    const found = await client.query(
      `SELECT id, name FROM product_categories WHERE id = $1 AND business_id = $2 FOR UPDATE`,
      [categoryId, businessId]
    );
    const before = found.rows[0];
    if (!before) throw new NotFoundError('Kategori tidak ditemukan');

    const inUse = await client.query(
      `SELECT count(*)::int AS n FROM products
        WHERE category_id = $1 AND deleted_at IS NULL`,
      [categoryId]
    );
    if (inUse.rows[0].n > 0) {
      throw new ConflictError(
        `Kategori masih dipakai ${inUse.rows[0].n} produk aktif; pindahkan produk dulu`
      );
    }

    await client.query(`DELETE FROM product_categories WHERE id = $1`, [categoryId]);
    await writeAudit({
      client,
      actorRole: actor.role,
      actorId: actor.id,
      businessId,
      action: 'category.delete',
      entityType: 'product_category',
      entityId: categoryId,
      before: auditCategory(before),
      after: null,
      ip,
    });
    return { id: categoryId, deleted: true };
  });
};

// ================================================================ Produk ====
export const listProducts = async ({ businessId, filters }) => {
  const where = ['p.deleted_at IS NULL', 'p.business_id = $1'];
  const values = [businessId];
  let i = 2;
  if (filters.search) {
    where.push(`(lower(p.name) LIKE lower($${i++}) OR lower(COALESCE(p.sku,'')) LIKE lower($${i++}))`);
    values.push(`%${filters.search}%`, `%${filters.search}%`);
  }
  if (filters.categoryId) {
    where.push(`p.category_id = $${i++}`);
    values.push(filters.categoryId);
  }
  if (filters.status) {
    where.push(`p.status = $${i++}`);
    values.push(filters.status);
  }

  const whereSql = where.join(' AND ');
  const limit = filters.limit;
  const offset = (filters.page - 1) * limit;

  const { rows } = await query(
    `SELECT p.id, p.category_id, p.name, p.sku, p.barcode, p.price, p.track_stock,
            p.status, p.created_at, p.updated_at, c.name AS category_name,
            COALESCE(SUM(ps.quantity), 0)::int AS total_stock
       FROM products p
       LEFT JOIN product_categories c ON c.id = p.category_id
       LEFT JOIN product_stocks ps ON ps.product_id = p.id
      WHERE ${whereSql}
      GROUP BY p.id, c.name
      ORDER BY p.name ASC
      LIMIT $${i++} OFFSET $${i++}`,
    [...values, limit, offset]
  );

  const count = await query(
    `SELECT count(*)::int AS n FROM products p WHERE ${whereSql}`,
    values
  );

  return { items: rows, total: count.rows[0].n };
};

export const createProduct = async ({ businessId, data, actor, ip }) => {
  try {
    return await withTransaction(async (client) => {
      const biz = await client.query(
        `SELECT id, status FROM businesses WHERE id = $1 AND deleted_at IS NULL`,
        [businessId]
      );
      if (!biz.rows[0]) throw new NotFoundError('Bisnis tidak ditemukan');
      if (biz.rows[0].status !== 'active') {
        throw new ConflictError('Bisnis nonaktif; tidak dapat menambah produk');
      }

      if (data.categoryId) {
        const cat = await client.query(
          `SELECT id FROM product_categories WHERE id = $1 AND business_id = $2`,
          [data.categoryId, businessId]
        );
        if (!cat.rows[0]) throw new NotFoundError('Kategori tidak ditemukan');
      }

      const { rows } = await client.query(
        `INSERT INTO products (business_id, category_id, name, sku, barcode, price, track_stock, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
         RETURNING ${PRODUCT_COLUMNS}`,
        [
          businessId,
          data.categoryId ?? null,
          data.name,
          data.sku ?? null,
          data.barcode ?? null,
          data.price,
          data.trackStock,
        ]
      );
      const product = rows[0];

      // Produk dengan pelacakan stok punya baris stok 0 di SEMUA outlet aktif.
      if (data.trackStock) {
        await client.query(
          `INSERT INTO product_stocks (product_id, outlet_id)
           SELECT $1, id FROM outlets
            WHERE business_id = $2 AND deleted_at IS NULL`,
          [product.id, businessId]
        );
      }

      await writeAudit({
        client,
        actorRole: actor.role,
        actorId: actor.id,
        businessId,
        action: 'product.create',
        entityType: 'product',
        entityId: product.id,
        after: auditProduct(product),
        ip,
      });

      return product;
    });
  } catch (err) {
    throw mapUniqueConflict(err);
  }
};

export const getProduct = async (businessId, productId) => {
  const { rows } = await query(
    `SELECT p.id, p.business_id, p.category_id, p.name, p.sku, p.barcode,
            p.price, p.track_stock, p.status, p.created_at, p.updated_at,
            c.name AS category_name
       FROM products p
       LEFT JOIN product_categories c ON c.id = p.category_id
      WHERE p.id = $1 AND p.business_id = $2 AND p.deleted_at IS NULL`,
    [productId, businessId]
  );
  const product = rows[0];
  if (!product) throw new NotFoundError('Produk tidak ditemukan');

  const stocks = await query(
    `SELECT ps.outlet_id, o.name AS outlet_name, ps.quantity
       FROM product_stocks ps
       JOIN outlets o ON o.id = ps.outlet_id
      WHERE ps.product_id = $1
      ORDER BY o.name ASC`,
    [productId]
  );
  return { product, stocks: stocks.rows };
};

export const updateProduct = async (businessId, productId, patch, actor, ip) => {
  try {
    return await withTransaction(async (client) => {
      const { rows: currentRows } = await client.query(
        `SELECT ${PRODUCT_COLUMNS} FROM products
          WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [productId, businessId]
      );
      const before = currentRows[0];
      if (!before) throw new NotFoundError('Produk tidak ditemukan');

      const fields = [];
      const values = [];
      let i = 1;
      if (patch.name !== undefined) {
        fields.push(`name = $${i++}`);
        values.push(patch.name);
      }
      if (patch.sku !== undefined) {
        fields.push(`sku = $${i++}`);
        values.push(patch.sku);
      }
      if (patch.barcode !== undefined) {
        fields.push(`barcode = $${i++}`);
        values.push(patch.barcode);
      }
      if (patch.price !== undefined) {
        fields.push(`price = $${i++}`);
        values.push(patch.price);
      }
      if (patch.categoryId !== undefined) {
        if (patch.categoryId) {
          const cat = await client.query(
            `SELECT id FROM product_categories WHERE id = $1 AND business_id = $2`,
            [patch.categoryId, businessId]
          );
          if (!cat.rows[0]) throw new NotFoundError('Kategori tidak ditemukan');
        }
        fields.push(`category_id = $${i++}`);
        values.push(patch.categoryId);
      }
      if (patch.trackStock !== undefined) {
        fields.push(`track_stock = $${i++}`);
        values.push(patch.trackStock);
      }
      if (patch.status !== undefined) {
        fields.push(`status = $${i++}`);
        values.push(patch.status);
      }
      if (fields.length === 0) return before;

      values.push(productId);
      const { rows } = await client.query(
        `UPDATE products SET ${fields.join(', ')} WHERE id = $${i}
         RETURNING ${PRODUCT_COLUMNS}`,
        values
      );

      // Jika kini tidak melacak stok, hapus baris stoknya (stok lama hilang
      // sengaja — item tanpa stok tidak punya saldo).
      if (patch.trackStock === false) {
        await client.query(`DELETE FROM product_stocks WHERE product_id = $1`, [productId]);
      }

      await writeAudit({
        client,
        actorRole: actor.role,
        actorId: actor.id,
        businessId,
        action: 'product.update',
        entityType: 'product',
        entityId: productId,
        before: auditProduct(before),
        after: auditProduct(rows[0]),
        ip,
      });

      return rows[0];
    });
  } catch (err) {
    throw mapUniqueConflict(err);
  }
};

export const softDeleteProduct = async (businessId, productId, actor, ip) => {
  return withTransaction(async (client) => {
    const { rows: currentRows } = await client.query(
      `SELECT ${PRODUCT_COLUMNS} FROM products
        WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [productId, businessId]
    );
    const before = currentRows[0];
    if (!before) throw new NotFoundError('Produk tidak ditemukan');

    await client.query(`UPDATE products SET deleted_at = now() WHERE id = $1`, [productId]);

    await writeAudit({
      client,
      actorRole: actor.role,
      actorId: actor.id,
      businessId,
      action: 'product.delete',
      entityType: 'product',
      entityId: productId,
      before: auditProduct(before),
      after: { deleted_at: new Date().toISOString() },
      ip,
    });

    return { id: productId, deleted: true };
  });
};

// ================================================================== Stok ====
export const setStock = async (businessId, productId, outletId, quantity, actor, ip) => {
  return withTransaction(async (client) => {
    const product = await client.query(
      `SELECT id, name, track_stock FROM products
        WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [productId, businessId]
    );
    if (!product.rows[0]) throw new NotFoundError('Produk tidak ditemukan');
    if (!product.rows[0].track_stock) {
      throw new ConflictError('Produk ini tidak melacak stok');
    }

    const outlet = await client.query(
      `SELECT id, name FROM outlets
        WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
      [outletId, businessId]
    );
    if (!outlet.rows[0]) throw new NotFoundError('Outlet tidak ditemukan');

    const before = await client.query(
      `SELECT quantity FROM product_stocks WHERE product_id = $1 AND outlet_id = $2`,
      [productId, outletId]
    );

    const { rows } = await client.query(
      `INSERT INTO product_stocks (product_id, outlet_id, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (product_id, outlet_id)
       DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now()
       RETURNING product_id, outlet_id, quantity`,
      [productId, outletId, quantity]
    );

    await writeAudit({
      client,
      actorRole: actor.role,
      actorId: actor.id,
      businessId,
      action: 'stock.set',
      entityType: 'product_stock',
      entityId: rows[0].id,
      before: { quantity: before.rows[0]?.quantity ?? 0 },
      after: { quantity: rows[0].quantity },
      ip,
    });

    return {
      product_id: productId,
      product_name: product.rows[0].name,
      outlet_id: outletId,
      outlet_name: outlet.rows[0].name,
      quantity: rows[0].quantity,
    };
  });
};

export default {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  listProducts,
  createProduct,
  getProduct,
  updateProduct,
  softDeleteProduct,
  setStock,
};