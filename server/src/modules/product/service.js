/**
 * Layanan modul produk, kategori & stok (V0.3).
 *
 * Aturan:
 *   - Semua operasi memverifikasi `business_id` (defense-in-depth) selain
 *     middleware tenant.
 *   - Nama produk / SKU / barcode unik per bisnis (case-insensitive) untuk
 *     produk yang belum dihapus; konflik -> 409 dengan pesan spesifik.
 *   - Harga & HPP dalam sen (BIGINT); stok per outlet (product_stocks) dengan
 *     quantity >= 0.
 *   - HPP (`cost_price`) hanya dikembalikan/diubah bila pemanggil berizin
 *     (Owner selalu; Kasir bila `can_view_profit`). Parameter `includeCost`.
 *   - Ketersediaan (HABIS) adalah TURUNAN: `manual_out_of_stock` ATAU
 *     (`track_stock` DAN total stok <= 0). Tidak ada kolom status ganda.
 *   - Setiap perubahan stok menulis `inventory_movements` (append-only) +
 *     audit di transaksi yang sama.
 *   - Hapus produk = soft delete; kategori diblokir bila masih dipakai.
 */
import { query, withTransaction } from '../../config/db.js';
import { NotFoundError, ConflictError, ForbiddenError } from '../../middleware/error.js';
import { writeAudit } from '../audit/service.js';
import { enforceSubscriptionActive } from '../subscription/service.js';
import { recordMovement } from '../inventory/service.js';

export const PRODUCT_COLUMNS = `id, business_id, category_id, name, sku, barcode,
  price, cost_price, unit, photo_url, track_stock, status, manual_out_of_stock,
  stock_note, stock_status_changed_at, stock_status_changed_by_role,
  stock_status_changed_by_id, created_by_role, created_by_id, updated_by_role,
  updated_by_id, created_at, updated_at`;

const auditProduct = (p) =>
  p
    ? {
        id: p.id,
        name: p.name,
        sku: p.sku,
        barcode: p.barcode,
        price: p.price === null || p.price === undefined ? null : Number(p.price),
        cost_price:
          p.cost_price === null || p.cost_price === undefined ? null : Number(p.cost_price),
        unit: p.unit,
        category_id: p.category_id,
        track_stock: p.track_stock,
        status: p.status,
        manual_out_of_stock: p.manual_out_of_stock,
      }
    : null;

const auditCategory = (c) => (c ? { id: c.id, name: c.name } : null);

/** Sembunyikan HPP bila pemanggil tidak berizin (server-side, bukan UI). */
const serializeProduct = (row, includeCost) => {
  if (!row) return row;
  const out = { ...row };
  if (out.cost_price !== undefined && out.cost_price !== null) {
    out.cost_price = Number(out.cost_price);
  }
  if (!includeCost) delete out.cost_price;
  return out;
};

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

/**
 * Outlet yang dipakai untuk mencatat pergerakan stok: outlet terpilih bila
 * valid & milik bisnis, jika tidak outlet aktif pertama. `null` bila bisnis
 * belum punya outlet (pergerakan dilewati, tetap ada audit).
 */
