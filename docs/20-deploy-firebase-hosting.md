# KASIR NOVA — Deploy Firebase Hosting (3 site: admin, owner, kasir)

> **Status:** persiapan (scaffold). **Belum ada deploy** — deploy butuh
> persetujuan pemilik (lihat `docs/06-keamanan-dan-infrastruktur.md` §D).
>
> Keputusan pemilik (11 Okt 2026): distribusi **web via Firebase Hosting**,
> **bukan APK/Capacitor**. Satu project Firebase, **tiga site** terpisah.

## 1. Ringkasan arsitektur

```
Firebase Hosting (statis)             Backend (host terpisah, menyusul)
┌──────────────────────────┐          ┌───────────────────────────────┐
│ site "admin" → apps/admin│  fetch   │ Node.js (Express) + PostgreSQL│
│ site "owner" → apps/owner│ ───────► │ /api/**  (HTTPS + CORS)       │
│ site "kasir" → apps/kasir│          └───────────────────────────────┘
└──────────────────────────┘
```

- Firebase Hosting **hanya** menyajikan berkas statis; API & DB **tidak** di sini.
- Frontend menghubungi API melalui **`NOVA_API_BASE`** (`apps/<app>/config.js`).
  - **Dev**: kosong (`''`) → origin sama; Express menyajikan app + `/api`.
  - **Produksi**: URL backend HTTPS, mis. `https://api.nova.example`.
- Karena beda origin, backend **wajib** mengizinkan origin site Firebase di
  `CORS_ORIGIN` (lihat `server/.env.example`).

## 2. Prasyarat

- Node.js (sudah ada) & Firebase CLI: `npm i -g firebase-tools` (atau `npx firebase-tools`).
- Akun Google + project Firebase (Blaze/Spark). **Pembuatan project menyentuh
  billing → butuh persetujuan.**
- Backend sudah punya URL HTTPS publik (menyusul).

## 3. Berkas yang disiapkan repo

| Berkas | Isi |
|---|---|
| `firebase.json` | 3 target hosting: `admin`, `owner`, `kasir` + header keamanan |
| `.firebaserc.example` | contoh pemetaan project & target (disalin ke `.firebaserc`) |
| `apps/<app>/config.js` | `window.NOVA_API_BASE` (bukan rahasia, ikut ter-deploy) |

`.firebaserc` **tidak** di-commit (di `.gitignore`); salin dari contoh.

## 4. Langkah setup (sekali per project)

```powershell
# 1) Login
npx firebase-tools login

# 2) Buat 3 site hosting (id harus unik global; boleh pakai sufiks)
npx firebase-tools hosting:sites:create nova-admin
npx firebase-tools hosting:sites:create nova-owner
npx firebase-tools hosting:sites:create nova-kasir

# 3) Siapkan .firebaserc lalu isi PROJECT_ID (ganti GANTI_DENGAN_PROJECT_ID)
Copy-Item .firebaserc.example .firebaserc

# 4) Ikat target ke site (nama target: admin/owner/kasir)
npx firebase-tools target:apply hosting admin nova-admin
npx firebase-tools target:apply hosting owner nova-owner
npx firebase-tools target:apply hosting kasir nova-kasir
```

## 5. Arahkan frontend ke API backend

Untuk tiap app, set basis URL backend di `apps/<app>/config.js` **sebelum build/deploy**:

```js
window.NOVA_API_BASE = 'https://api.nova.example'; // URL HTTPS backend
```

Lalu di `server/.env` produksi tambahkan origin Firebase ke CORS:

```ini
CORS_ORIGIN=https://nova-admin.web.app,https://nova-owner.web.app,https://nova-kasir.web.app
```

> Catatan: backend juga perlu HTTPS (mixed-content diblokir browser) dan
> `NODE_ENV=production` (agar Express berhenti menyajikan berkas statis).

## 6. Uji lokal sebelum deploy

```powershell
# Menyajikan tiap site lokal (tanpa menyentuh cloud)
npx firebase-tools emulators:start --only hosting
# atau preview cepat satu app:
npx firebase-tools hosting:serve --only hosting:admin
```

Uji alur: login → CRUD → pastikan request menuju `NOVA_API_BASE` yang benar
(tab Network di DevTools) dan tidak ada error CORS.

## 7. Deploy (BUTUH PERSETUJUAN)

```powershell
# semua site
npx firebase-tools deploy --only hosting

# per site
npx firebase-tools deploy --only hosting:admin
npx firebase-tools deploy --only hosting:owner
npx firebase-tools deploy --only hosting:kasir
```

Rollback: Firebase Console → Hosting → *Release history* → **Rollback**, atau
`npx firebase-tools hosting:rollback`.

## 8. Checklist sebelum produksi

- [ ] `NOVA_API_BASE` tiap app = URL backend HTTPS produksi.
- [ ] `CORS_ORIGIN` backend memuat **ketiga** origin site.
- [ ] `NODE_ENV=production` di backend (statis Express mati).
- [ ] HTTPS aktif di backend; tanpa data sensitif di log.
- [ ] Login kasir (PIN), owner, admin berfungsi lintas-origin.
- [ ] Tidak ada rahasia di `apps/**` (hanya `NOVA_API_BASE`, bukan kunci).
- [ ] Uji `firebase emulators:start` bersih sebelum deploy.

## 9. Hal yang belum diputuskan

- **Host backend** (Cloud Run + Cloud SQL vs VPS) — pemilik belum menetapkan;
  desain ini sengaja **fleksibel** (API base URL + CORS), jadi tidak perlu rework.
- Bila kelak backend di **Cloud Run**, bisa ditambahkan rewrite
  `/api/** -> Cloud Run` di `firebase.json` agar same-origin (opsional).
- CSP ketat untuk site statis (belum, karena `connect-src` bergantung URL API).
