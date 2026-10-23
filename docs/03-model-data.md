# KASIR NOVA — Model Data Awal

> Target: PostgreSQL. Semua tabel bisnis membawa `business_id` untuk isolasi
> tenant. Tipe utama: `UUID` (PK), `BIGINT` untuk uang (disimpan dalam
> **sen**, bukan desimal, agar presisi), `TIMESTAMPTZ`.

## Ringkasan Entitas & Relasi

```
platform_admins                owners
       │                          │
       └─(buat)                   └─(punya) businesses ──> subscriptions
                                                          (1 aktif/business)
                                      │
                                      ├──> outlets ──> cashiers (1 kasir = 1 outlet)
                                      │        │
                                      │        └──> stock (per product per outlet)
                                      ├──> categories ──> products
                                      │                       │
                                      │                       └──> inventory_movements
                                      ├──> transactions ──> transaction_items
                                      │         │
                                      │         └──> payments
                                      └──> expenses  (pengeluaran outlet)
audit_logs  (mencatat semua aktor)
refresh_tokens (sesi, per peran)
```

## Tabel Inti

### `platform_admins`
| Kolom | Tipe | Catatan |
|---|---|---|
| id | UUID PK | |
| email | TEXT UNIQUE | login |
| password_hash | TEXT | scrypt |
| full_name | TEXT | |
| status | TEXT | `active`/`suspended` |
| created_at | TIMESTAMPTZ | |

> Dibuat **hanya** lewat seeding internal yang terkontrol. Tidak ada
> pendaftaran publik.

### `owners`
| id | UUID PK | |
| email | TEXT UNIQUE | |
| password_hash | TEXT | scrypt |
| full_name, phone | TEXT | |
| status | TEXT | `active`/`suspended` |
| email_verified_at | TIMESTAMPTZ | NULL = menunggu verifikasi email; default `now()` untuk owner lama/buatan Admin (tanpa alur verifikasi) |
| email_verification_token_hash | TEXT | Alur email legacy; SHA-256 token, NULL pada pendaftaran Firebase |
| email_verification_expires_at | TIMESTAMPTZ | Alur email lama; kedaluwarsa tautan (default 24 jam) |
| pending_business_name | TEXT | nama bisnis dari form daftar; dipakai saat email terverifikasi (atau verifikasi manual akun lama) lalu dikosongkan |
| created_by | UUID | FK `platform_admins.id` (audit); NULL untuk pendaftaran mandiri |
| firebase_uid | TEXT | UID Firebase Authentication; unik (partial index), NULL untuk akun lama/buatan Admin |
| email_verification_method | TEXT | `manual` (default, akun lama/Admin) atau `firebase` (pendaftaran mandiri) |
| firebase_verification_sent_at | TIMESTAMPTZ | Waktu email verifikasi Firebase terakhir diminta (dasar cooldown kirim ulang) |
| created_at | TIMESTAMPTZ | |

### `businesses`
| id | UUID PK | |
| owner_id | UUID FK → owners | satu owner, banyak bisnis |
| name, business_type | TEXT | jenis usaha |
| currency | TEXT | default `IDR` |
| timezone | TEXT | default `Asia/Jakarta` |
| status | TEXT | `active`/`suspended` |

### `outlets`
| id | UUID PK | |
| business_id | UUID FK → businesses | **indeks**, ON DELETE CASCADE |
| name, address, phone | TEXT | |
| tax_rate | NUMERIC(5,2) | default 0, dapat dikonfigurasi |
| tax_inclusive | BOOLEAN | default FALSE; TRUE = harga sudah termasuk pajak (Fase 7) |
| status | TEXT | `account_status` (`active`/`suspended`), default `active` |
| deleted_at | TIMESTAMPTZ | soft delete (Fase 4) |

> Batas jumlah outlet diatur oleh `subscription_plans.max_outlets`, dicek
> di **server** saat membuat outlet baru (gerbang `enforceOutletQuota`,
> Fase 4).

### `cashiers`
| id | UUID PK | |
| outlet_id | UUID FK → outlets | **NOT NULL**, ON DELETE CASCADE |
| email | TEXT UNIQUE (`lower(email)`) | **mencegah 1 akun di banyak outlet** |
| password_hash | TEXT | scrypt (format `scrypt:N:r:p:salt:hash`) |
| pin_hash | TEXT | opsional, scrypt (`pin:N:r:p:salt:hash`), 4–6 digit |
| full_name | TEXT | |
| status | TEXT | `account_status` (`active`/`suspended`/`locked`), default `active` |
| pin_set_at, pin_failed_attempts, pin_locked_until | TIMESTAMPTZ / INT | Fase 10b (PIN) |
| can_view_profit | BOOLEAN | default FALSE; **opt-in Owner** untuk melihat HPP/laba (V0.3) |
| created_by | UUID | FK `owners.id`, ON DELETE SET NULL |

