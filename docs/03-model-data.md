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
                                      │
                                      └──> transactions ──> transaction_items
                                                │
                                                └──> payments
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
| created_by | UUID | FK `platform_admins.id` (audit) |
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
| status | TEXT | `account_status` (`active`/`suspended`), default `active` |
| deleted_at | TIMESTAMPTZ | soft delete (Fase 4) |

> Batas jumlah outlet diatur oleh `subscription_plans.max_outlets`, dicek
> di **server** saat membuat outlet baru (gerbang `enforceOutletQuota`,
> Fase 4).

### `cashiers`
| id | UUID PK | |
| outlet_id | UUID FK → outlets | **NOT NULL** |
| email | TEXT UNIQUE | **mencegah 1 akun di banyak outlet** |
| password_hash, pin_hash | TEXT | |
| full_name | TEXT | |
| status | TEXT | `active`/`suspended` |
| created_by | UUID | FK `owners.id` |

> Penegakan "1 Kasir = 1 outlet": email UNIQUE + satu baris hanya punya satu
> `outlet_id`. Endpoint pembuatan kasir juga memverifikasi outlet milik
> `business_id` sesi Owner.

### `categories` / `products` / `stock`
| products | id, business_id FK, category_id FK, name, sku, barcode, price BIGINT (sen), cost BIGINT, tax_rate, is_active |
| stock | product_id, outlet_id, qty BIGINT — **komposit PK (product_id, outlet_id)** |

> Stok **per outlet**, disimpan persisten, diupdate dalam DB transaction.

### `transactions`
| id | UUID PK | |
| business_id, outlet_id, cashier_id | UUID FK | konteks tenant + petugas |
| invoice_no | TEXT | UNIQUE per outlet, mis. `INV-20261010-0001` |
| subtotal, discount_total, tax_total, total | BIGINT (sen) | |
| paid_amount, change_amount | BIGINT (sen) | |
| status | TEXT | `completed`/`voided`/`refunded` |
| created_at | TIMESTAMPTZ | **indeks** untuk laporan |

### `transaction_items`
| id, transaction_id FK, product_id FK, qty BIGINT, unit_price BIGINT (sen), tax_amount, discount_amount, line_total |

### `payments`
| id, transaction_id FK, method (`cash`/`card`/`qr`/`wallet`), amount, reference, provider, status |

> Field `provider` siap untuk gateway digital (modul ditangguhkan).

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
