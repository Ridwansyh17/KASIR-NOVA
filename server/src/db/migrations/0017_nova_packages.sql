-- ============================================================================
-- KASIR NOVA - Migrasi 0017: Paket NOVA + harga bulanan/tahunan
-- ============================================================================
-- Menambahkan atribut paket yang dibutuhkan landing page, pendaftaran Owner,
-- approval Admin, dan perpanjangan langganan:
--   * slug stabil untuk tautan "PILIH PAKET" dari landing.
--   * harga bulanan & tahunan dalam SEN (harga tahunan = 2 bulan gratis).
--   * penanda paket Enterprise (harga sesuai konsultasi, tidak self-service).
--   * periode & harga yang disepakati disimpan pada pendaftaran/langganan agar
--     perubahan harga paket oleh Admin tidak otomatis mengubah kesepakatan.
--
-- Kompatibilitas:
--   * Kolom lama `price` tetap dipertahankan sebagai harga bulanan (legacy).
--   * Paket lama tanpa slug/harga bulanan diisi otomatis oleh trigger.
--   * Paket "Gratis" tetap menjadi default bisnis baru, tetapi tidak lagi
--     ditampilkan sebagai pilihan pendaftaran mandiri (is_public = false).

ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS price_monthly BIGINT,
  ADD COLUMN IF NOT EXISTS price_yearly BIGINT,
  ADD COLUMN IF NOT EXISTS is_custom_price BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT true;

UPDATE subscription_plans
   SET price_monthly = COALESCE(price_monthly, price),
       slug = COALESCE(
         NULLIF(btrim(slug), ''),
         trim(both '-' from lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g')))
       )
 WHERE price_monthly IS NULL OR slug IS NULL OR btrim(slug) = '';

-- Paket tahunan lama: setara 10 bulan (2 bulan gratis) bila belum ditentukan.
UPDATE subscription_plans
   SET price_yearly = price_monthly * 10
 WHERE price_yearly IS NULL AND price_monthly > 0;

CREATE OR REPLACE FUNCTION nova_sync_plan_columns() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.price_monthly IS NULL THEN
    NEW.price_monthly := NEW.price;
  END IF;
  IF NEW.price IS NULL THEN
    NEW.price := NEW.price_monthly;
  END IF;
  IF NEW.slug IS NULL OR btrim(NEW.slug) = '' THEN
    NEW.slug := trim(both '-' from lower(regexp_replace(NEW.name, '[^a-zA-Z0-9]+', '-', 'g')));
  ELSE
    NEW.slug := trim(both '-' from lower(btrim(NEW.slug)));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_subscription_plans_sync ON subscription_plans;
CREATE TRIGGER trg_subscription_plans_sync
  BEFORE INSERT OR UPDATE ON subscription_plans
  FOR EACH ROW EXECUTE FUNCTION nova_sync_plan_columns();

DO $$ BEGIN
  ALTER TABLE subscription_plans ALTER COLUMN price_monthly SET NOT NULL;
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE subscription_plans ALTER COLUMN slug SET NOT NULL;
EXCEPTION WHEN others THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_subscription_plans_slug
  ON subscription_plans (slug);

DO $$ BEGIN
  ALTER TABLE subscription_plans
    ADD CONSTRAINT subscription_plans_price_monthly_nonneg CHECK (price_monthly >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE subscription_plans
    ADD CONSTRAINT subscription_plans_price_yearly_nonneg CHECK (price_yearly IS NULL OR price_yearly >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Paket NOVA final (harga dalam SEN).
INSERT INTO subscription_plans
  (name, slug, max_outlets, max_cashiers, price, price_monthly, price_yearly,
   duration_days, features, is_active, is_default, is_custom_price, is_public)
VALUES
  (
    'NOVA STARTER', 'nova-starter', 1, 2, 4900000, 4900000, 49000000, 30,
    '{"highlights":[
      "1 bisnis, 1 outlet",
      "1 akun Owner",
      "Maksimal 2 akun Kasir",
      "Transaksi dan produk",
      "Manajemen stok",
      "Laporan penjualan harian",
      "Cetak struk"
    ]}'::jsonb,
    true, false, false, true
  ),
  (
    'NOVA BUSINESS', 'nova-business', 2, 5, 9900000, 9900000, 99000000, 30,
    '{"highlights":[
      "Semua fitur Starter",
      "1 bisnis, maksimal 2 outlet",
      "Maksimal 5 akun Kasir",
      "Pengeluaran operasional",
      "Rekap metode pembayaran",
      "Riwayat pergerakan stok",
      "Ekspor laporan Excel",
      "Pengaturan pajak dan diskon"
    ]}'::jsonb,
    true, false, false, true
  ),
  (
    'NOVA PRO', 'nova-pro', 5, 15, 14900000, 14900000, 149000000, 30,
    '{"highlights":[
      "Semua fitur Business",
      "1 bisnis, maksimal 5 outlet",
      "Maksimal 15 akun Kasir",
      "Monitoring beberapa outlet",
      "Laporan pendapatan dan pengeluaran",
      "Rekap terpusat lintas outlet",
      "Dukungan prioritas"
    ]}'::jsonb,
    true, false, false, true
  ),
  (
    'NOVA ENTERPRISE', 'nova-enterprise', 999, 999, 0, 0, NULL, 30,
    '{"highlights":[
      "Jumlah outlet dan akun Kasir sesuai kesepakatan",
      "Harga sesuai konsultasi",
      "Dukungan implementasi dan pendampingan"
    ],"custom":true}'::jsonb,
    true, false, true, true
  )