> Penegakan "1 Kasir = 1 outlet": email UNIQUE case-insensitive + `outlet_id`
> NOT NULL (satu baris hanya punya satu outlet). Batas jumlah kasir diatur
> `subscription_plans.max_cashiers`, dicek server saat membuat kasir
> (`enforceCashierQuota`, Fase 5) — selaras dengan batas outlet.
> Endpoint pembuatan kasir juga memverifikasi outlet milik `business_id`
> sesi Owner. Suspend/reset password mencabut semua sesi kasir.

### `product_categories` / `products` / `product_stocks`

| `product_categories` | id | UUID PK |
| | business_id | UUID FK → businesses, ON DELETE CASCADE |
| | name | TEXT (UNIQUE per bisnis, `lower(name)`) |
| | created_at, updated_at | TIMESTAMPTZ |

| `products` | id | UUID PK |
| | business_id | UUID FK → businesses, ON DELETE CASCADE |
| | category_id | UUID FK → product_categories, ON DELETE SET NULL (nullable) |
| | name | TEXT (UNIQUE per bisnis untuk produk aktif, `lower(name)`) |
| | sku, barcode | TEXT (UNIQUE per bisnis bila diisi) |
| | price | BIGINT (SEN, non-negatif) |
| | cost_price | BIGINT (SEN, default 0, CHECK ≥ 0) — HPP/modal (V0.3) |
| | unit | TEXT (nullable, mis. `pcs`/`kg`/`botol`) (V0.3) |
| | photo_url | TEXT (URL http(s) atau data URL gambar) (V0.3) |
| | track_stock | BOOLEAN (default TRUE; jasa dapat `false`) |
| | status | `account_status` (`active`/`suspended`) |
| | manual_out_of_stock | BOOLEAN (default FALSE, V0.3) — HABIS manual |
| | stock_note, stock_status_changed_at/_by_role/_by_id | TEXT / TIMESTAMPTZ / user_role / UUID (V0.3) |
| | created_by_role/_id, updated_by_role/_id | `user_role` + UUID — jejak pengubah (V0.3) |
| | deleted_at | TIMESTAMPTZ (soft delete) |
| | created_at, updated_at | TIMESTAMPTZ |

| `product_stocks` | id | UUID PK |
| | product_id | UUID FK → products, ON DELETE CASCADE |
| | outlet_id | UUID FK → outlets, ON DELETE CASCADE |
| | quantity | INT (default 0, CHECK ≥ 0) |
| | created_at, updated_at | TIMESTAMPTZ |

> **UNIQUE (product_id, outlet_id)** pada `product_stocks` menjaga satu saldo per
> pasangan produk×outlet — `CHECK (quantity >= 0)` mencegah stok negatif sejak
> level skema. Produk yang dibuat dengan `track_stock=true` otomatis mendapat
> baris stok 0 di **setiap** outlet aktif bisnis. Harga dalam **sen** (BIGINT),
> konsisten dengan `subscription_plans.price`. Kategori & produk dihapus
> dengan soft delete untuk produk; penghapusan kategori diblokir (409) bila
> masih dipakai produk aktif. (Fase 6.)
>
> **V0.3 (migrasi `0009`):** `cost_price` (HPP) **hanya** dikembalikan/diubah
> bila pemanggil berizin (Owner selalu; Kasir bila `cashiers.can_view_profit`);
> `unit`/`photo_url` untuk tampilan katalog. **Ketersediaan (HABIS) bersifat
> turunan:** `manual_out_of_stock = true` **ATAU** (`track_stock = true` DAN
> `Σ total_stock ≤ 0`). Menandai HABIS tidak mengubah saldo stok.

### `inventory_movements` (append-only, migrasi `0009`)
| id | UUID PK | |
| business_id, outlet_id | UUID FK → businesses/outlets, ON DELETE CASCADE | tenant + indeks |
| product_id | UUID FK → products, ON DELETE SET NULL (nullable) | snapshot nama dipertahankan |
| product_name | TEXT | snapshot nama produk |
| type | `inventory_movement_type` | `initial`/`adjustment`/`sale`/`void`/`refund`/`mark_out`/`restore` |
| qty_delta, qty_before, qty_after | INT (CHECK ≥ 0 untuk before/after) | perubahan & saldo |
| reason, ref_type, ref_id | TEXT / UUID | catatan & rujukan (mis. transaksi) |
| actor_role, actor_id | `user_role` + UUID | pelaku |
| created_at | TIMESTAMPTZ | |

