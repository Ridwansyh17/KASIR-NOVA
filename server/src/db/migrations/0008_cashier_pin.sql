-- ============================================================================
-- KASIR NOVA - Migrasi 0008: PIN Login Kasir (Fase 10b)
-- ============================================================================
-- Menambahkan siklus hidup PIN kasir + status terkunci (lockout) di server.
--
-- Keputusan bisnis pemilik (Fase 10b):
--   - PIN 4 digit, OPSIONAL (password tetap ada).
--   - PIN boleh sama antar kasir (alur pilih-nama -> verifikasi PIN).
--   - Lockout: 5x salah -> kunci sementara 15 menit (pin_locked_until);
--     10x salah -> status 'locked' permanen hingga Owner membuka
--     (pakai nilai enum account_status baru: 'locked').
--   - Menyetel PIN baru selalu memanggil pin_set_at dan mereset lockout.
--
-- Kolom pin_hash SUDAH ada sejak migrasi 0005 (sengaja dikosongkan).

-- Status akun bertambah 'locked' (kelola di server; Owner membuka lewat
-- endpoint unlock).
ALTER TYPE account_status ADD VALUE IF NOT EXISTS 'locked';

-- Kolom siklus PIN per kasir.
ALTER TABLE cashiers
  ADD COLUMN IF NOT EXISTS pin_set_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pin_failed_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_locked_until   TIMESTAMPTZ;

-- Kartu kasir yang punya PIN (untuk layar pemilih login PIN).
CREATE INDEX IF NOT EXISTS idx_cashiers_pin_lookup
  ON cashiers (outlet_id) WHERE pin_hash IS NOT NULL;