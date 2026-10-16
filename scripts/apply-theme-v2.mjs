/**
 * apply-theme-v2.mjs — FASE 1 (Desain V2): migrasi token tema gelap -> tema
 * terang + topbar navy pada tiga panel (admin, owner, kasir).
 *
 * Sifat:
 *  - IDEMPOTEN: bila token V2 sudah ada, berkas dilewati.
 *  - Nama variabel LAMA (--bg, --card, --text, --primary, ...) dipertahankan
 *    agar seluruh aturan CSS yang ada tetap bekerja; hanya nilainya dipetakan
 *    ke tema terang.
 *  - Warna literal yang tersisa diganti variabel token.
 *  - Satu "lapisan identitas" ditambahkan di akhir berkas untuk komponen yang
 *    bergantung struktur (body, .auth, .topbar, .tab).
 *
 * Sumber warna: ekstraksi programatik aset brand V2 (lihat docs/27-desain-v2-token.md).
 *
 * Jalankan: node scripts/apply-theme-v2.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";

const FILES = [
  "apps/admin/styles/styles.css",
  "apps/owner/styles/styles.css",
  "apps/kasir/styles/styles.css",
];

const ROOT_BLOCK = `:root {
  /* ======================================================================
     KASIR NOVA V2 — Token desain (FASE 1, 16 Okt 2026)
     ----------------------------------------------------------------------
     Warna terukur dari aset brand V2 (ekstraksi programatik):
       navy sidebar / guideline .... #062A66 / #042650
       aksen biru utama ............ #0072F6  (tua #0050D2, terang #1BA4FE)
       latar konten (tema TERANG) .. #F7FAFD / #FFFFFF
     Nama variabel lama DIPERTAHANKAN agar semua aturan CSS yang ada tetap
     valid; nilainya dipetakan dari tema gelap ke tema terang.
     ====================================================================== */

  /* --- Skala brand --- */
  --navy-900: #02102b;
  --navy-800: #042650;
  --navy-700: #062a66;
  --navy-600: #0a3678;
  --blue-600: #0050d2;
  --blue-500: #0072f6;
  --blue-400: #1ba4fe;
  --blue-100: #e6effe;

  /* --- Permukaan & teks (tema terang) --- */
  --bg: #f4f7fc;
  --card: #ffffff;
  --card-2: #f2f6fc;
  --card-3: #e8eef8;
  --input-bg: #ffffff;
  --text: #0b1b33;
  --text-invert: #ffffff;
  --muted: #5b6b85;
  --border: #e0e7f2;
  --border-strong: #c9d6e8;

  /* --- Aksen & status --- */
  --primary: var(--blue-500);
  --primary-dark: var(--blue-600);
  --primary-tint: rgba(0, 114, 246, 0.10);
  --focus-ring: rgba(0, 114, 246, 0.28);
  --danger: #d64545;
  --danger-tint: rgba(214, 69, 69, 0.10);
  --danger-border: rgba(214, 69, 69, 0.35);
  --ok-fg: #0e8f63;
  --ok-bg: rgba(14, 143, 99, 0.12);
  --ok-border: rgba(14, 143, 99, 0.35);
  --off-fg: #c2453f;
  --off-bg: rgba(214, 69, 69, 0.10);

  /* --- Topbar / permukaan navy --- */
  --sidebar: var(--navy-700);
  --sidebar-2: var(--navy-800);
  --sidebar-fg: #dbe6f7;
  --sidebar-muted: #9db3d4;
  --sidebar-active: rgba(255, 255, 255, 0.14);
  --sidebar-border: rgba(255, 255, 255, 0.14);

  /* --- Overlay & bayangan --- */
  --overlay: rgba(2, 16, 43, 0.55);
  --shadow-sm: 0 1px 2px rgba(11, 27, 51, 0.06), 0 1px 3px rgba(11, 27, 51, 0.05);
  --shadow: 0 6px 20px rgba(11, 27, 51, 0.08);
  --shadow-lg: 0 18px 44px rgba(11, 27, 51, 0.18);
}`;

/** [regex, pengganti, label] — warna literal lama -> token tema terang. */
const REPLACEMENTS = [
  [/background: #0a1428;/g, "background: var(--input-bg);", "input-bg"],
  [/background: #0f1f3d;/g, "background: var(--card-2);", "card-2"],
  [/background: #14284c;/g, "background: var(--card-3);", "card-3"],
  [/color: #fff;/g, "color: var(--text-invert);", "text-invert"],
  [/background: rgba\(0, 180, 255, 0\.1\);/g, "background: var(--primary-tint);", "primary-tint"],
  [/background: rgba\(2, 6, 15, 0\.72\);/g, "background: var(--overlay);", "overlay"],
  [/background: rgba\(255, 123, 123, 0\.12\);/g, "background: var(--danger-tint);", "danger-tint"],
  [/border-color: rgba\(255, 123, 123, 0\.(?:35|4)\);/g, "border-color: var(--danger-border);", "danger-border"],
  [/border-color: rgba\(64, 224, 160, 0\.4\);/g, "border-color: var(--ok-border);", "ok-border"],
  [/box-shadow: 0 14px 34px rgba\(0, 0, 0, 0\.5\);/g, "box-shadow: var(--shadow-lg);", "shadow-lg"],
  [/box-shadow: 0 4px 12px rgba\(0, 0, 0, 0\.4\);/g, "box-shadow: var(--shadow-sm);", "shadow-sm"],
  [/box-shadow: 0 -2px 10px rgba\(0, 0, 0, 0\.35\);/g, "box-shadow: 0 -2px 10px rgba(11, 27, 51, 0.10);", "tab-shadow"],
  [/box-shadow: 0 0 0 3px rgba\(0, 180, 255, 0\.22\);/g, "box-shadow: 0 0 0 3px var(--focus-ring);", "focus-ring"],
];

/** Lapisan identitas V2: komponen yang bergantung struktur, bukan warna token. */
const LAYER = `
/* ==========================================================================
   KASIR NOVA V2 — Lapisan identitas visual (FASE 1)
   Ditambahkan 16 Okt 2026. Menimpa bagian tema gelap lama yang bergantung
   pada struktur (bukan sekadar warna token): latar halaman, topbar navy,
   layar login, dan tab. Dipisahkan agar mudah ditinjau/di-revert.
   ========================================================================== */

