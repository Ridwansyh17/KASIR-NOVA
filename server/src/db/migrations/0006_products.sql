-- ============================================================================
-- KASIR NOVA - Migrasi 0006: Produk, Kategori, Harga, Stok (Fase 6)
-- ============================================================================
--   product_categories : kategori produk milik satu bisnis (tenant).
--   products           : produk milik satu bisnis; harga dalam SEN (BIGINT);
--                        track_stock=false untuk jasa/item tanpa stok.
--   product_stocks     : stok per (produk x outlet); qty >= 0; satu baris per
--                        pasangan. Dipakai transaksi Fase 7 (row lock).
--
-- Aturan di skema:
--   - Nama produk unik per bisnis (case-insensitive) untuk yang belum
--     dihapus (index parsial WITH deleted_at IS NULL) sehingga nama bisa
--     dipakai lagi setelah soft delete.
--   - SKU/barcode unik per bisnis bila diisi.
--   - Kategori: FK ON DELETE SET NULL; penghapusan kategori diblokir layanan
--     bila masih direferensikan (409) — lihat service.
--   - Stok: UNIQUE (product_id, outlet_id); CHECK quantity >= 0 mencegah stok
--     negatif bahkan sebelum logika Fase 7 aktif.

CREATE TABLE IF NOT EXISTS product_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_categories_biz_name_lower
  ON product_categories (business_id, lower(name));

CREATE TABLE IF NOT EXISTS products (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  category_id  UUID REFERENCES product_categories(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  sku          TEXT,
  barcode      TEXT,
  price        BIGINT NOT NULL DEFAULT 0,
  track_stock  BOOLEAN NOT NULL DEFAULT TRUE,
  status       account_status NOT NULL DEFAULT 'active',
  deleted_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Nama unik per bisnis untuk produk AKTIF (soft delete masih menahan nama
-- selama barisnya ada; dibuat unik hanya untuk yang belum dihapus).
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_biz_name_lower_active
  ON products (business_id, lower(name)) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_biz_sku_lower_active
  ON products (business_id, lower(sku)) WHERE sku IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_biz_barcode_lower_active
  ON products (business_id, lower(barcode)) WHERE barcode IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_products_business ON products (business_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_products_category ON products (category_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS product_stocks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  outlet_id  UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  quantity   INT NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_stocks_product_outlet
  ON product_stocks (product_id, outlet_id);

CREATE INDEX IF NOT EXISTS idx_product_stocks_outlet ON product_stocks (outlet_id);

DROP TRIGGER IF EXISTS trg_product_categories_updated ON product_categories;
CREATE TRIGGER trg_product_categories_updated
  BEFORE UPDATE ON product_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_products_updated ON products;
CREATE TRIGGER trg_products_updated
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_product_stocks_updated ON product_stocks;
CREATE TRIGGER trg_product_stocks_updated
  BEFORE UPDATE ON product_stocks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();