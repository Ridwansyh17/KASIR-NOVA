-- ============================================================================
-- KASIR NOVA - Migrasi 0012: Setoran Kasir berbasis periode (settlement)
-- ============================================================================
-- Tujuan:
--   * Menyimpan setoran kasir yang DIHITUNG OTOMATIS dari transaksi (tunai &
--     QRIS) dan pengeluaran outlet pada satu periode/shift.
--   * Status baru: 'draft' dan 'completed'. Nilai lama 'recorded' tetap
--     dipertahankan sebagai setoran legacy (dianggap SELESAI) dan 'voided'
--     tetap dipakai untuk koreksi append-only.
--   * Menyimpan relasi transaksi & pengeluaran yang masuk ke setoran, unik
--     per transaksi/pengeluaran aktif sehingga tidak mungkin dihitung dua
--     kali. Saat setoran di-void, relasi dinonaktifkan agar bisa dikoreksi
--     lewat setoran baru tanpa menghapus riwayat.
--   * Menyimpan snapshot JSONB untuk cetak ulang struk tanpa menghitung ulang.
--
-- Catatan: penambahan nilai enum dijalankan di migrasi terpisah dari
-- penggunaannya (runner memakai satu transaksi per file).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enum status & metode
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  ALTER TYPE cash_deposit_status ADD VALUE IF NOT EXISTS 'draft';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE cash_deposit_status ADD VALUE IF NOT EXISTS 'completed';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Sumber dana pengeluaran "Dana Lain" (permintaan fitur setoran kasir).
DO $$ BEGIN
  ALTER TYPE expense_method ADD VALUE IF NOT EXISTS 'other';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Kolom perhitungan setoran pada cash_deposits (aman untuk data lama)
-- ---------------------------------------------------------------------------
ALTER TABLE cash_deposits
  ADD COLUMN IF NOT EXISTS settlement_no    TEXT,
  ADD COLUMN IF NOT EXISTS period_start     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS period_end       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS shift_label      TEXT,
  ADD COLUMN IF NOT EXISTS cash_revenue     BIGINT NOT NULL DEFAULT 0 CHECK (cash_revenue >= 0),
  ADD COLUMN IF NOT EXISTS qris_revenue     BIGINT NOT NULL DEFAULT 0 CHECK (qris_revenue >= 0),
  ADD COLUMN IF NOT EXISTS total_revenue    BIGINT NOT NULL DEFAULT 0 CHECK (total_revenue >= 0),
  ADD COLUMN IF NOT EXISTS total_expense    BIGINT NOT NULL DEFAULT 0 CHECK (total_expense >= 0),
  ADD COLUMN IF NOT EXISTS cash_expense     BIGINT NOT NULL DEFAULT 0 CHECK (cash_expense >= 0),
  ADD COLUMN IF NOT EXISTS noncash_expense  BIGINT NOT NULL DEFAULT 0 CHECK (noncash_expense >= 0),
  ADD COLUMN IF NOT EXISTS required_cash    BIGINT NOT NULL DEFAULT 0 CHECK (required_cash >= 0),
  ADD COLUMN IF NOT EXISTS actual_cash      BIGINT CHECK (actual_cash IS NULL OR actual_cash >= 0),
  ADD COLUMN IF NOT EXISTS difference       BIGINT,
  ADD COLUMN IF NOT EXISTS shortfall        BIGINT NOT NULL DEFAULT 0 CHECK (shortfall >= 0),
  ADD COLUMN IF NOT EXISTS cashier_note     TEXT,
  ADD COLUMN IF NOT EXISTS recipient_name   TEXT,
  ADD COLUMN IF NOT EXISTS snapshot         JSONB,
  ADD COLUMN IF NOT EXISTS completed_at     TIMESTAMPTZ;

-- Nominal setoran boleh 0 (tidak ada uang tunai wajib, mis. hanya QRIS).
ALTER TABLE cash_deposits DROP CONSTRAINT IF EXISTS cash_deposits_amount_check;
ALTER TABLE cash_deposits
  ADD CONSTRAINT cash_deposits_amount_check CHECK (amount >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_deposits_business_no
  ON cash_deposits (business_id, settlement_no)
  WHERE settlement_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cash_deposits_period
  ON cash_deposits (outlet_id, period_start, period_end)
  WHERE period_start IS NOT NULL AND period_end IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Relasi transaksi -> setoran (snapshot nominal per transaksi)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cash_deposit_transactions (
  deposit_id      UUID NOT NULL REFERENCES cash_deposits(id) ON DELETE CASCADE,
  transaction_id  UUID NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  invoice_no      TEXT,
  method          TEXT NOT NULL,
  amount          BIGINT NOT NULL CHECK (amount >= 0),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (deposit_id, transaction_id)
);

-- Satu transaksi hanya boleh berada di SATU setoran aktif.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_deposit_transactions_active
  ON cash_deposit_transactions (transaction_id)
  WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_cash_deposit_transactions_deposit
  ON cash_deposit_transactions (deposit_id);

-- ---------------------------------------------------------------------------
-- Relasi pengeluaran -> setoran
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cash_deposit_expenses (
  deposit_id  UUID NOT NULL REFERENCES cash_deposits(id) ON DELETE CASCADE,
  expense_id  UUID NOT NULL REFERENCES expenses(id) ON DELETE RESTRICT,
  category    expense_category NOT NULL,
  method      expense_method NOT NULL,
  note        TEXT,
  amount      BIGINT NOT NULL CHECK (amount > 0),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (deposit_id, expense_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_deposit_expenses_active
  ON cash_deposit_expenses (expense_id)
  WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_cash_deposit_expenses_deposit
  ON cash_deposit_expenses (deposit_id);
