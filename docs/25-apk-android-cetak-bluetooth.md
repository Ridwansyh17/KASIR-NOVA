# KASIR NOVA — APK Android (Panel Kasir) & Cetak Struk Thermal Bluetooth

**Fase 17** · dokumen ini menjelaskan APK Android panel **Kasir** beserta cetak
struk langsung ke **printer thermal Bluetooth (ESC/POS)**, baik tipe
**Classic (SPP/RFCOMM)** maupun **BLE (GATT)**.

> **Keputusan pemilik (revisi Fase 12):** distribusi klien tetap **web via
> Firebase Hosting** untuk Owner/Admin, **tetapi panel Kasir kini juga
> dibungkus menjadi APK Android** agar dapat mencetak struk ke printer thermal
> Bluetooth secara langsung dari perangkat.

---

## 1. Ruang lingkup

| Aspek | Ketetapan |
|---|---|
| Panel yang dipaketkan | **Kasir saja** (`apps/kasir`) |
| Owner / Admin Platform | tetap **web** (Firebase Hosting) |
| Application ID | `id.kasirnova.kasir` |
| Nama aplikasi | **KASIR NOVA** |
| Versi | `1.0.0-beta.3` (versionCode `3`) |
| Pembungkus | **Capacitor 7** (`@capacitor/core|cli|android@^7`) |
| Target | Android **6.0+** (minSdk 23), compile/target SDK 35 |
| Lebar kertas | **58 mm** (32 kolom) dan **80 mm** (48 kolom) |
| Distribusi beta | **Firebase App Distribution** |

Aturan bisnis **tidak berubah**: satu akun Kasir hanya untuk satu outlet, harga
& total dihitung server, status langganan diperiksa server. APK hanya lapisan
presentasi + transport cetak.

---

## 2. Arsitektur

```
apps/kasir-mobile/
  capacitor.config.json        # appId, appName, webDir=www, androidScheme=https
  package.json                 # @nova/kasir-mobile (Capacitor 7)
  key.properties.example       # contoh kredensial keystore rilis (yang asli diabaikan git)
  scripts/
    build-www.mjs              # salin apps/kasir + modul → www/
    setup-android.mjs          # idempoten: plugin Java + izin BT + versi + signing
    distribute.mjs             # unggah APK ke Firebase App Distribution
  android-templates/
    MainActivity.java          # mendaftarkan NovaPrinterPlugin
    NovaPrinterPlugin.java     # plugin Capacitor (SPP + BLE, base64)
  android/                     # dihasilkan `cap add android` (sumber di-commit)
    app/src/main/java/...      # kelas Java (kelola via setup-android.mjs)
    app/src/main/AndroidManifest.xml
    app/build.gradle           # versi + signing (kelola via setup-android.mjs)
    key.properties             # rahasia tanda tangan (TIDAK di-commit)
    app/google-services.json   # konfigurasi Firebase (TIDAK di-commit)
    app/src/main/assets/public # salinan web dari `npm run sync` (diabaikan)
```

### 2.1 Alur data cetak

```
app.js (UI)
  → escpos.js          bentuk byte ESC/POS murni JS (58/80 mm)
  → printer.js         base64 + panggil plugin NovaPrinter
      → NovaPrinterPlugin.java (Android)
          → SPP : BluetoothSocket (RFCOMM, UUID 00001101-...)
          → BLE : BluetoothGatt (cari karakteristik tulis, chunk 180 B)
```

- **Byte ESC/POS dibentuk di JavaScript** (`apps/kasir/src/escpos.js`) sehingga
  identik dengan pratinjau struk di layar dan mudah diuji unit (tanpa Android).
- Plugin Java hanya **transport**: kirim/tulis byte. Tidak ada logika bisnis.
- Data melewati bridge Capacitor sebagai **base64** (aman untuk byte biner).

### 2.2 WebView & CORS

`androidScheme: "https"` → origin WebView adalah **`https://localhost`**.
Backend (`server/src/config/env.js`) **selalu** menambahkan
`https://localhost`, `capacitor://localhost`, dan `http://localhost` ke
allowlist CORS sehingga APK dapat memanggil API production.
Diuji oleh `server/tests/cors.test.js`.

