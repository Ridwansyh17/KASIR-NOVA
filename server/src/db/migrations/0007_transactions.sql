-- ============================================================================
-- KASIR NOVA - Migrasi 0007: Transaksi Penjualan (Fase 7)
-- ============================================================================
-- Keputusan bisnis (docs/11-keputusan-menunggu.md, #2):
--   - Pajak = konfigurasi PER OUTLET (kolom `tax_inclusive` + `tax_rate`).
--   - Diskon = per transaksi (persen & nominal), kasir tanpa batas nominal.
--   - Void (oleh Owner) MENGEMBALIKAN stok otomatis.
--   - Pembayaran = tunai + metode lain (kartu/QR/wallet) dicatat manual,
--     tanpa gateway; SATU pembayaran per transaksi (split = fase lanjut).
--
--   transactions        : kepala transaksi (nominal sen; snapshot tarif pajak).
--   transaction_items   : baris item + snapshot nama/harga produk.
--   payments            : pembayaran (method cash/card/qr/wallet).
--   outlet_invoice_counters : penomoran invoice atomik per (outlet, hari).
--
-- Jaminan atomik: penjualan mengurangi stok + mencatat item/pajak/total dalam
-- SATU transaksi DB (BEGIN/COMMIT) dan mengunci baris stok (UPDATE ... WHERE
-- quantity >= qty) sehingga penjualan konkuren tidak menghasilkan stok negatif.

-- ============================================================================
-- Konfigurasi pajak per outlet
-- ============================================================================
ALTER TABLE outlets
  ADD COLUMN IF NOT EXISTS tax_inclusive BOOLEAN NOT NULL DEFAULT false;

-- ============================================================================
-- Enum status transaksi
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE transaction_status AS ENUM ('completed', 'voided', 'refunded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- Penomoran invoice atomik per outlet per hari
-- ============================================================================
CREATE TABLE IF NOT EXISTS outlet_invoice_counters (
  outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  day       DATE NOT NULL,
  last_seq  INTEGER NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  PRIMARY KEY (outlet_id, day)
);

-- ============================================================================
-- transactions
-- ============================================================================
CREATE TABLE IF NOT EXISTS transactions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  outlet_id      UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  cashier_id     UUID REFERENCES cashiers(id) ON DELETE SET NULL,
  invoice_no     TEXT NOT NULL,
  status         transaction_status NOT NULL DEFAULT 'completed',
  subtotal       BIGINT NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount_type  TEXT CHECK (discount_type IN ('percent', 'amount')),
  discount_value BIGINT CHECK (discount_value IS NULL OR discount_value >= 0),
  discount_total BIGINT NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  tax_rate       NUMERIC(5,2) NOT NULL DEFAULT 0,
  tax_inclusive  BOOLEAN NOT NULL DEFAULT false,
  tax_total      BIGINT NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  total          BIGINT NOT NULL DEFAULT 0 CHECK (total >= 0),
  paid_amount    BIGINT NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  change_amount  BIGINT NOT NULL DEFAULT 0 CHECK (change_amount >= 0),
  note           TEXT,
  client_ref     UUID,
  voided_at      TIMESTAMPTZ,
  voided_by      UUID REFERENCES owners(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Nomor invoice unik per outlet.
CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_outlet_invoice
  ON transactions (outlet_id, invoice_no);

-- Anti-duplikasi: permintaan ulang dengan client_ref sama = transaksi yang sama.
CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_outlet_client_ref
  ON transactions (outlet_id, client_ref) WHERE client_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_business_created
  ON transactions (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_outlet_created
  ON transactions (outlet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_cashier ON transactions (cashier_id);

-- ============================================================================
-- transaction_items
-- ============================================================================
CREATE TABLE IF NOT EXISTS transaction_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  product_id      UUID REFERENCES products(id) ON DELETE SET NULL,
  product_name    TEXT NOT NULL,
  sku             TEXT,
  unit_price      BIGINT NOT NULL CHECK (unit_price >= 0),
  qty             INTEGER NOT NULL CHECK (qty > 0),
  discount_amount BIGINT NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  tax_amount      BIGINT NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  line_total      BIGINT NOT NULL CHECK (line_total >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transaction_items_transaction
  ON transaction_items (transaction_id);
CREATE INDEX IF NOT EXISTS idx_transaction_items_product
  ON transaction_items (product_id);

-- ============================================================================
-- payments
-- ============================================================================
CREATE TABLE IF NOT EXISTS payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  method          TEXT NOT NULL CHECK (method IN ('cash', 'card', 'qr', 'wallet')),
  amount          BIGINT NOT NULL CHECK (amount >= 0),
  reference       TEXT,
  provider        TEXT,
  status          TEXT NOT NULL DEFAULT 'paid'
                    CHECK (status IN ('paid', 'pending', 'failed', 'refunded')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_transaction ON payments (transaction_id);

-- ============================================================================
-- Invarian stok: setiap produk ber-`track_stock` punya baris stok di SETIAP
-- outlet aktif. Backfill untuk data lama + outlet yang dibuat sebelum migrasi.
-- ============================================================================
INSERT INTO product_stocks (product_id, outlet_id)
SELECT p.id, o.id
  FROM products p
 CROSS JOIN outlets o
 WHERE p.track_stock = true
   AND p.deleted_at IS NULL
   AND o.deleted_at IS NULL
ON CONFLICT (product_id, outlet_id) DO NOTHING;

-- ============================================================================
-- Trigger updated_at
-- ============================================================================
DROP TRIGGER IF EXISTS trg_transactions_updated ON transactions;
CREATE TRIGGER trg_transactions_updated
  BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
