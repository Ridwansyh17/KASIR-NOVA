-- ============================================================================
-- KASIR NOVA - Migrasi 0004: Outlet & Langganan (Fase 4)
-- ============================================================================
-- Membuat:
--   - subscription_plans (paket: kuota outlet/kasir, harga sen, durasi hari)
--   - subscriptions    (1 langganan AKTIF per bisnis; riwayat diperbolehkan)
--   - outlets          (tenant business_id; tax_rate NUMERIC(5,2); soft delete)
--   - Enum subscription_status ('active','past_due','expired')
--
-- Keputusan bisnis (docs/11-keputusan-menunggu.md, #1 = OPSI A):
--   Setiap bisnis BARU otomatis mendapat PLAN DEFAULT "Gratis"
--   (max_outlets=1, max_cashiers=1, harga 0, durasi 30 hari).
--   Plan default disemai di sini (data referensi operasional, bukan data dev),
--   sehingga ada di lingkungan mana pun migrasi dijalankan.

-- ============================================================================
-- Enum
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE subscription_status AS ENUM ('active', 'past_due', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- subscription_plans
-- ============================================================================
CREATE TABLE IF NOT EXISTS subscription_plans (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL UNIQUE,
  max_outlets   INTEGER NOT NULL DEFAULT 1 CHECK (max_outlets >= 0),
  max_cashiers  INTEGER NOT NULL DEFAULT 1 CHECK (max_cashiers >= 0),
  price         BIGINT NOT NULL DEFAULT 0 CHECK (price >= 0), -- dalam sen
  duration_days INTEGER NOT NULL DEFAULT 30 CHECK (duration_days > 0),
  features      JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  is_default    BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Paling banyak SATU paket default (penanda untuk bisnis baru).
CREATE UNIQUE INDEX IF NOT EXISTS uq_subscription_plans_default
  ON subscription_plans (is_default) WHERE is_default;

-- Seed paket default "Gratis" (data referensi operasional).
INSERT INTO subscription_plans (name, max_outlets, max_cashiers, price, duration_days, is_default)
VALUES ('Gratis', 1, 1, 0, 30, true)
ON CONFLICT (name) DO NOTHING;

DROP TRIGGER IF EXISTS trg_subscription_plans_updated ON subscription_plans;
CREATE TRIGGER trg_subscription_plans_updated
  BEFORE UPDATE ON subscription_plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- subscriptions — 1 aktif per bisnis
-- ============================================================================
CREATE TABLE IF NOT EXISTS subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  plan_id     UUID NOT NULL REFERENCES subscription_plans(id),
  status      subscription_status NOT NULL DEFAULT 'active',
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ,
  auto_renew  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Batasi: maksimal SATU langganan berstatus active per bisnis.
-- Index parsial (WHERE status='active') => riwayat non-aktif tetap tersimpan.
CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriptions_active_per_business
  ON subscriptions (business_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_subscriptions_business ON subscriptions (business_id);

DROP TRIGGER IF EXISTS trg_subscriptions_updated ON subscriptions;
CREATE TRIGGER trg_subscriptions_updated
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- outlets — tenant business_id
-- ============================================================================
CREATE TABLE IF NOT EXISTS outlets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  address     TEXT,
  phone       TEXT,
  tax_rate    NUMERIC(5,2) NOT NULL DEFAULT 0,
  status      account_status NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_outlets_business ON outlets (business_id) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_outlets_updated ON outlets;
CREATE TRIGGER trg_outlets_updated
  BEFORE UPDATE ON outlets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();