---

## 3. Modul JavaScript (panel Kasir)

### 3.1 `apps/kasir/src/escpos.js` — encoder ESC/POS murni

- Konstanta/ekspor: `PAPER_COLUMNS`, `columnsFor`, `fmtIDR`, `fmtDate`,
  `METHOD_LABELS`, `paymentStatusLabel`, `twoColumn`, `buildStrukEscPos`,
  `buildTestEscPos`.
- Perintah: `ESC @` (init), `ESC a` (alignment), `ESC E` (bold),
  `GS !` (ukuran ganda), `GS V` (potong kertas).
- **ASCII-only**: karakter non-ASCII diganti `?` agar tidak menjadi sampah di
  printer yang tidak mendukung UTF-8.
- TOTAL dicetak **tebal + tinggi ganda**; uji cetak (`buildTestEscPos`) netral
  (tidak menyatakan status pembayaran apa pun).

### 3.2 `apps/kasir/src/printer.js` — transport

- Tanpa impor relatif (aman dimuat langsung maupun lewat bundler halaman).
- Nama plugin: **`NovaPrinter`** (dipanggil via
  `window.Capacitor.Plugins.NovaPrinter` / `Capacitor.registerPlugin`).
- Ekspor: `isNative`, `checkAvailability`, `requestPermissions`,
  `checkPermissions`, `listBonded`, `scanBle`, `stopBleScan`, `connect`,
  `disconnect`, `connectionStatus`, `printBytes`, `bytesToBase64`,
  `getSavedDevice` / `saveDevice` / `clearDevice`, `getSettings` /
  `saveSettings`, `PrinterError` (kode `not_native`).
- Preferensi lokal: `nova_kasir_printer_device`, `nova_kasir_printer_settings`.
- Di browser (non-native) fitur **dinonaktifkan dengan pesan jelas** (tidak
  melempar error tak tertangani).

### 3.3 `apps/kasir/src/app.js` — UI

- Kartu **Printer Thermal**: pindai → sambung → simpan perangkat → uji cetak →
  cetak struk.
- Tombol **Cetak Struk (Thermal)** muncul hanya saat perangkat tersambung.
- Opsi **cetak otomatis** setelah pembayaran berhasil.
- Tetap mempertahankan cetak browser/PDF/e-receipt yang lama.

---

## 4. Plugin Android `NovaPrinter`

Metode yang dipanggil dari JS:

| Metode | Fungsi |
|---|---|
| `isAvailable` | Bluetooth ada/aktif/tersambung |
| `status` | perangkat & transport yang tersambung |
| `listBondedDevices` | daftar perangkat **terpasangkan** (SPP) |
| `startBleScan` | pindai BLE (timeout, mis. 8 dtk) |
| `stopBleScan` | hentikan pindai lebih awal |
| `connect` | sambung (`transport: "spp"` atau `"ble"`) |
| `write` | kirim base64 byte ESC/POS |
| `disconnect` | tutup sambungan |
| `checkPermissions` / `requestPermissions` | **disediakan kelas dasar** Capacitor (berbasis anotasi) |

- BLE: cari karakteristik **writable** pada layanan yang dikenal
  (FF00, FFE0, 18F0, 49535343-…); fallback ke karakteristik writable pertama.
- Penulisan SPP di **thread I/O**, chunk 512 B; BLE chunk 180 B.
- API modern dijaga (`BluetoothStatusCodes`/`writeCharacteristic` API 33,
  izin runtime API 31+) dengan `Build.VERSION.SDK_INT` guard.

### 4.1 Izin (AndroidManifest.xml disisipkan `setup-android.mjs`)

```xml
<uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.BLUETOOTH_SCAN"
    android:usesPermissionFlags="neverForLocation" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" android:maxSdkVersion="30" />
<uses-feature android:name="android.hardware.bluetooth" android:required="false" />
```

- Android 12+ → `BLUETOOTH_CONNECT` + `BLUETOOTH_SCAN` (runtime).
- Android ≤ 11 → `BLUETOOTH`/`BLUETOOTH_ADMIN` (normal) + `ACCESS_FINE_LOCATION`
  (runtime, syarat pemindaian BLE di versi lama).
