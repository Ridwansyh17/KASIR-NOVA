-- ============================================================================
-- KASIR NOVA - Migrasi 0005: Kasir (Fase 5)
-- ============================================================================
-- Membuat tabel cashiers: 1 kasir = 1 outlet (outlet_id NOT NULL).
--
-- Aturan yang ditegakkan di skema:
--   - email UNIQUE case-insensitive (index lower(email)) => satu akun TIDAK
--     bisa didaftarkan ke dua outlet (kriteria selesai Fase 5).
--   - outlet_id FK NOT NULL => kasir selalu terikat tepat satu outlet.
--   - pin_hash TANPA isi dulu (login PIN dipakai saat area kasir tumbuh);
--     kolom sengaja dibuat sekarang agar tidak ada migrasi retak di tengah.
--   - created_by mencatat pembuat (Owner); ON DELETE SET NULL agar historis
--     tetap aman bila pemilik dihapus.

CREATE TABLE IF NOT EXISTS cashiers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id     UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  pin_hash      TEXT,
  full_name     TEXT NOT NULL,
  status        account_status NOT NULL DEFAULT 'active',
  created_by    UUID REFERENCES owners(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Satu email = satu kasir (case-insensitive) => 1 akun tidak bisa di 2 outlet.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cashiers_email_lower
  ON cashiers (lower(email));

CREATE INDEX IF NOT EXISTS idx_cashiers_outlet ON cashiers (outlet_id);

DROP TRIGGER IF EXISTS trg_cashiers_updated ON cashiers;
CREATE TRIGGER trg_cashiers_updated
  BEFORE UPDATE ON cashiers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();