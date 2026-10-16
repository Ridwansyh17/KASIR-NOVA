/**
 * sync-shared.mjs — menyalin berkas bersama (canonical) ke tiap aplikasi.
 *
 * Aplikasi KASIR NOVA tidak memakai bundler: setiap panel memuat berkasnya
 * sendiri dari `apps/<app>/src/`. Agar tidak terjadi penyimpangan (drift),
 * berkas bersama disimpan satu kali di `shared/` lalu disalin ke tiap panel.
 *
 * Pemakaian:
 *   node scripts/sync-shared.mjs          # tulis salinan
 *   node scripts/sync-shared.mjs --check  # hanya periksa (keluar 1 bila beda)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

/** Sumber kanonik -> daftar tujuan salinan. */
export const SHARED_FILES = [
  {
    from: 'shared/product-image.js',
    to: ['apps/owner/src/product-image.js', 'apps/kasir/src/product-image.js'],
  },
];

let changed = 0;
let drifted = 0;

for (const entry of SHARED_FILES) {
  const sourcePath = join(root, entry.from);
  if (!existsSync(sourcePath)) {
    console.error(`ERROR: sumber kanonik tidak ada: ${entry.from}`);
    process.exit(2);
  }
  const canonical = readFileSync(sourcePath, 'utf8');

  for (const rel of entry.to) {
    const target = join(root, rel);
    const current = existsSync(target) ? readFileSync(target, 'utf8') : null;

    if (current === canonical) {
      console.log(`= sama   ${rel}`);
      continue;
    }

    if (check) {
      drifted += 1;
      console.error(`X BEDA   ${rel} (jalankan: node scripts/sync-shared.mjs)`);
      continue;
    }

    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, canonical, 'utf8');
    changed += 1;
    console.log(`${current === null ? '+ dibuat' : '> disalin'} ${rel}`);
  }
}

if (check) {
  console.log(`\nPemeriksaan salinan bersama: ${drifted === 0 ? 'SEMUA SAMA' : `${drifted} BEDA`}`);
  process.exit(drifted === 0 ? 0 : 1);
}
console.log(`\nSelesai. Salinan diperbarui: ${changed}`);
