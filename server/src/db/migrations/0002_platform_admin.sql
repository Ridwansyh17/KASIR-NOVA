-- ============================================================================
-- KASIR NOVA - Migrasi 0002: Integritas email & soft delete Owner
-- ============================================================================
-- 1. Email unik TANPA membedakan huruf besar/kecil (case-insensitive).
--    Tanpa ini, "A@x.com" dan "a@x.com" bisa menjadi dua akun berbeda,
--    padahal login membandingkan lower(email) -> berpotensi ambigu.
-- 2. Kolom deleted_at untuk SOFT DELETE owner: akun dinonaktifkan & hilang
--    dari daftar, tetapi baris tetap ada agar relasi (bisnis/transaksi nanti)
--    tidak menjadi yatim. Penghapusan fisik tidak dilakukan.

-- Index unik case-insensitive
CREATE UNIQUE INDEX IF NOT EXISTS ux_owners_email_lower
  ON owners (lower(email));

CREATE UNIQUE INDEX IF NOT EXISTS ux_platform_admins_email_lower
  ON platform_admins (lower(email));

-- Soft delete owner
ALTER TABLE owners ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_owners_status_active
  ON owners (status) WHERE deleted_at IS NULL;
