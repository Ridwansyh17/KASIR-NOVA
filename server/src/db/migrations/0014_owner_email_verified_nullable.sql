-- ============================================================================
-- KASIR NOVA - Migrasi 0014: email_verified_at boleh NULL
-- ============================================================================
-- 0013 sempat membuat kolom NOT NULL DEFAULT now(). Pendaftaran mandiri perlu
-- menyimpan NULL untuk akun yang belum memverifikasi email. Migrasi ini
-- memperbaiki database yang sudah menjalankan 0013 versi tersebut; instalasi
-- baru tetap aman karena 0013 kini sudah NULL-able.

ALTER TABLE owners
  ALTER COLUMN email_verified_at DROP NOT NULL;