- `android.hardware.bluetooth` **tidak wajib** agar app tetap dapat dipasang
  pada perangkat tanpa Bluetooth (fitur cetak dinonaktifkan).

---

## 5. Prasyarat build di komputer

1. **JDK 21** — mis.
   `C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot`.
2. **Android SDK** di `C:\Android` dengan:
   `cmdline-tools;latest`, `platform-tools`, `platforms;android-35`,
   `build-tools;35.0.0` (lisensi diterima).
3. Node.js ≥ 20 (proyek memakai Node 24).

`local.properties` (tidak di-commit) berisi `sdk.dir=C\:\\Android`.

---

## 6. Langkah build APK

```powershell
# 0) variabel lingkungan (per sesi)
$env:JAVA_HOME = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot'
$env:PATH      = "$env:JAVA_HOME\bin;$env:PATH"
$env:ANDROID_HOME = 'C:\Android'

cd 'apps\kasir-mobile'

# 1) dependensi (sekali)
cmd /c "npm install"

# 2) salin web panel Kasir → www/   (default API: https://kasir-nova.vercel.app)
cmd /c "npm run build:www"

# 3) buat proyek Android (sekali; butuh www/)
cmd /c "npm run android:add"

# 4) terapkan plugin Java, izin Bluetooth, versi (idempoten)
cmd /c "npm run android:prepare"

# 5) buat local.properties (sekali)
"sdk.dir=C\:\\Android" | Set-Content android\local.properties -Encoding ascii

# 6) sinkronkan aset web + build APK debug
cmd /c "npx cap sync android"
cd android
cmd /c "gradlew.bat assembleDebug"
```

Hasil: `apps/kasir-mobile/android/app/build/outputs/apk/debug/app-debug.apk`.

> Ganti API base saat build, mis.
> `$env:NOVA_API_BASE='https://kasir-nova.vercel.app'` sebelum `npm run build:www`.

### 6.1 Setelah mengubah web panel Kasir

```powershell
cd apps\kasir-mobile
cmd /c "npm run sync"     # build:www + cap sync android
```

`setup-android.mjs` **tidak perlu** diulang, tetapi aman dijalankan ulang.
Jika proyek `android/` dibuat ulang (`android:add`), jalankan lagi
`android:prepare`.

### 6.2 Memakai Android Studio (opsional)

Prasyarat: Android Studio **Ladybug 2024.2.1+** (AGP 8.7.2), Gradle JDK **21**,
**SDK Location = `C:\Android`** dengan *Android 15 (API 35)* + *Build-Tools
35.0.0* + *Platform-Tools*.

1. **File → Open** → pilih folder **`apps\kasir-mobile\android`**
   (bukan root repo, bukan `apps\kasir-mobile`) → tunggu **Gradle Sync**.
2. Jalankan `npm run sync` lebih dulu bila kode web `apps/kasir` berubah —
   Studio tidak tahu soal npm.
3. **Build → Build Bundle(s) / APK(s) → Build APK(s)** →
   `android\app\build\outputs\apk\debug\app-debug.apk`.
4. **Run ▶** / **Debug 🐞** ke perangkat (aktifkan *USB debugging*).
   Log: **Logcat** (filter `Capacitor`/`NovaPrinter`); inspeksi WebView via
   `chrome://inspect`.
5. **Generate Signed Bundle / APK…** untuk keystore + APK rilis sekaligus
   (lihat §7.5 bila ingin build rilis dari CLI).

> Jangan mengedit langsung berkas di `android/` yang dikelola
> `setup-android.mjs` (izin manifest, versi, kelas Java, konfigurasi tanda
> tangan) — ubah **template**-nya lalu jalankan `npm run android:prepare`.

---

## 7. Distribusi beta — Firebase App Distribution

Project Firebase: **`kasir-nova`** (Project Number `1057858530498`).

Status (13 Okt 2026, sudah dilakukan):
- Aplikasi Android **`id.kasirnova.kasir`** terdaftar —
  **App ID `1:1057858530498:android:7091503841af1c892a9f5b`**.
- `google-services.json` sudah diambil ke
  `apps/kasir-mobile/android/app/google-services.json` (**tidak di-commit**).