/* --- Latar halaman: terang + pendar biru tipis --- */
body {
  background: var(--bg);
  background-image: radial-gradient(
    1100px 600px at 50% -140px,
    rgba(0, 114, 246, 0.06),
    transparent 65%
  );
}

/* --- Topbar navy (identitas brand V2) --- */
.topbar {
  background: linear-gradient(180deg, var(--sidebar) 0%, var(--sidebar-2) 100%);
  border-bottom: 1px solid var(--sidebar-border);
  color: var(--sidebar-fg);
}

.topbar .brand,
.topbar span {
  color: var(--sidebar-fg);
}

.topbar .muted,
.topbar small {
  color: var(--sidebar-muted);
}

.topbar .brand-logo {
  box-shadow: none;
  border-radius: 8px;
}

.topbar .btn {
  background: rgba(255, 255, 255, 0.12);
  border-color: var(--sidebar-border);
  color: var(--text-invert);
}

.topbar .btn:hover {
  background: rgba(255, 255, 255, 0.22);
}

/* --- Login: latar navy, kartu putih --- */
.auth {
  background:
    radial-gradient(1000px 560px at 50% -120px, rgba(27, 164, 254, 0.32), transparent 62%),
    linear-gradient(180deg, var(--navy-800) 0%, var(--navy-900) 100%);
}

.auth-card {
  box-shadow: var(--shadow-lg);
}

.brand-logo-lg {
  box-shadow: none;
}

/* --- Tab: gaya terang --- */
.tab:hover {
  background: var(--card-2);
}

.tab.active {
  box-shadow: var(--shadow-sm);
}
`;

let changed = 0;
for (const file of FILES) {
  let css = readFileSync(file, "utf8");

  if (css.includes("--navy-700")) {
    console.log(`[skip] ${file} — token V2 sudah ada`);
    continue;
  }

  const before = css;

  // 1) Ganti blok :root (aman terhadap isi komentar ber-encoding apa pun).
  const rootRe = /:root \{[\s\S]*?--shadow: 0 10px 34px rgba\(0, 0, 0, 0\.45\);\s*\}/;
  if (!rootRe.test(css)) throw new Error(`[${file}] blok :root lama tidak ditemukan`);
  css = css.replace(rootRe, ROOT_BLOCK);

  // 2) Ganti warna literal -> token; laporkan tiap hitungan.
  const counts = [];
  for (const [re, rep, label] of REPLACEMENTS) {
    const hits = css.match(re)?.length ?? 0;
    if (hits > 0) {
      css = css.replace(re, rep);
      counts.push(`${label}=${hits}`);
    }
  }

  // 3) Tambahkan lapisan identitas V2.
  css = css.trimEnd() + "\n" + LAYER;

  if (css === before) throw new Error(`[${file}] tidak ada perubahan`);
  writeFileSync(file, css, "utf8");
  changed += 1;
  console.log(`[ok] ${file} — token diganti; literal: ${counts.join(", ") || "tidak ada"}`);
}

console.log(`\nSelesai. Berkas diubah: ${changed}/${FILES.length}`);
