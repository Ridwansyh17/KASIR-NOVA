# KASIR NOVA — Workflow Pengembangan via Termux (Android)

> Panduan agar HP (Termux) dan laptop (Windows) bisa dipakai bergantian tanpa
> mengganggu KASIR NOVA yang sedang online. Tidak ada deployment otomatis.

## Prinsip

- Satu repository: `https://github.com/Ridwansyh17/KASIR-NOVA.git`.
- Branch kerja aktif: **`feat/kasir-nova-v2`**. Branch `main` di GitHub
  tertinggal dan hanya dijadikan tujuan merge setelah fitur stabil (via PR).
- `main` adalah nenek moyang `feat`; jangan rebase/force-push.
- **Commit/push hanya setelah disetujui pemilik proyek.**

## Alur harian (HP maupun laptop)

```bash
# 1. Ambil perubahan terbaru (rebase agar riwayat linier)
git pull --rebase origin feat/kasir-nova-v2

# 2. Kerjakan perubahan kecil & terukur
#    ... edit ...

# 3. Uji yang relevan
npm run test:server        # seluruh uji backend
npm run db:verify          # koneksi + status migrasi (read-only)
node --test server/tests/<file>.test.js   # uji per modul

# 4. Periksa diff sebelum menyerahkan untuk ditinjau
git status
git diff
```

Setelah pemilik menyetujui:

```bash
git add <file yang dimaksud>
git commit -m "feat(...): ..."
git push origin feat/kasir-nova-v2
```

## Berpindah perangkat

- Selalu `git pull --rebase` saat mulai bekerja di perangkat lain.
- Jangan menyimpan pekerjaan setengah jadi di working tree saat berpindah:
  commit ke branch `feat` (setelah disetujui) atau `git stash` untuk lokal.
- Konfigurasi rahasia (`server/.env`) **tidak** ikut Git — salin manual
  (`server/.env.example`) di tiap perangkat.

## Perbedaan Termux vs Windows

| Perkakas | Windows | Termux/Linux |
|---|---|---|
| QA menyeluruh | `npm run qa:local` (PowerShell) | `npm run qa:portable` |
| Backup DB | `npm run db:backup` (PowerShell) | `npm run db:backup:portable` |
| Verifikasi DB | `npm run verify-db` (ps1) | `npm run db:verify` (Node) |
| Kelola PostgreSQL lokal | `pg-server.cmd start/stop` | `npm run db:start` / `db:stop` / `db:restart` / `db:status` |
| E2E | `npm run e2e:local` (ps1) | `npm run e2e:online` (Node) atau `node scripts/qa-local.mjs --with-e2e` |

> Skrip `*.ps1` tidak dijalankan di Android. Gunakan padanan Node di atas.

## PostgreSQL di Termux (WAJIB)

**Jangan pernah** menjalankan `initdb`, `postgres --check`, atau `pg_ctl` dari
paket Ubuntu (`/usr/lib/postgresql/*/bin`) **di dalam proot-distro**. Proot
menahan `ptrace` sehingga proses berhenti permanen di `ptrace_stop`; tool bash
di opencode lalu menunggu selamanya (kejadian 19 Okt 2026, sesi `swift-wolf`).

Aturan:

- Pakai biner **natif Termux**: `/data/data/com.termux/files/usr/bin/{pg_ctl,initdb,postgres}`.
- Data dir: `/data/data/com.termux/files/usr/var/lib/postgresql` (PG 18).
- Jalankan sebagai **UID Android aplikasi** (`u0_a211`), bukan root palsu proot.
  `scripts/pg-local.mjs` sudah menangani ini via `setpriv` + `/proc/self/status`.
- Kelola siklus hidup hanya lewat npm script:

```bash
npm run db:status     # cek server + port (read-only)
npm run db:start      # idempoten: start bila berhenti, bersihkan lock basi
npm run db:stop       # stop mode fast
npm run db:restart
npm run db:verify     # koneksi + status migrasi (read-only)
```

- Bila server mati mendadak, `db:start` otomatis menghapus `postmaster.pid`
  dan lock socket yang basi (tidak menghapus data).
- Inisialisasi cluster baru **hanya dari shell Termux** (bukan proot):

```bash
initdb -D "$PREFIX/var/lib/postgresql" -U postgres --auth=trust --no-locale -E UTF8
```

## Bila tool/sesi opencode hang

1. Jangan tunggu. Tekan `Esc` (atau `Ctrl+C`) di sesi tersebut untuk cancel tool.
2. Dari terminal lain, cari proses yang macet:
   ```bash
   ps -eo pid,ppid,stat,etime,cmd | awk '$3 ~ /^[tT]/'
   ```
   Status `t` = `ptrace_stop` (tersangka utama proot).
3. Matikan proses proot induknya (bukan hanya anaknya):
   ```bash
   kill -9 <PID_proot> <PID_anak>
   ```
4. Riwayat sesi tersimpan di database. Lanjutkan dengan:
   ```bash
   opencode -s <session-id>
   ```


## Cabang & PR

1. Pekerjaan di `feat/kasir-nova-v2` (boleh dari HP maupun laptop).
2. Uji lulus + ditinjau → buka PR `feat/kasir-nova-v2` → `main`.
3. Merge hanya atas persetujuan; **tidak ada** force-push.

## Keamanan

- Jangan commit `server/.env` atau cadangan env (`.env.*` sudah di-ignore,
  `.env.example` tetap boleh).
- Jangan menjalankan `db:seed`/`db:migrate` pada database produksi; gunakan DB
  dev lokal (`server/.env`).
- Jangan hapus database, jangan `DROP`, jangan deployment tanpa persetujuan.