ON CONFLICT (name) DO UPDATE SET
  slug = EXCLUDED.slug,
  max_outlets = EXCLUDED.max_outlets,
  max_cashiers = EXCLUDED.max_cashiers,
  price = EXCLUDED.price,
  price_monthly = EXCLUDED.price_monthly,
  price_yearly = EXCLUDED.price_yearly,
  duration_days = EXCLUDED.duration_days,
  features = EXCLUDED.features,
  is_active = EXCLUDED.is_active,
  is_custom_price = EXCLUDED.is_custom_price,
  is_public = EXCLUDED.is_public;

-- Paket default lama tetap untuk bisnis baru, tetapi tidak ditawarkan saat
-- pendaftaran mandiri (karena pendaftaran memakai paket NOVA).
UPDATE subscription_plans
   SET is_public = false
 WHERE is_default = true;

-- ============================================================================
-- Periode & harga kesepakatan pada langganan
-- ============================================================================
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS billing_period TEXT NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS price_amount BIGINT NOT NULL DEFAULT 0;

UPDATE subscriptions s
   SET price_amount = COALESCE(p.price_monthly, p.price)
  FROM subscription_plans p
 WHERE p.id = s.plan_id AND s.price_amount = 0;

DO $$ BEGIN
  ALTER TABLE subscriptions
    ADD CONSTRAINT subscriptions_billing_period_check
    CHECK (billing_period IN ('monthly', 'yearly'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE subscriptions
    ADD CONSTRAINT subscriptions_price_amount_nonneg CHECK (price_amount >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- Periode & harga pada pendaftaran Owner
-- ============================================================================
ALTER TABLE owner_registrations
  ADD COLUMN IF NOT EXISTS billing_period TEXT NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS agreed_price BIGINT NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE owner_registrations
    ADD CONSTRAINT owner_registrations_billing_period_check
    CHECK (billing_period IN ('monthly', 'yearly'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE owner_registrations
    ADD CONSTRAINT owner_registrations_agreed_price_nonneg CHECK (agreed_price >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- Periode pada tagihan langganan
-- ============================================================================
ALTER TABLE subscription_invoices
  ADD COLUMN IF NOT EXISTS billing_period TEXT NOT NULL DEFAULT 'monthly';

DO $$ BEGIN
  ALTER TABLE subscription_invoices
    ADD CONSTRAINT subscription_invoices_billing_period_check
    CHECK (billing_period IN ('monthly', 'yearly'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
