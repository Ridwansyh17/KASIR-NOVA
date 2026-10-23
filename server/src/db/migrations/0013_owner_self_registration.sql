-- ============================================================================
-- KASIR NOVA - Migrasi 0013: Pendaftaran Owner Mandiri + Verifikasi Email
-- ============================================================================
-- Alur baru (23 Okt 2026):
--   Owner mendaftar sendiri dari panel Owner -> server membuat akun BELUM
--   terverifikasi + token verifikasi (disimpan sebagai HASH) -> email berisi
--   tautan -> setelah tautan dibuka, akun terverifikasi dan bisnis pertama
--   dibuat otomatis dengan langganan Gratis 30 hari.
--
-- Catatan kompatibilitas:
--   * `email_verified_at` NULL-able dengan DEFAULT now(): owner yang sudah ada
--     (dibuat Admin) langsung dianggap terverifikasi, sedangkan pendaftaran
--     mandiri secara eksplisit mengisi NULL untuk menandai "menunggu
--     verifikasi".
--   * Token verifikasi TIDAK PERNAH disimpan dalam bentuk asli.

ALTER TABLE owners
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE owners
  ADD COLUMN IF NOT EXISTS email_verification_token_hash TEXT;

ALTER TABLE owners
  ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMPTZ;

-- Nama bisnis yang dimasukkan saat mendaftar; bisnis baru dibuat setelah
-- email terverifikasi agar masa trial 30 hari tidak terpotong.
ALTER TABLE owners
  ADD COLUMN IF NOT EXISTS pending_business_name TEXT;

-- Pencarian token verifikasi saat tautan diklik.
CREATE INDEX IF NOT EXISTS idx_owners_verification_token
  ON owners (email_verification_token_hash)
  WHERE email_verification_token_hash IS NOT NULL;

-- Antrean akun yang belum terverifikasi (untuk pemantauan Admin).
CREATE INDEX IF NOT EXISTS idx_owners_unverified
  ON owners (created_at DESC)
  WHERE email_verified_at IS NULL AND deleted_at IS NULL;