> Histori stok **tidak pernah diubah/dihapus**. Setiap perubahan saldo
> (stok awal, opname, penjualan, void, tandai HABIS/aktifkan) menulis satu
> baris di sini, di **transaksi DB yang sama** dengan mutasi `product_stocks`.
> Indeks `(business_id, created_at DESC)` & `(outlet_id, created_at DESC)`.

### `expenses` (pengeluaran outlet, migrasi `0009`)
| id | UUID PK | |
| business_id, outlet_id | UUID FK, ON DELETE CASCADE | tenant |
| category | `expense_category` | `operational`/`utilities`/`supplies`/`transport`/`maintenance`/`inventory_purchase`/`other` |
| amount | BIGINT (SEN, CHECK > 0) | |
| method | `expense_method` | `cash`/`transfer`/`qr` |
| note, receipt_url | TEXT | catatan & bukti (URL/data URL) |
| status | `expense_status` | `recorded`/`voided` |
| spent_on | DATE | tanggal pengeluaran (zona waktu bisnis) |
| cashier_id | UUID FK → cashiers, SET NULL | bila dicatat kasir |
| created_by_role/_id | `user_role` + UUID | pelaku (NOT NULL) |
| voided_at, voided_by_role/_id, void_reason | TIMESTAMPTZ / user_role / UUID / TEXT | koreksi tanpa hapus |
| created_at, updated_at | TIMESTAMPTZ | trigger `set_updated_at` |

> **Tanpa hard delete.** Koreksi dilakukan dengan mengubah `status` menjadi
> `voided` + alasan. Kategori `inventory_purchase` **dikecualikan** dari laba
> bersih agar pembelian persediaan tidak dihitung ganda (nilainya sudah masuk
> HPP saat barang terjual).

### `transactions`
| id | UUID PK | |
| business_id, outlet_id, cashier_id | UUID FK | konteks tenant + petugas (kasir/outlet CASCADE; cashier SET NULL) |
| invoice_no | TEXT | UNIQUE per outlet, mis. `INV-20261010-0001` |
| status | `transaction_status` ENUM | `completed`/`voided`/`refunded` |
| subtotal, discount_total, tax_total, total | BIGINT (sen, CHECK ≥ 0) | |
| discount_type, discount_value | TEXT + BIGINT | `percent` (basis point 1%=100) / `amount` (sen) |
| tax_rate, tax_inclusive | NUMERIC(5,2) + BOOLEAN | snapshot pajak outlet saat transaksi |
| paid_amount, change_amount | BIGINT (sen) | |
| note | TEXT | |
| client_ref | UUID | UNIQUE parsial per outlet → anti-duplikasi request |
| voided_at, voided_by | TIMESTAMPTZ + UUID FK → owners (SET NULL) | diisi saat void |
| created_at, updated_at | TIMESTAMPTZ | **indeks** `(business_id, created_at DESC)` untuk laporan |

> Dihasilkan oleh migrasi `0007`. **Satu transaksi DB** mencatat kepala +
> item + pembayaran + pengurangan stok (`UPDATE product_stocks ... WHERE
> quantity >= qty`) sehingga penjualan konkuren tidak pernah membuat stok
> negatif. Void (Owner) mengembalikan stok. Penomoran invoice atomik lewat
> `outlet_invoice_counters` per (outlet, hari) dengan zona waktu bisnis.

### `transaction_items`
| id | UUID PK | |
| transaction_id | UUID FK → transactions, CASCADE | |
| product_id | UUID FK → products, SET NULL | snapshot dipertahankan walau produk dihapus |
| product_name | TEXT | snapshot nama produk |
| sku, unit_price | TEXT + BIGINT (sen) | snapshot |
| qty | INT (CHECK > 0) | |
| discount_amount, tax_amount | BIGINT (sen) | alokasi proporsional (jumlah = nilai transaksi) |
| line_total | BIGINT (sen) | harga×qty − diskon + pajak (atau tanpa pajak bila inklusif) |
| cost_price | BIGINT (sen, default 0) | **snapshot HPP** saat transaksi (V0.3) — laba historis tidak berubah walau HPP produk diubah |
| created_at | TIMESTAMPTZ | |