- Grup penguji **`kasir-beta`** (nama tampil *kasir-nova beta*) dibuat.
- APK **`1.0.0-beta.1`** (debug-signed) didistribusikan — **digantikan** oleh
  beta.2 di bawah.
- **Keystore rilis resmi dibuat** (`nova-release.jks`, alias `nova-kasir`,
  RSA 2048, valid s/d 2054) dan **APK `1.0.0-beta.2` bertanda tangan resmi**
  telah didistribusikan ke grup `kasir-beta`; penguji:
  `ridwansyarifuddin110@gmail.com`.
- **Backend produksi sudah di-deploy ulang** dengan origin WebView
  (`https://localhost`, `capacitor://localhost`, `http://localhost`) pada
  allowlist CORS — tanpa ini APK tidak dapat memanggil API (§7.0).
- Berkas APK siap pasang ada di
  **`dist/apk/KASIR-NOVA-1.0.0-beta.2.apk`** (diabaikan git).
- **Web panel Kasir di-deploy ulang** ke Firebase Hosting sehingga memuat modul
  printer Fase 17 (kartu *Printer Thermal*; di browser biasa menampilkan catatan
  "Hanya di aplikasi Android"). Panel Owner & Admin tidak berubah.
- **V0.3 (13 Okt 2026):** APK **`1.0.0-beta.3`** (versionCode `3`) dibangun dari
  panel Kasir terkini — ikon launcher **KASIR NOVA** (adaptive, latar navy),
  ikon PWA + `site.webmanifest`, dan seluruh fitur V0.3. Ditandatangani
  **keystore rilis yang sama** seperti beta.2 (`v1+v2`, DN *KASIR NOVA*),
  sehingga dapat dipasang **di atas** beta.2. Berkas:
  `dist/apk/KASIR-NOVA-1.0.0-beta.3.apk`. **Belum diunggah** ke Firebase App
  Distribution (menunggu persetujuan).

> **Penting saat beralih beta.1 → beta.2:** beta.1 ditandatangani *debug
> keystore*, beta.2 dengan *keystore rilis* — tanda tangannya berbeda, jadi
> Android akan menolak pemasangan di atas versi lama. **Copot pemasangan
> beta.1 lebih dulu**, baru pasang beta.2 (data lokal aplikasi kasir
> tidak tersimpan di APK; sesi login cukup masuk ulang).

> **beta.2 → beta.3:** ditandatangani keystore rilis yang **sama**, jadi dapat
> dipasang **langsung di atas** beta.2 (tanpa copot-pasang).

### 7.0 Prasyarat agar APK berfungsi (CORS backend)

APK berjalan di WebView dengan origin **`https://localhost`**
(`server.androidScheme = 'https'`). Backend **harus** mengizinkan origin ini,
jika tidak semua permintaan API gagal. `server/src/config/env.js` sudah
menambahkannya otomatis, sehingga backend perlu **di-deploy ulang** setiap
kali berkas itu berubah:

```powershell
cd 'D:\NOVA PROJECT (RIDWAN)'
npx vercel deploy --prod --yes --token <VERCEL_TOKEN>
```

Verifikasi cepat (harus mengembalikan `Access-Control-Allow-Origin:
https://localhost`):

```powershell
Invoke-WebRequest 'https://kasir-nova.vercel.app/api/health' -Headers @{ Origin = 'https://localhost' } -UseBasicParsing | Select-Object -ExpandProperty Headers
```

### 7.1 Aplikasi Android (sudah terdaftar)

```powershell
cmd /c 'firebase apps:create ANDROID "KASIR NOVA" --package-name id.kasirnova.kasir --project kasir-nova'
cmd /c 'firebase apps:list ANDROID --project kasir-nova'
cmd /c 'firebase apps:sdkconfig ANDROID 1:1057858530498:android:7091503841af1c892a9f5b -o apps/kasir-mobile/android/app/google-services.json'
```

`google-services.json` berisi konfigurasi project dan **tidak di-commit**
(sudah masuk `.gitignore`). Berkas ini hanya dipakai bila memakai plugin
Firebase/Gradle di Android Studio.

### 7.2 Grup penguji `kasir-beta`

