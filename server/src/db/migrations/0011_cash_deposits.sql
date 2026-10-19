-- ============================================================================
-- KASIR NOVA - Migrasi 0011: Setoran Kas (Deposit) kasir ke Owner
-- ============================================================================
-- Tujuan: mencatat uang tunai yang disetorkan kasir ke pemilik/outlet
--         (append-only: koreksi via void, tidak hard delete).
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE cash_deposit_method AS ENUM ('cash');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE cash_deposit_status AS ENUM ('recorded', 'voided');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS cash_deposits (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  outlet_id        UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  amount           BIGINT NOT NULL CHECK (amount > 0),
  method           cash_deposit_method NOT NULL DEFAULT 'cash',
  note             TEXT,
  receipt_url      TEXT,
  status           cash_deposit_status NOT NULL DEFAULT 'recorded',
  deposited_on     DATE NOT NULL,
  cashier_id       UUID REFERENCES cashiers(id) ON DELETE SET NULL,
  created_by_role  user_role NOT NULL,
  created_by_id    UUID NOT NULL,
  voided_at        TIMESTAMPTZ,
  voided_by_role   user_role,
  voided_by_id     UUID,
  void_reason      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cash_deposits_business_date
  ON cash_deposits (business_id, deposited_on DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_deposits_outlet_date
  ON cash_deposits (outlet_id, deposited_on DESC, created_at DESC);

DROP TRIGGER IF EXISTS trg_cash_deposits_updated ON cash_deposits;
CREATE TRIGGER trg_cash_deposits_updated
  BEFORE UPDATE ON cash_deposits
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