### `payments`
| id | UUID PK | |
| transaction_id | UUID FK → transactions, CASCADE | |
| method | TEXT | `cash`/`card`/`qr`/`wallet` (CHECK) |
| amount | BIGINT (sen) | |
| fee_amount | BIGINT (sen, default 0) | biaya transaksi/biaya payment gateway (V0.3) |
| reference, provider | TEXT | referensi manual; `provider` siap gateway digital (modul ditangguhkan) |
| status | TEXT | `paid`/`pending`/`failed`/`refunded` |

> Satu transaksi = satu baris pembayaran pada Fase 7 (keputusan #2); tabel
> mendukung beberapa baris untuk split pembayaran di fase lanjut.

### `subscriptions`
| id, business_id, plan_id FK, status (`active`/`past_due`/`expired`), started_at, expires_at, auto_renew BOOL |
| business_id FK → businesses | ON DELETE CASCADE |

> Diimplementasikan dengan **index unik parsial**
> `ON subscriptions(business_id) WHERE status='active'` ⇒ hanya 1 langganan
> aktif per bisnis; riwayat non-aktif tetap tersimpan. Status satu bisnis
> tidak otomatis mengaktifkan bisnis lain.

### `subscription_plans`
| id, name (UNIQUE), max_outlets, max_cashiers, price BIGINT (sen), duration_days, features JSONB, is_active BOOL, is_default BOOL |

> Index unik parsial `ON subscription_plans(is_default) WHERE is_default` ⇒
> paling banyak **satu** paket default. Plan default (awal: "Gratis") disemai
> sebagai data referensi operasional di migrasi `0004`; bisnis baru otomatis
> diberi langganan plan default (keputusan Opsi A).

### `subscription_invoices` (migrasi `0010`, 17 Okt 2026)
| Kolom | Tipe | Keterangan |
|---|---|---|
| id | UUID PK | |
| business_id | UUID FK → businesses, CASCADE | tenant pemilik tagihan |
| plan_id | UUID FK → subscription_plans, RESTRICT | paket yang dibeli |
| subscription_id | UUID FK → subscriptions, SET NULL | langganan hasil pembayaran |
| order_id | TEXT UNIQUE | nomor pesanan kita (≤50 char) |
| amount | BIGINT (sen) | **snapshot** harga paket saat tagihan dibuat |
| status | ENUM `subscription_invoice_status` | `pending`/`paid`/`failed`/`expired`/`canceled` |
| provider | TEXT | penyedia gateway (`duitku`) |
| payment_method | TEXT | kode kanal (`BC`, `I1`, `NQ`, …) |
| provider_reference, va_number, qr_string, payment_url | TEXT | data dari gateway |
| expires_at, paid_at, failed_at | TIMESTAMPTZ | |
| attempts | INT | jumlah panggilan/pemeriksaan gateway |
| inquiry_payload, callback_payload | JSONB | bukti (**tanpa** `signature`) |
| created_by | UUID FK → owners, SET NULL | Owner yang memulai tagihan |

> **Index unik parsial** `ON subscription_invoices(business_id) WHERE
> status='pending'` ⇒ satu tagihan pending per bisnis. Tabel ini **terpisah**
> dari `payments` (yang terikat penjualan: `payments.transaction_id` NOT NULL).
> Dipakai untuk pembayaran **langganan** saja — lihat
> `docs/38-pembayaran-langganan-gateway.md`.

### `refresh_tokens`
| id, user_type (`platform_admin`/`owner`/`cashier`), user_id, token_hash TEXT, expires_at, revoked_at NULL, created_at, ip, user_agent |

> Hanya **hash** yang disimpan. Pencabutan = isi `revoked_at`.

### `audit_logs`
| id, actor_type, actor_id, business_id NULL, action, entity_type, entity_id, before JSONB, after JSONB, ip, created_at |

> Mencatat operasi penting (buat/ubah/hapus, void transaksi, ubah langganan).

## Catatan Desain

- **Uang dalam sen (BIGINT)**: hindari error floating point pada POS.
- **Indeks**: `business_id` di semua tabel tenant; `created_at` di transaksi
  untuk laporan harian/mingguan/bulanan/tahunan.
- **RLS**: policy `USING (business_id = current_setting('app.tenant_id'))`
  sebagai pertahanan kedua jika aplikasi lupa filter.
- **Migrasi**, bukan DDL manual: setiap perubahan via file di
  `server/src/db/migrations/`.
