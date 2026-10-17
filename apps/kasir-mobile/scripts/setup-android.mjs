/**
 * Terapkan penyesuaian KASIR NOVA ke proyek Android hasil `cap add android`.
 *
 * Aman dijalankan berulang (idempoten): dapat dipanggil lagi setelah
 * `npx cap add android` untuk memasang ulang plugin printer & izin Bluetooth.
 *
 * Yang dilakukan:
 *   1. Menyalin MainActivity.java + NovaPrinterPlugin.java + NovaReceiptPlugin.java
 *      dari android-templates.
 *   2. Menambahkan izin Bluetooth (Classic + BLE) ke AndroidManifest.xml.
 *   3. Menetapkan versionName/versionCode aplikasi.
 *   4. Menambahkan dukungan tanda tangan rilis dari `android/key.properties`.
 *   5. Menetapkan nama aplikasi di strings.xml.
 *
 * Pemakaian: node scripts/setup-android.mjs
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const androidDir = join(projectRoot, 'android');
const templatesDir = join(projectRoot, 'android-templates');

// Versi aplikasi mengikuti package.json (satu sumber kebenaran) agar tidak
// melenceng antar berkas; dapat ditimpa lewat NOVA_APP_VERSION.
const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
const APP_VERSION_NAME = process.env.NOVA_APP_VERSION ?? pkg.version ?? '1.0.0-beta.1';
const APP_VERSION_CODE = Number(process.env.NOVA_APP_VERSION_CODE ?? 1);

if (!existsSync(androidDir)) {
  console.error('ERROR: folder android/ tidak ada. Jalankan `npx cap add android` dulu.');
  process.exit(1);
}

// 1) Salin kelas Java (MainActivity + plugin printer).
const pkgDir = join(androidDir, 'app', 'src', 'main', 'java', 'id', 'kasirnova', 'kasir');
mkdirSync(pkgDir, { recursive: true });
for (const file of ['MainActivity.java', 'NovaPrinterPlugin.java', 'NovaReceiptPlugin.java']) {
  copyFileSync(join(templatesDir, file), join(pkgDir, file));
  console.log(`✓ ${file} -> android/app/src/main/java/id/kasirnova/kasir/`);
}

// 2) Patch AndroidManifest.xml — tambahkan izin Bluetooth.
const manifestPath = join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml');
let manifest = readFileSync(manifestPath, 'utf8');

const BT_PERMISSIONS = `
    <!-- Bluetooth: cetak struk thermal (Fase 17) -->
    <!-- Classic (SPP) untuk Android <= 11 -->
    <uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
    <uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />
    <!-- Android 12+ : runtime Bluetooth permissions -->
    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
    <uses-permission android:name="android.permission.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation" />
    <!-- Pemindaian BLE di Android <= 11 memerlukan lokasi -->
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" android:maxSdkVersion="30" />
    <uses-feature android:name="android.hardware.bluetooth" android:required="false" />`;

if (!manifest.includes('android.permission.BLUETOOTH_CONNECT')) {
  const anchor = '    <uses-permission android:name="android.permission.INTERNET" />';
  if (!manifest.includes(anchor)) {
    console.error('ERROR: tidak menemukan anchor izin INTERNET di AndroidManifest.xml.');
    process.exit(1);
  }
  manifest = manifest.replace(anchor, `${BT_PERMISSIONS}\n${anchor}`);
  writeFileSync(manifestPath, manifest);
  console.log('✓ AndroidManifest.xml: izin Bluetooth ditambahkan');
} else {
  console.log('• AndroidManifest.xml: izin Bluetooth sudah ada (dilewati)');
}

// 3) Patch app/build.gradle — versionName & versionCode.
const gradlePath = join(androidDir, 'app', 'build.gradle');
let gradle = readFileSync(gradlePath, 'utf8');
const before = gradle;
gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${APP_VERSION_CODE}`);
gradle = gradle.replace(/versionName\s+"[^"]*"/, `versionName "${APP_VERSION_NAME}"`);
if (gradle !== before) {
  writeFileSync(gradlePath, gradle);
  console.log(`✓ app/build.gradle: versionName=${APP_VERSION_NAME}, versionCode=${APP_VERSION_CODE}`);
} else {
  console.log('• app/build.gradle: versi tidak berubah');
}

// 4) Patch app/build.gradle — tanda tangan rilis dari android/key.properties.
//    Blok yang pernah disisipkan dihapus lebih dulu, lalu disisipkan versi
//    terbaru (idempoten dan bisa diperbarui). Bila `key.properties` tidak ada,
//    APK rilis ditandatangani dengan **debug keystore** agar tetap dapat
//    dipasang untuk uji lokal; distribusi resmi memakai keystore rilis.
const SIGNING_LOAD = `
// KASIR NOVA: signing
// Memuat kredensial keystore rilis dari android/key.properties (TIDAK di-commit).
// Contoh isi: lihat apps/kasir-mobile/key.properties.example
def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file('key.properties')
def hasReleaseSigning = keystorePropertiesFile.exists()
if (hasReleaseSigning) {
    keystorePropertiesFile.withInputStream { keystoreProperties.load(it) }
}
`;

const SIGNING_CONFIGS = `    signingConfigs {
        release {
            if (hasReleaseSigning) {
                storeFile file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
            }
        }
    }
`;

// Bentuk lama (v1) dipertahankan agar berkas yang sudah pernah dipatch ikut
// dinormalisasi ketika skrip dijalankan kembali.
const SIGNING_BUILD_TYPE_OLD = `            if (hasReleaseSigning) {
                signingConfig signingConfigs.release
            }
`;
const SIGNING_BUILD_TYPE = `            signingConfig hasReleaseSigning ? signingConfigs.release : signingConfigs.debug
`;

{
  // Normalisasi: buang sisipan versi mana pun yang sudah ada.
  let normalized = gradle;
  for (const snippet of [SIGNING_LOAD, SIGNING_CONFIGS, SIGNING_BUILD_TYPE_OLD, SIGNING_BUILD_TYPE]) {
    normalized = normalized.split(snippet).join('');
  }
  // Rapikan baris kosong berlebih yang mungkin ditinggalkan versi sebelumnya.
  normalized = normalized.replace(/(\r?\n)+android \{/, '\n\nandroid {');

  const APP_PLUGIN = "apply plugin: 'com.android.application'";
  let injected = normalized.includes(APP_PLUGIN)
    ? normalized.replace(APP_PLUGIN, `${APP_PLUGIN}${SIGNING_LOAD}`)
    : null;
  injected = injected && injected.replace(/(\r?\n)(    buildTypes \{)/, `$1${SIGNING_CONFIGS}$2`);
  injected =
    injected &&
    injected.replace(
      /(\r?\n)(\s*proguardFiles getDefaultProguardFile\('proguard-android\.txt'\), 'proguard-rules\.pro')/,
      `$1${SIGNING_BUILD_TYPE}$2`
    );

  const ok =
    injected &&
    injected.includes(SIGNING_LOAD) &&
    injected.includes(SIGNING_CONFIGS) &&
    injected.includes(SIGNING_BUILD_TYPE);

  if (!ok) {
    console.error('PERINGATAN: gagal menyisipkan konfigurasi tanda tangan rilis ke app/build.gradle.');
  } else if (injected === gradle) {
    console.log('• app/build.gradle: tanda tangan rilis sudah terbaru (tidak berubah)');
  } else {
    writeFileSync(gradlePath, injected);
    console.log('✓ app/build.gradle: tanda tangan rilis (release → key.properties, fallback debug)');
  }
}

// 5) Pastikan app_name tetap KASIR NOVA.
const stringsPath = join(androidDir, 'app', 'src', 'main', 'res', 'values', 'strings.xml');
if (existsSync(stringsPath)) {
  let strings = readFileSync(stringsPath, 'utf8');
  const next = strings
    .replace(/(<string name="app_name">)[^<]*(<\/string>)/, '$1KASIR NOVA$2')
    .replace(/(<string name="title_activity_main">)[^<]*(<\/string>)/, '$1KASIR NOVA$2');
  if (next !== strings) {
    writeFileSync(stringsPath, next);
    console.log('✓ strings.xml: nama aplikasi = KASIR NOVA');
  }
}

console.log('\nSelesai. Lanjutkan dengan Gradle build (assembleDebug).');
