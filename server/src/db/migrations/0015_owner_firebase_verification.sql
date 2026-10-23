-- ============================================================================
-- KASIR NOVA - Migrasi 0015: Verifikasi email Owner via Firebase Authentication
-- ============================================================================
-- Menambahkan tautan identitas Firebase ke akun Owner TANPA mengubah password,
-- email, atau akun yang sudah ada.
--
-- Aturan kompatibilitas:
--   * Owner lama tetap `email_verification_method = 'manual'` dan
--     `email_verified_at` yang sudah ada TIDAK diubah.
--   * Pendaftaran mandiri baru memakai metode `firebase`; akun baru tetap
--     belum terverifikasi hingga Firebase menyatakan emailVerified = true.
--   * `firebase_uid` unik (partial index) mencegah dua Owner memakai identitas
--     Firebase yang sama.
--   * Tidak ada password yang disimpan/diubah oleh migrasi ini.

ALTER TABLE owners
  ADD COLUMN IF NOT EXISTS firebase_uid TEXT;

ALTER TABLE owners
  ADD COLUMN IF NOT EXISTS email_verification_method TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE owners
  ADD COLUMN IF NOT EXISTS firebase_verification_sent_at TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE owners
    ADD CONSTRAINT owners_email_verification_method_check
    CHECK (email_verification_method IN ('manual', 'firebase'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_owners_firebase_uid
  ON owners (firebase_uid)
  WHERE firebase_uid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_owners_firebase_unverified
  ON owners (created_at DESC)
  WHERE firebase_uid IS NOT NULL
    AND email_verified_at IS NULL
    AND deleted_at IS NULL;
