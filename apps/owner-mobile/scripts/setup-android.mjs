/**
 * Terapkan penyesuaian OWNER NOVA ke proyek Android hasil `cap add android`.
 *
 * Aman dijalankan berulang (idempoten): dapat dipanggil lagi setelah
 * `npx cap add android`.
 *
 * Yang dilakukan:
 *   1. Menyalin MainActivity.java dari android-templates (tanpa plugin printer).
 *   2. Menetapkan versionName/versionCode aplikasi.
 *   3. Menambahkan dukungan tanda tangan rilis dari `android/key.properties`.
 *   4. Menetapkan nama aplikasi di strings.xml ("OWNER NOVA").
 *
 * Berbeda dari panel Kasir, Owner TIDAK memakai izin Bluetooth maupun plugin
 * printer thermal (docs/26 FASE 11) sehingga hanya butuh izin INTERNET bawaan.
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

// 1) Salin kelas Java (MainActivity tanpa plugin printer).
const pkgDir = join(androidDir, 'app', 'src', 'main', 'java', 'id', 'kasirnova', 'owner');
mkdirSync(pkgDir, { recursive: true });
for (const file of ['MainActivity.java']) {
  copyFileSync(join(templatesDir, file), join(pkgDir, file));
  console.log(`✓ ${file} -> android/app/src/main/java/id/kasirnova/owner/`);
}

// 2) Patch app/build.gradle — versionName & versionCode.
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

// 3) Patch app/build.gradle — tanda tangan rilis dari android/key.properties.
//    Blok yang pernah disisipkan dihapus lebih dulu, lalu disisipkan versi
//    terbaru (idempoten dan bisa diperbarui). Bila `key.properties` tidak ada,
//    APK rilis ditandatangani dengan **debug keystore** agar tetap dapat
//    dipasang untuk uji lokal; distribusi resmi memakai keystore rilis.
//
//    Setiap blok sisipan dibungkus **sentinel** (`// NOVA_SIGNING_*`) supaya
//    penghapusan blok lama tidak bergantung pada teks komentar persis —
//    perubahan komentar pada skrip ini tidak lagi menghasilkan blok ganda.
const SIGNING_LOAD = `// NOVA_SIGNING_BEGIN
// Memuat kredensial keystore rilis dari android/key.properties (TIDAK di-commit).
// Contoh isi: lihat apps/owner-mobile/key.properties.example
def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file('key.properties')
def hasReleaseSigning = keystorePropertiesFile.exists()
if (hasReleaseSigning) {
    keystorePropertiesFile.withInputStream { keystoreProperties.load(it) }
}
// NOVA_SIGNING_END
`;

const SIGNING_CONFIGS = `    // NOVA_SIGNING_CONFIGS_BEGIN
    signingConfigs {
        release {
            if (hasReleaseSigning) {
                storeFile file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
            }
        }
    }
    // NOVA_SIGNING_CONFIGS_END
`;

const SIGNING_BUILD_TYPE = `            // NOVA_SIGNING_RELEASE_BEGIN
            signingConfig hasReleaseSigning ? signingConfigs.release : signingConfigs.debug
            // NOVA_SIGNING_RELEASE_END
`;

// Pola penghapusan: versi sekarang (sentinel) + versi lama (tanpa sentinel).
// Pola TIDAK consumes baris kosong di sekitarnya agar struktur berkas tetap
// rapi (baris `}` tidak boleh menempel ke baris sebelumnya).
const REMOVE_PATTERNS = [
  /\/\/ NOVA_SIGNING_BEGIN\n(?:[^\n]*\n)*?\/\/ NOVA_SIGNING_END\n/g,
  /[ \t]*\/\/ NOVA_SIGNING_CONFIGS_BEGIN\n(?:[^\n]*\n)*?[ \t]*\/\/ NOVA_SIGNING_CONFIGS_END\n/g,
  /[ \t]*\/\/ NOVA_SIGNING_RELEASE_BEGIN\n(?:[^\n]*\n)*?[ \t]*\/\/ NOVA_SIGNING_RELEASE_END\n/g,
  // Versi lama: blok `def keystoreProperties` preceded komentar "...: signing".
  /\/\/[^\n]*: signing[^\n]*\n(?:[^\n]*\n)*?if \(hasReleaseSigning\) \{\n(?:[^\n]*\n)*?\}\n/g,
  // Versi lama: blok `signingConfigs { release { ... } }`.
  /[ \t]*signingConfigs \{\n[ \t]*release \{\n[ \t]*if \(hasReleaseSigning\) \{\n(?:[^\n]*\n)*?[ \t]*\}\n[ \t]*\}\n[ \t]*\}\n/g,
  // Versi lama: `signingConfig` di dalam blok release.
  /[ \t]*signingConfig hasReleaseSigning \? signingConfigs\.release : signingConfigs\.debug\n/g,
  /[ \t]*if \(hasReleaseSigning\) \{\n[ \t]*signingConfig signingConfigs\.release\n[ \t]*\}\n/g,
];

{
  // Normalisasi: buang sisipan versi mana pun yang sudah ada.
  let normalized = gradle;
  for (const pattern of REMOVE_PATTERNS) {
    normalized = normalized.replace(pattern, '');
  }
  // Rapikan baris kosong berlebih yang mungkin ditinggalkan versi sebelumnya.
  normalized = normalized.replace(/(\r?\n)+android \{/, '\n\nandroid {');

  const APP_PLUGIN = "apply plugin: 'com.android.application'";
  let injected = normalized.includes(APP_PLUGIN)
    ? normalized.replace(APP_PLUGIN, `${APP_PLUGIN}\n${SIGNING_LOAD}`)
    : null;
  injected = injected && injected.replace(/(\r?\n)(    buildTypes \{)/, `$1${SIGNING_CONFIGS}$2`);
  // Sisipkan `signingConfig ...` tepat setelah baris proguardFiles di dalam
  // blok `release { ... }` (template Capacitor 7 memakai proguard-android.txt).
  injected =
    injected &&
    injected.replace(
      /(\n\s*proguardFiles getDefaultProguardFile\('proguard-android(?:-optimize)?\.txt'\), 'proguard-rules\.pro'\n)/,
      `$1${SIGNING_BUILD_TYPE}`
    );

  if (!injected || !injected.includes('signingConfig hasReleaseSigning')) {
    console.warn('• app/build.gradle: gagal menyisipkan blok signing (struktur berbeda) — periksa manual.');
  } else if (injected !== gradle) {
    writeFileSync(gradlePath, injected);
    console.log('✓ app/build.gradle: tanda tangan rilis dari key.properties disiapkan');
  } else {
    console.log('• app/build.gradle: tanda tangan rilis sudah terbaru (tidak berubah)');
  }
}

// 4) Patch strings.xml — nama aplikasi.
//    Label di bawah ikon peluncur diambil dari `title_activity_main`
//    (activity LAUNCHER), jadi keduanya disetel sama: "OWNER NOVA".
const APP_LABEL = process.env.NOVA_APP_LABEL ?? 'OWNER NOVA';
const stringsPath = join(androidDir, 'app', 'src', 'main', 'res', 'values', 'strings.xml');
if (existsSync(stringsPath)) {
  let strings = readFileSync(stringsPath, 'utf8');
  const beforeStrings = strings;
  strings = strings.replace(
    /<string name="app_name">[^<]*<\/string>/,
    `<string name="app_name">${APP_LABEL}</string>`
  );
  strings = strings.replace(
    /<string name="title_activity_main">[^<]*<\/string>/,
    `<string name="title_activity_main">${APP_LABEL}</string>`
  );
  if (strings !== beforeStrings) {
    writeFileSync(stringsPath, strings);
    console.log(`✓ strings.xml: nama aplikasi = ${APP_LABEL}`);
  } else {
    console.log('• strings.xml: nama aplikasi tidak berubah');
  }
}

console.log('\nSelesai. Lanjutkan dengan Gradle build (assembleDebug).');
