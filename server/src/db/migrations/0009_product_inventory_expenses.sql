-- ============================================================================
-- KASIR NOVA - Migrasi 0009: V0.3 (Produk lanjutan, Inventori, Pengeluaran)
-- ============================================================================
-- Cakupan:
--   Fase 1 (Product management) : HPP/cost_price, satuan, foto, jejak pengubah.
--   Fase 2 (Stok habis)         : manual_out_of_stock + inventory_movements.
--   Fase 4/6 (Laba)             : snapshot cost_price di transaction_items,
--                                 fee_amount di payments.
--   Fase 5 (Pengeluaran outlet) : tabel expenses + enum kategori/status.
--
-- Prinsip:
--   - Semua nominal SEN (BIGINT), bukan desimal.
--   - TIDAK ada penghapusan data finansial: expenses memakai status
--     'recorded' -> 'voided' (soft), inventory_movements bersifat append.
--   - Aman untuk data lama: semua kolom baru punya DEFAULT.
--   - HPP tidak pernah negatif; costs lama = 0 (tidak diketahui).
-- ============================================================================

-- ============================================================================
-- Enum
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE expense_category AS ENUM (
    'operational',         -- Operasional
    'utilities',           -- Listrik dan Air
    'supplies',            -- Perlengkapan
    'transport',           -- Transportasi
    'maintenance',         -- Perawatan
    'inventory_purchase',  -- Pembelian persediaan dagang (dikecualikan dari laba)
    'other'                -- Lainnya
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE expense_status AS ENUM ('recorded', 'voided');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE expense_method AS ENUM ('cash', 'transfer', 'qr');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE inventory_movement_type AS ENUM (
    'initial',     -- stok awal saat produk dibuat
    'adjustment',  -- koreksi manual (atur stok)
    'sale',        -- penjualan (stok berkurang)
    'void',        -- pembatalan transaksi (stok kembali)
    'refund',      -- pengembalian dana (stok kembali)
    'mark_out',    -- tandai habis manual (tidak mengubah qty)
    'restore'      -- aktifkan kembali (tidak mengubah qty)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- Fase 1: produk lanjutan
-- ============================================================================
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS cost_price  BIGINT NOT NULL DEFAULT 0
    CHECK (cost_price >= 0);
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS unit        TEXT;
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS photo_url   TEXT;
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS created_by_role user_role;
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS created_by_id   UUID;
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS updated_by_role user_role;
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS updated_by_id   UUID;

-- Fase 2: status habis manual (di samping status keaktifan produk).
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS manual_out_of_stock BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS stock_note          TEXT;
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS stock_status_changed_at TIMESTAMPTZ;
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS stock_status_changed_by_role user_role;
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS stock_status_changed_by_id   UUID;

-- ============================================================================
-- Fase 4/6: snapshot HPP di item transaksi + biaya transaksi di pembayaran
-- ============================================================================
ALTER TABLE transaction_items
  ADD COLUMN IF NOT EXISTS cost_price BIGINT NOT NULL DEFAULT 0
    CHECK (cost_price >= 0);

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS fee_amount BIGINT NOT NULL DEFAULT 0
    CHECK (fee_amount >= 0);

CREATE INDEX IF NOT EXISTS idx_transaction_items_cost
  ON transaction_items (product_id) WHERE cost_price > 0;

-- ============================================================================
-- Fase 1: izin melihat data keuntungan (HPP) untuk kasir
--   Owner SELALU boleh (tidak perlu flag). Kasir opt-in oleh Owner.
-- ============================================================================
ALTER TABLE cashiers
  ADD COLUMN IF NOT EXISTS can_view_profit BOOLEAN NOT NULL DEFAULT false;

-- ============================================================================
-- Fase 2: histori pergerakan stok (append-only)
-- ============================================================================
CREATE TABLE IF NOT EXISTS inventory_movements (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  outlet_id    UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  product_id   UUID REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  type         inventory_movement_type NOT NULL,
  qty_delta    INTEGER NOT NULL,
  qty_before   INTEGER NOT NULL CHECK (qty_before >= 0),
  qty_after    INTEGER NOT NULL CHECK (qty_after >= 0),
  reason       TEXT,
  ref_type     TEXT,
  ref_id       UUID,
  actor_role   user_role,
  actor_id     UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_business
  ON inventory_movements (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_outlet
  ON inventory_movements (outlet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_product
  ON inventory_movements (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_ref
  ON inventory_movements (ref_type, ref_id);

-- ============================================================================
-- Fase 5: pengeluaran outlet (append + koreksi via status, tanpa hard delete)
-- ============================================================================
CREATE TABLE IF NOT EXISTS expenses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  outlet_id     UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  category      expense_category NOT NULL,
  amount        BIGINT NOT NULL CHECK (amount > 0),
  method        expense_method NOT NULL DEFAULT 'cash',
  note          TEXT,
  receipt_url   TEXT,
  status        expense_status NOT NULL DEFAULT 'recorded',
  spent_on      DATE NOT NULL,
  cashier_id    UUID REFERENCES cashiers(id) ON DELETE SET NULL,
  created_by_role user_role NOT NULL,
  created_by_id   UUID NOT NULL,
  voided_at     TIMESTAMPTZ,
  voided_by_role user_role,
  voided_by_id  UUID,
  void_reason   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expenses_business_date
  ON expenses (business_id, spent_on DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_outlet_date
  ON expenses (outlet_id, spent_on DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category
  ON expenses (business_id, category) WHERE status = 'recorded';

DROP TRIGGER IF EXISTS trg_expenses_updated ON expenses;
CREATE TRIGGER trg_expenses_updated
  BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
