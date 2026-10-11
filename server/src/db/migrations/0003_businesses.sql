-- ============================================================================
-- KASIR NOVA - Migrasi 0003: Businesses (Owner multi-bisnis)
-- ============================================================================
-- `businesses` adalah AKAR TENANT. Semua tabel bisnis berikutnya (outlets,
-- products, transactions, subscriptions, ...) membawa `business_id` ke sini.
--
-- Catatan:
--   - 1 owner -> banyak bisnis (FK owner_id).
--   - `currency` default IDR, `timezone` default Asia/Jakarta.
--   - `business_type` teks bebas (sesuai keputusan pemilik proyek).
--   - `deleted_at` untuk soft delete (belum ada endpoint hapus di Fase 3).
--   - Langganan TIDAK dibuat otomatis di sini (keputusan: bisnis dibuat bebas;
--     langganan diatur pada fase subscription).

CREATE TABLE IF NOT EXISTS businesses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  business_type TEXT,
  currency      TEXT NOT NULL DEFAULT 'IDR',
  timezone      TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  status        account_status NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

-- Indeks utama isolasi tenant: cari bisnis berdasarkan pemilik.
CREATE INDEX IF NOT EXISTS idx_businesses_owner
  ON businesses (owner_id) WHERE deleted_at IS NULL;

-- Trigger updated_at (fungsi set_updated_at dibuat di migrasi 0001)
DROP TRIGGER IF EXISTS trg_businesses_updated ON businesses;
CREATE TRIGGER trg_businesses_updated
  BEFORE UPDATE ON businesses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
