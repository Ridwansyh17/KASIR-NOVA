/**
 * Unggah APK ke Firebase App Distribution (grup penguji KASIR NOVA).
 *
 * Prasyarat:
 *   - Firebase CLI terpasang & `firebase login` (sesi aktif).
 *   - Aplikasi Android `id.kasirnova.kasir` sudah terdaftar di project
 *     Firebase `kasir-nova` (lihat NOVA_FIREBASE_APP_ID di bawah).
 *
 * Pemakaian:
 *   node scripts/distribute.mjs                        # APK rilis (fallback debug)
 *   node scripts/distribute.mjs ..\..\dist\apk\app.apk # APK tertentu
 *
 * Opsi lingkungan:
 *   NOVA_FIREBASE_APP_ID  override App ID (default: project kasir-nova)
 *   NOVA_TESTER_GROUPS    grup penguji (default: kasir-beta)
 *   NOVA_RELEASE_NOTES    catatan rilis (default: dibuat otomatis)
 *   NOVA_FIREBASE_TOKEN   token CI (opsional; untuk non-interaktif)
 *
 * Catatan teknis: CLI dipanggil lewat entrypoint Node langsung
 * (`node firebase-tools/lib/bin/firebase.js ...`) supaya argumen yang memuat
 * spasi tidak rusak oleh quoting `cmd.exe` di Windows.
 *
 * Script ini TIDAK dijalankan otomatis oleh build — distribusi ke penguji selalu
 * merupakan tindakan sadar (butuh persetujuan pemilik).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, isAbsolute, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const version = pkg.version ?? '0.0.0';

const APP_ID = process.env.NOVA_FIREBASE_APP_ID ?? '1:1057858530498:android:7091503841af1c892a9f5b';
const GROUPS = process.env.NOVA_TESTER_GROUPS ?? 'kasir-beta';
const NOTES =
  process.env.NOVA_RELEASE_NOTES ??
  `KASIR NOVA ${version} - cetak struk thermal Bluetooth (SPP & BLE)`;

const defaultRelease = join(projectRoot, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
const defaultDebug = join(projectRoot, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');

/** Cari entrypoint JS Firebase CLI (agar argumen tidak lewat cmd.exe). */
function findFirebaseCli() {
  const candidates = [];
  if (process.env.APPDATA) {
    candidates.push(join(process.env.APPDATA, 'npm', 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js'));
  }
  if (process.env.npm_config_prefix) {
    candidates.push(join(process.env.npm_config_prefix, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js'));
  }
  candidates.push('/usr/local/lib/node_modules/firebase-tools/lib/bin/firebase.js');
  candidates.push('/usr/lib/node_modules/firebase-tools/lib/bin/firebase.js');
  return candidates.find((p) => existsSync(p)) ?? null;
}

const input = process.argv[2] ?? (existsSync(defaultRelease) ? defaultRelease : defaultDebug);
const apk = isAbsolute(input) ? input : resolvePath(process.cwd(), input);

if (!existsSync(apk)) {
  console.error(`ERROR: berkas APK tidak ditemukan: ${apk}`);
  console.error('Build APK dulu (mis. `npm run apk:debug`) atau berikan path yang benar.');
  process.exit(1);
}

const args = ['appdistribution:distribute', apk, '--app', APP_ID, '--groups', GROUPS, '--release-notes', NOTES];
if (process.env.NOVA_FIREBASE_TOKEN) {
  args.push('--token', process.env.NOVA_FIREBASE_TOKEN);
}

console.log(`→ Mengunggah ${apk}`);
console.log(`  App ID : ${APP_ID}`);
console.log(`  Grup   : ${GROUPS}`);
console.log(`  Catatan: ${NOTES}`);

const cli = findFirebaseCli();
const res = cli
  ? spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit', cwd: projectRoot })
  : spawnSync(process.platform === 'win32' ? 'firebase.cmd' : 'firebase', args, {
      stdio: 'inherit',
      cwd: projectRoot,
      shell: process.platform === 'win32',
    });

if (res.error) {
  console.error('ERROR menjalankan Firebase CLI:', res.error.message);
  process.exit(1);
}
process.exit(res.status ?? 1);