Tambahkan penguji lewat Console (**App Distribution → Testers & Groups → kasir-beta**)
atau CLI:

```powershell
cmd /c 'firebase appdistribution:testers:add penguji@contoh.com --group-alias kasir-beta --project kasir-nova'
cmd /c 'firebase appdistribution:groups:list --project kasir-nova'
```

### 7.2b Cara memasang di HP (penguji)

1. **Lewat Firebase App Distribution** — penguji menerima email undangan dari
   `firebaseappdistribution-noreply@google.com`; buka tautannya, setujui
   undangan, lalu pasang aplikasi. (Disarankan memasang **App Tester**.)
2. **Lewat berkas APK langsung** (paling cepat) — salin
   `dist/apk/KASIR-NOVA-1.0.0-beta.3.apk` ke HP (USB/Google Drive), lalu buka
   berkas di HP dan izinkan **"Install unknown apps"** untuk aplikasi
   pengelola berkas yang dipakai.
3. Saat pertama dibuka, izinkan **Nearby devices/Bluetooth** (Android 12+) atau
   **Location** (Android ≤ 11) agar pemindai printer bekerja.

### 7.3 Unggah APK ke penguji (CLI)

```powershell
cd apps\kasir-mobile
node scripts\distribute.mjs ..\..\dist\apk\KASIR-NOVA-1.0.0-beta.3.apk
# atau pakai APK hasil Gradle:
node scripts\distribute.mjs android\app\build\outputs\apk\debug\app-debug.apk
# paling singkat (APK rilis bila ada, jika tidak APK debug):
npm run distribute
```

Default skrip sudah memakai App ID project `kasir-nova` dan grup `kasir-beta`;
override bila perlu: `NOVA_FIREBASE_APP_ID`, `NOVA_TESTER_GROUPS`,
`NOVA_RELEASE_NOTES`, `NOVA_FIREBASE_TOKEN` (CI).

`scripts/distribute.mjs` memanggil `firebase appdistribution:distribute`
lewat entrypoint Node CLI langsung, agar jalur berkas/argumen berspasi aman di
Windows (menghindari masalah quoting `cmd.exe`). Untuk beta awal, APK **debug**
sudah cukup. **Distribusi ke penguji selalu tindakan sadar** — tidak dijalankan
otomatis.

### 7.4 Android Studio — Firebase Assistant

1. **Tools → Firebase → App Distribution → Distribute your app**.
2. Ikuti wizard: login → pilih project `kasir-nova` → hubungkan
   (`google-services.json` di `apps/kasir-mobile/android/app/`) → pilih grup
   penguji `kasir-beta`. Wizard menambahkan plugin Gradle
   `com.google.firebase.appdistribution`.
3. Setelah terhubung, buka panel **Gradle → app → Tasks → firebase
   appdistribution → `appDistributionUploadDebug` / `...UploadRelease`** untuk unggah.

### 7.5 Tanda tangan rilis (keystore)

```powershell
# 0) keytool ada di JAVA_HOME\bin
$env:JAVA_HOME = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot'
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"

# 1) buat keystore rilis (SEKALI). Simpan sandi di tempat aman (jangan di git).
keytool -genkeypair -v -keystore apps\kasir-mobile\android\nova-release.jks `
  -alias nova-kasir -keyalg RSA -keysize 2048 -validity 10000

# 2) buat key.properties dari contoh, lalu isi dengan sandi keystore di atas
Copy-Item apps\kasir-mobile\key.properties.example apps\kasir-mobile\android\key.properties
notepad apps\kasir-mobile\android\key.properties

