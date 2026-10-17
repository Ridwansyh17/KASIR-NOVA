-- ============================================================================
-- 0010 — Tagihan langganan & payment gateway (uji sandbox Duitku)
--
-- Latar: sampai 0009, perpanjangan langganan hanya manual oleh Admin Platform
-- (`assignSubscription` / `setSubscriptionStatus`). Atas permintaan pemilik
-- (17 Okt 2026) ditambahkan alur **Owner self-service**: Owner membuat tagihan
-- paket -> server meminta nomor VA/QRIS ke gateway -> pembayaran dikonfirmasi
-- lewat **callback bertanda tangan** -> server mengaktifkan/memperpanjang
-- langganan. Fase ini memakai lingkungan **sandbox** (uang tidak nyata).
--
-- Keputusan model data:
--   - Semua nominal tetap **SEN** (`amount BIGINT`). Konversi ke rupiah bulat
--     (yang diminta gateway) hanya terjadi di lapisan klien gateway, sehingga
--     aturan "semua nominal sen" tidak berubah.
--   - Tabel `payments` **tidak** dipakai ulang: `payments.transaction_id`
--     NOT NULL terikat pada penjualan (`transactions`). Tagihan langganan
--     dipisah agar laporan penjualan/laba tidak pernah tercemar pembayaran
--     langganan.
--   - Jejak gateway (nomor VA, QR string, respons inquiry, payload callback)
--     disimpan pada baris tagihan untuk audit. **Tanda tangan TIDAK disimpan**
--     dan kredensial gateway tidak pernah masuk basis data.
--   - Satu tagihan `pending` per bisnis (index unik parsial) supaya Owner tidak
--     punya dua nomor VA aktif sekaligus.
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE subscription_invoice_status AS ENUM ('pending', 'paid', 'failed', 'expired', 'canceled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS subscription_invoices (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  plan_id            UUID NOT NULL REFERENCES subscription_plans(id),
  -- Langganan yang diaktifkan tagihan ini (diisi saat pembayaran sukses).
  subscription_id    UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  -- Nomor pesanan kita yang dikirim ke gateway (`merchantOrderId`, <= 50 char).
  order_id           TEXT NOT NULL UNIQUE,
  amount             BIGINT NOT NULL CHECK (amount >= 0), -- SEN
  status             subscription_invoice_status NOT NULL DEFAULT 'pending',
  provider           TEXT NOT NULL,                       -- 'duitku'
  payment_method     TEXT NOT NULL,                       -- kode kanal: BC, I1, M2, BR, NQ, SP, …
  provider_reference TEXT,                                -- `reference` dari gateway
  va_number          TEXT,                                -- kanal Virtual Account
  qr_string          TEXT,                                -- kanal QRIS (EMVCo payload)
  payment_url        TEXT,                                -- halaman pembayaran gateway
  expires_at         TIMESTAMPTZ,
  paid_at            TIMESTAMPTZ,
  failed_at          TIMESTAMPTZ,
  -- Jumlah percobaan permintaan ke gateway untuk tagihan ini (audit/diagnosa).
  attempts           INTEGER NOT NULL DEFAULT 1 CHECK (attempts > 0),
  inquiry_payload    JSONB,                               -- respons gateway (tanpa rahasia)
  callback_payload   JSONB,                               -- callback terakhir (TANPA signature)
  created_by         UUID REFERENCES owners(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sub_invoices_business
  ON subscription_invoices (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sub_invoices_pending
  ON subscription_invoices (status, expires_at) WHERE status = 'pending';
-- Satu tagihan pending per bisnis (encegah dua nomor VA aktif sekaligus).
CREATE UNIQUE INDEX IF NOT EXISTS uq_sub_invoices_pending_per_business
  ON subscription_invoices (business_id) WHERE status = 'pending';

DROP TRIGGER IF EXISTS trg_subscription_invoices_updated ON subscription_invoices;
CREATE TRIGGER trg_subscription_invoices_updated
  BEFORE UPDATE ON subscription_invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