const resolveOutletId = async (client, businessId, preferred) => {
  if (preferred) {
    const { rows } = await client.query(
      `SELECT id FROM outlets WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
      [preferred, businessId]
    );
    if (!rows[0]) throw new NotFoundError('Outlet tidak ditemukan');
    return rows[0].id;
  }
  const { rows } = await client.query(
    `SELECT id FROM outlets WHERE business_id = $1 AND deleted_at IS NULL
      ORDER BY created_at ASC LIMIT 1`,
    [businessId]
  );
  return rows[0]?.id ?? null;
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
      const biz = await client.query(
        `SELECT id, status FROM businesses WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [businessId]
      );
      if (!biz.rows[0]) throw new NotFoundError('Bisnis tidak ditemukan');
      if (biz.rows[0].status !== 'active') {
        throw new ConflictError('Bisnis nonaktif; tidak dapat menambah kategori');
      }
      // Gerbang langganan (Fase 10): kategori hanya untuk bisnis berlangganan aktif.
      await enforceSubscriptionActive(client, businessId);

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
/** Predikat ketersediaan (alias `b`): HABIS = manual ATAU stok terkontrol <= 0. */
const AVAILABILITY_SQL = {
  all: 'true',
  available: `(b.manual_out_of_stock = false AND (b.track_stock = false OR b.total_stock > 0))`,
  out_of_stock: `(b.manual_out_of_stock = true OR (b.track_stock = true AND b.total_stock <= 0))`,
};

const ORDER_SQL = {
  name: 'b.name ASC',
  stock_asc: 'b.total_stock ASC, b.name ASC',
  stock_desc: 'b.total_stock DESC, b.name ASC',
  recent: 'b.created_at DESC, b.name ASC',
};

export const listProducts = async ({ businessId, filters, includeCost = true }) => {
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
  const availSql = AVAILABILITY_SQL[filters.availability ?? 'all'];
  const orderSql = ORDER_SQL[filters.sort ?? 'name'];
  const limit = filters.limit;
  const offset = (filters.page - 1) * limit;

  const { rows } = await query(
    `WITH base AS (
       SELECT p.id, p.business_id, p.category_id, p.name, p.sku, p.barcode,
              p.price, p.cost_price, p.unit, p.photo_url, p.track_stock, p.status,
              p.manual_out_of_stock, p.stock_note, p.created_at, p.updated_at,
              c.name AS category_name,
              COALESCE(SUM(ps.quantity), 0)::int AS total_stock
         FROM products p
         LEFT JOIN product_categories c ON c.id = p.category_id
         LEFT JOIN product_stocks ps ON ps.product_id = p.id
        WHERE ${whereSql}
        GROUP BY p.id, c.name
     )
     SELECT b.*, (b.manual_out_of_stock OR (b.track_stock AND b.total_stock <= 0)) AS out_of_stock
       FROM base b
      WHERE ${availSql}
      ORDER BY ${orderSql}
      LIMIT $${i++} OFFSET $${i++}`,
    [...values, limit, offset]
  );

  const count = await query(
    `SELECT count(*)::int AS n FROM (
       SELECT p.id, p.track_stock, p.manual_out_of_stock,
              COALESCE(SUM(ps.quantity), 0) AS total_stock
         FROM products p
         LEFT JOIN product_stocks ps ON ps.product_id = p.id
        WHERE ${whereSql}
        GROUP BY p.id
     ) b
     WHERE ${availSql}`,
    values
  );

  return {
    items: rows.map((r) => serializeProduct(r, includeCost)),
    total: count.rows[0].n,
  };
};

export const createProduct = async ({ businessId, data, actor, ip, includeCost = true, outletId }) => {
  if (!includeCost && data.costPrice) {
    throw new ForbiddenError('Anda tidak memiliki izin mengisi harga modal (HPP)');
  }
  try {
    return await withTransaction(async (client) => {
      const biz = await client.query(
        `SELECT id, status FROM businesses WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [businessId]
      );
      if (!biz.rows[0]) throw new NotFoundError('Bisnis tidak ditemukan');
      if (biz.rows[0].status !== 'active') {
        throw new ConflictError('Bisnis nonaktif; tidak dapat menambah produk');
      }
      // Gerbang langganan (Fase 10): produk hanya untuk bisnis berlangganan aktif.
      await enforceSubscriptionActive(client, businessId);

      if (data.categoryId) {
        const cat = await client.query(
          `SELECT id FROM product_categories WHERE id = $1 AND business_id = $2`,
          [data.categoryId, businessId]
        );
        if (!cat.rows[0]) throw new NotFoundError('Kategori tidak ditemukan');
      }

      const { rows } = await client.query(
        `INSERT INTO products
           (business_id, category_id, name, sku, barcode, price, cost_price, unit,
            photo_url, track_stock, status, manual_out_of_stock, stock_note,
            created_by_role, created_by_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11,NULL,$12,$13)
         RETURNING ${PRODUCT_COLUMNS}`,
        [
          businessId,
          data.categoryId ?? null,
          data.name,
          data.sku ?? null,
          data.barcode ?? null,
          data.price,
          data.costPrice ?? 0,
          data.unit ?? null,
          data.photoUrl ?? null,
          data.trackStock,
          data.manualOutOfStock ?? false,
          actor.role,
          actor.id,
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

      // Stok awal (opsional) untuk outlet target.
      if (data.initialStock !== undefined && data.initialStock !== 0) {
        if (!data.trackStock) {
          throw new ConflictError('Produk tanpa pelacakan stok tidak dapat diberi stok awal');
        }
        if (!outletId) {
          throw new ConflictError('Tentukan outlet untuk stok awal');
        }
        await resolveOutletId(client, businessId, outletId);
        await client.query(
          `INSERT INTO product_stocks (product_id, outlet_id, quantity)
           VALUES ($1, $2, $3)
           ON CONFLICT (product_id, outlet_id)
           DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now()`,
          [product.id, outletId, data.initialStock]
        );
        await recordMovement(client, {
          businessId,
          outletId,
          productId: product.id,
          productName: product.name,
          type: 'initial',
          qtyBefore: 0,
          qtyAfter: data.initialStock,
          reason: 'Stok awal saat produk dibuat',
          actorRole: actor.role,
          actorId: actor.id,
        });
      }

      // Tandai habis manual saat dibuat.
      if (data.manualOutOfStock) {
        const target = await resolveOutletId(client, businessId, outletId);
        await client.query(
          `UPDATE products
              SET stock_status_changed_at = now(),
                  stock_status_changed_by_role = $2, stock_status_changed_by_id = $3
            WHERE id = $1`,
          [product.id, actor.role, actor.id]
        );
        if (target) {
          await recordMovement(client, {
            businessId,
            outletId: target,
            productId: product.id,
            productName: product.name,
            type: 'mark_out',
            qtyBefore: 0,
            qtyAfter: 0,
            reason: 'Ditandai habis saat produk dibuat',
            actorRole: actor.role,
            actorId: actor.id,
          });
        }
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

      return serializeProduct(product, includeCost);
    });
  } catch (err) {
    throw mapUniqueConflict(err);
  }
};

export const getProduct = async (businessId, productId, { includeCost = true } = {}) => {
  const { rows } = await query(
    `SELECT p.id, p.business_id, p.category_id, p.name, p.sku, p.barcode,
            p.price, p.cost_price, p.unit, p.photo_url, p.track_stock, p.status,
            p.manual_out_of_stock, p.stock_note, p.created_at, p.updated_at,
            p.created_by_role, p.created_by_id, p.updated_by_role, p.updated_by_id,
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

  const totalStock = stocks.rows.reduce((a, s) => a + Number(s.quantity), 0);
  const outOfStock =
    product.manual_out_of_stock || (product.track_stock && totalStock <= 0);

  return {
    product: { ...serializeProduct(product, includeCost), out_of_stock: outOfStock },
    stocks: stocks.rows,
  };
};

export const updateProduct = async (
  businessId,
  productId,
  patch,
  actor,
  ip,
  { includeCost = true } = {}
) => {
  if (!includeCost && patch.costPrice !== undefined) {
    throw new ForbiddenError('Anda tidak memiliki izin mengubah harga modal');
  }

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
      const set = (column, value) => {
        fields.push(`${column} = $${i++}`);
        values.push(value);
      };

      if (patch.name !== undefined) set('name', patch.name);
      if (patch.sku !== undefined) set('sku', patch.sku);
      if (patch.barcode !== undefined) set('barcode', patch.barcode);
      if (patch.price !== undefined) set('price', patch.price);
      if (patch.costPrice !== undefined) set('cost_price', patch.costPrice);
      if (patch.unit !== undefined) set('unit', patch.unit);
      if (patch.photoUrl !== undefined) set('photo_url', patch.photoUrl);
      if (patch.stockNote !== undefined) set('stock_note', patch.stockNote);
      if (patch.categoryId !== undefined) {
        if (patch.categoryId) {
          const cat = await client.query(
            `SELECT id FROM product_categories WHERE id = $1 AND business_id = $2`,
            [patch.categoryId, businessId]
          );
          if (!cat.rows[0]) throw new NotFoundError('Kategori tidak ditemukan');
        }
        set('category_id', patch.categoryId);
      }

      // Perubahan status habis manual ikut mencatat jejak + pergerakan stok.
      const outOfStockChanged =
        patch.manualOutOfStock !== undefined && patch.manualOutOfStock !== before.manual_out_of_stock;
      if (patch.manualOutOfStock !== undefined) {
        set('manual_out_of_stock', patch.manualOutOfStock);
      }
      if (outOfStockChanged) {
        fields.push(`stock_status_changed_at = now()`);
        fields.push(`stock_status_changed_by_role = $${i++}`);
        values.push(actor.role);
        fields.push(`stock_status_changed_by_id = $${i++}`);
        values.push(actor.id);
      }

      let trackStockChanged = false;
      if (patch.trackStock !== undefined && patch.trackStock !== before.track_stock) {
        set('track_stock', patch.trackStock);
        trackStockChanged = true;
      }
      if (patch.status !== undefined) set('status', patch.status);

      // Jejak pengubah terakhir (identitas pengguna).
      fields.push(`updated_by_role = $${i++}`);
      values.push(actor.role);
      fields.push(`updated_by_id = $${i++}`);
      values.push(actor.id);

      values.push(productId);
      const { rows } = await client.query(
        `UPDATE products SET ${fields.join(', ')} WHERE id = $${i}
         RETURNING ${PRODUCT_COLUMNS}`,
        values
      );
      const product = rows[0];

      const targetOutlet = await resolveOutletId(client, businessId, null);

      // Pelacakan stok dimatikan: saldo lama dibuang (tercatat sebagai koreksi).
      if (trackStockChanged && patch.trackStock === false) {
        const removed = await client.query(
          `DELETE FROM product_stocks WHERE product_id = $1
           RETURNING outlet_id, quantity`,
          [productId]
        );
        if (targetOutlet) {
          for (const row of removed.rows) {
            if (Number(row.quantity) === 0) continue;
            await recordMovement(client, {
              businessId,
              outletId: row.outlet_id,
              productId,
              productName: product.name,
              type: 'adjustment',
              qtyBefore: Number(row.quantity),
              qtyAfter: 0,
              reason: 'Pelacakan stok dimatikan',
              actorRole: actor.role,
              actorId: actor.id,
            });
          }
        }
      }

      // Pelacakan stok dinyalakan: buat baris stok 0 untuk semua outlet aktif.
      if (trackStockChanged && patch.trackStock === true) {
        await client.query(
          `INSERT INTO product_stocks (product_id, outlet_id)
           SELECT $1, id FROM outlets
            WHERE business_id = $2 AND deleted_at IS NULL
           ON CONFLICT (product_id, outlet_id) DO NOTHING`,
          [productId, businessId]
        );
      }

      // Perubahan status habis manual -> catat pergerakan (tanpa ubah qty).
      if (outOfStockChanged && targetOutlet) {
        await recordMovement(client, {
          businessId,
          outletId: targetOutlet,
          productId,
          productName: product.name,
          type: patch.manualOutOfStock ? 'mark_out' : 'restore',
          qtyBefore: 0,
          qtyAfter: 0,
          reason: patch.manualOutOfStock
            ? patch.stockNote ?? 'Ditandai habis manual'
            : 'Diaktifkan kembali',
          actorRole: actor.role,
          actorId: actor.id,
        });
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
        after: auditProduct(product),
        ip,
      });

      return serializeProduct(product, includeCost);
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
export const setStock = async (
  businessId,
  productId,
  outletId,
  quantity,
  actor,
  ip,
  { reason = null } = {}
) => {
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

    const beforeQty = Number(before.rows[0]?.quantity ?? 0);
    const afterQty = Number(rows[0].quantity);
    if (beforeQty !== afterQty) {
      await recordMovement(client, {
        businessId,
        outletId,
        productId,
        productName: product.rows[0].name,
        type: 'adjustment',
        qtyBefore: beforeQty,
        qtyAfter: afterQty,
        reason: reason ?? 'Penyesuaian stok manual',
        actorRole: actor.role,
        actorId: actor.id,
      });
    }

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

/**
 * Tandai HABIS manual / aktifkan kembali (Fase 2).
 *
 * "Aktifkan kembali" memeriksa stok: produk berpelacakan stok TIDAK boleh
 * diaktifkan selama stok masih 0 (harus diisi dulu) dan produk harus aktif.
 */
export const setStockStatus = async (
  businessId,
  productId,
  { outOfStock, note = null },
  actor,
  ip,
  { outletId = null, includeCost = true } = {}
) => {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT ${PRODUCT_COLUMNS} FROM products
        WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [productId, businessId]
    );
    const product = rows[0];
    if (!product) throw new NotFoundError('Produk tidak ditemukan');

    if (product.manual_out_of_stock === outOfStock) {
      return { product: serializeProduct(product, includeCost), changed: false };
    }

    const targetOutlet = await resolveOutletId(client, businessId, outletId);

    if (!outOfStock) {
      if (product.status !== 'active') {
        throw new ConflictError('Produk sedang nonaktif; aktifkan status produk terlebih dahulu');
      }
      if (product.track_stock) {
        const stock = await client.query(
          `SELECT COALESCE(SUM(ps.quantity), 0)::int AS total
             FROM product_stocks ps
            WHERE ps.product_id = $1
              AND ($2::uuid IS NULL OR ps.outlet_id = $2)`,
          [productId, targetOutlet]
        );
        if (stock.rows[0].total <= 0) {
          throw new ConflictError(
            'Stok masih 0; isi stok outlet terlebih dahulu sebelum mengaktifkan kembali'
          );
        }
      }
    }

    const { rows: updated } = await client.query(
      `UPDATE products
          SET manual_out_of_stock = $2,
              stock_note = $3,
              stock_status_changed_at = now(),
              stock_status_changed_by_role = $4,
              stock_status_changed_by_id = $5,
              updated_by_role = $4,
              updated_by_id = $5
        WHERE id = $1
        RETURNING ${PRODUCT_COLUMNS}`,
      [productId, outOfStock, note, actor.role, actor.id]
    );

    if (targetOutlet) {
      await recordMovement(client, {
        businessId,
        outletId: targetOutlet,
        productId,
        productName: product.name,
        type: outOfStock ? 'mark_out' : 'restore',
        qtyBefore: 0,
        qtyAfter: 0,
        reason: note ?? (outOfStock ? 'Ditandai habis manual' : 'Diaktifkan kembali'),
        actorRole: actor.role,
        actorId: actor.id,
      });
    }

    await writeAudit({
      client,
      actorRole: actor.role,
      actorId: actor.id,
      businessId,
      action: outOfStock ? 'product.mark_out_of_stock' : 'product.restore_stock',
      entityType: 'product',
      entityId: productId,
      before: { manual_out_of_stock: product.manual_out_of_stock },
      after: { manual_out_of_stock: outOfStock, note },
      ip,
    });

    return { product: serializeProduct(updated[0], includeCost), changed: true };
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
  setStockStatus,
};