# 3) build APK rilis bertanda tangan
cd apps\kasir-mobile
cmd /c "npm run apk:release"
```

- `storeFile` di `key.properties` relatif terhadap modul `android/app/`
  (contoh `../nova-release.jks` = `apps/kasir-mobile/android/nova-release.jks`).
- **Status saat ini:** keystore rilis sudah dibuat —
  `apps/kasir-mobile/android/nova-release.jks` (alias `nova-kasir`, RSA 2048,
  valid s/d 2054) dengan `key.properties` terisi, sehingga `assembleRelease`
  menghasilkan APK bertanda tangan **sertifikat KASIR NOVA**.
  Kredensial disimpan di
  `apps/kasir-mobile/android/keystore-credentials.txt` (dan salinan di
  `dist/apk/keystore-credentials.txt`) — **diabaikan git**, pindahkan ke
  password manager.
- Tanpa `key.properties`, `assembleRelease` tetap berjalan dan menghasilkan
  `app-release.apk` yang ditandatangani dengan debug keystore (cukup untuk uji
  lokal; **jangan** dipakai untuk distribusi resmi karena tanda tangannya
  berbeda dari rilis resmi).
- Hasil: `apps/kasir-mobile/android/app/build/outputs/apk/release/app-release.apk`.
- `*.jks`, `*.keystore`, `key.properties`, `keystore-credentials.txt`, `*.apk`,
  `*.aab` **diabaikan git**.
- Versi aplikasi bersumber dari `apps/kasir-mobile/package.json`
  (`version`), dipakai `setup-android.mjs` untuk `versionName`.
- Naikkan `versionCode` tiap rilis:
  `$env:NOVA_APP_VERSION_CODE='3'` sebelum `npm run android:prepare`.

---

## 8. Pengujian

| Uji | Berkas | Status |
|---|---|---|
| Encoder ESC/POS (kolom, perintah, ASCII, potong) | `server/tests/printer-escpos.test.js` | ✅ lulus |
| Allowlist CORS WebView (`https://localhost`, `capacitor://localhost`) | `server/tests/cors.test.js` | ✅ lulus |
| Suite server penuh | `npm run test:server` | ✅ **220 tes, 220 lulus, 0 gagal** |
| Verifikasi statis UI 3 panel + smoke bundel hosting | `node scripts/verify-ui.mjs` | ✅ rujukan aset/id/`api.*`/ikon manifest OK; 12/12 aset `dist/hosting` `200` |
| Build APK debug | `gradlew assembleDebug` | ✅ APK (~3,97 MB); package/versi/izin/plugin terverifikasi (`aapt2 dump badging`) |
| Build APK rilis bertanda tangan resmi | `gradlew assembleRelease` | ✅ `app-release.apk` (~3,62 MB), v`1.0.0-beta.3`/code 3, sertifikat **KASIR NOVA** (bukan debug), v1+v2 scheme (`apksigner verify`; beta.2 sebelumnya juga terverifikasi) |
| CORS produksi untuk APK | `GET /api/health` + `Origin: https://localhost` | ✅ `200` + `Access-Control-Allow-Origin: https://localhost` |
| CORS produksi web (regresi) | `GET /api/health` + `Origin: https://kasir-nova.web.app` | ✅ `200` + header sesuai |
| Distribusi beta | `node scripts/distribute.mjs …` | ✅ grup `kasir-beta` (1 penguji, rilis `1.0.0-beta.2`; **beta.3 belum diunggah**) |
| **Cetak ke printer fisik (SPP)** | perangkat nyata | ⚠️ **belum diuji** (tidak ada printer) |
| **Cetak ke printer fisik (BLE)** | perangkat nyata | ⚠️ **belum diuji** (tidak ada printer) |

> **Catatan jujur:** karena belum tersedia printer thermal fisik, keberhasilan
> cetak **runtime** pada perangkat nyata (SPP maupun BLE) **belum terverifikasi**.
> Yang sudah terverifikasi: byte ESC/POS benar (diuji unit), plugin terpasang &
> terkompilasi, APK terbentuk, dan alur UI tersedia. Petunjuk uji perangkat:
> pasangkan printer → buka APK → *Printers* → pindai → sambung → **Uji Cetak**.

---

## 9. Batasan & risiko

- Cetak hanya dari **perangkat Android** (WebView Capacitor), bukan browser
  desktop; di browser fitur dinonaktifkan dengan pesan yang jelas.
- Printer generik berbeda-beda; layanan/karakteristik BLE di luar daftar dikenal
  memakai fallback. Bila gagal, gunakan mode **SPP** (paling umum pada printer
  POS 58/80 mm).
- `androidScheme: https` mengubah origin menjadi `https://localhost`; jangan
  mengembalikan ke `http` tanpa meninjau ulang CORS.
- Version code dinaikkan setiap rilis ke penguji.
