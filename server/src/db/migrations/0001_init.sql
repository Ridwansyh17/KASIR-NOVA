-- ============================================================================
-- KASIR NOVA - Migrasi 0001: Skema dasar
-- ============================================================================
-- Membuat: pgcrypto (UUID), tipe enum peran, dan tabel fondasi:
--   platform_admins, owners, refresh_tokens, audit_logs
--
-- Catatan keamanan:
--   - Admin Platform TIDAK dibuat di sini; hanya lewat seeding internal.
--   - refresh_tokens menyimpan HASH, bukan token plain.
--   - audit_logs hanya append (tidak ada endpoint hapus).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- Tipe enum
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('platform_admin', 'owner', 'cashier');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE account_status AS ENUM ('active', 'suspended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- platform_admins
-- ============================================================================
CREATE TABLE IF NOT EXISTS platform_admins (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  status        account_status NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- owners
-- ============================================================================
CREATE TABLE IF NOT EXISTS owners (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  full_name       TEXT NOT NULL,
  phone           TEXT,
  status          account_status NOT NULL DEFAULT 'active',
  created_by      UUID REFERENCES platform_admins(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_owners_created_by ON owners(created_by);

-- ============================================================================
-- refresh_tokens - sesi dengan pencabutan
-- ============================================================================
-- Token disimpan sebagai HASH agar bocornya DB tidak langsung membuka sesi.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_role   user_role NOT NULL,
  user_id     UUID NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip          TEXT,
  user_agent  TEXT
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_role, user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);

-- ============================================================================
-- audit_logs - hanya append
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_role   user_role NOT NULL,
  actor_id     UUID NOT NULL,
  business_id  UUID,
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    UUID,
  before       JSONB,
  after        JSONB,
  ip           TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_business_created ON audit_logs(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_role, actor_id, created_at DESC);

-- ============================================================================
-- Trigger: updated_at otomatis
-- ============================================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_platform_admins_updated ON platform_admins;
CREATE TRIGGER trg_platform_admins_updated
  BEFORE UPDATE ON platform_admins
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_owners_updated ON owners;
CREATE TRIGGER trg_owners_updated
  BEFORE UPDATE ON owners
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
