-- ============================================================================
-- KASIR NOVA - Migrasi 0016: Pendaftaran Owner + Approval Center
-- ============================================================================
-- Alur final (29 Okt 2026):
--   Owner mendaftar mandiri TANPA pembayaran -> meminta persetujuan Admin lewat
--   tombol WhatsApp -> Admin menyetujui/menolak dari Approval Center.
--
-- Keputusan model data:
--   * TIDAK ada tagihan/biaya pendaftaran. Pembayaran hanya untuk perpanjangan
--     langganan setelah masa trial.
--   * Satu baris pendaftaran per Owner (UNIQUE owner_id) sehingga permintaan
--     approval berulang tidak membuat data duplikat.
--   * `registration_number` adalah nomor tetap yang dipakai pada pesan WhatsApp
--     dan Approval Center.
--   * Saat Admin menyetujui, bisnis + langganan paket pilihan + masa gratis
--     30 hari dibuat dalam SATU transaksi. Waktu trial memakai jam server
--     (now()) pada saat persetujuan, bukan waktu pendaftaran.
--
-- Kompatibilitas:
--   * Owner/Kasir lama tidak diubah. `owners.email_verified_at` tetap dipakai
--     sebagai penanda aktivasi akun lama; pendaftaran baru baru terisi saat
--     Admin menyetujui.
--   * Kolom verifikasi email lama dibiarkan (tidak dipakai kode baru) agar data
--     historis tidak hilang.

CREATE TABLE IF NOT EXISTS owner_registrations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id            UUID NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  registration_number TEXT NOT NULL UNIQUE,
  business_name       TEXT NOT NULL,
  plan_id             UUID NOT NULL REFERENCES subscription_plans(id),
  -- draft    : sudah mendaftar, tombol "Minta Approve Admin" belum ditekan
  -- pending  : permintaan approval sudah dikirim ke Admin
  -- approved : disetujui; bisnis + trial 30 hari sudah dibuat
  -- rejected : ditolak Admin (alasan wajib)
  status              TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'pending', 'approved', 'rejected')),
  requested_at        TIMESTAMPTZ,
  request_count       INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  whatsapp_requested_at TIMESTAMPTZ,
  approved_at         TIMESTAMPTZ,
  approved_by         UUID REFERENCES platform_admins(id) ON DELETE SET NULL,
  rejected_at         TIMESTAMPTZ,
  rejected_by         UUID REFERENCES platform_admins(id) ON DELETE SET NULL,
  rejection_reason    TEXT,
  business_id         UUID REFERENCES businesses(id) ON DELETE SET NULL,
  trial_started_at    TIMESTAMPTZ,
  trial_ends_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT owner_registrations_owner_unique UNIQUE (owner_id)
);

CREATE INDEX IF NOT EXISTS idx_owner_registrations_status
  ON owner_registrations (status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_owner_registrations_history
  ON owner_registrations (approved_at DESC, rejected_at DESC);

CREATE INDEX IF NOT EXISTS idx_owner_registrations_plan
  ON owner_registrations (plan_id);

DROP TRIGGER IF EXISTS trg_owner_registrations_updated ON owner_registrations;
CREATE TRIGGER trg_owner_registrations_updated
  BEFORE UPDATE ON owner_registrations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
