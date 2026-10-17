/**
 * test-qr-code.mjs — uji modul bersama kode QR (`shared/qr-code.js`).
 *
 * Modul ini menampilkan **QRIS** (dari `qrString` gateway) di panel Owner.
 * Yang diuji (tanpa browser, tanpa pustaka tambahan):
 *  1. Pustaka vendor termuat & modul melaporkan ketersediaannya.
 *  2. Ukuran matriks konsisten dengan versi QR (21 + 4×(versi−1)).
 *  3. **Quiet zone 4 modul** (syarat EMVCo/QRIS) benar-benar kosong.
 *  4. Pola **finder** (3 sudut) & **timing** sesuai standar QR.
 *  5. **Format information** (15 bit) lolos BCH(15,5) dan tingkat ECC-nya
 *     sesuai yang diminta — memakai penempatan ISO/IEC 18004 §8.9, dihitung
 *     ulang di sini (bukan memakai fungsi pustaka).
 *  6. Determinisme (masukan sama ⇒ SVG sama), panjang/kapasitas, penurunan
 *     ECC M→L untuk isi panjang, dan pesan galat yang jelas.
 *  7. Keluaran SVG/data URL aman: isi QR tidak pernah masuk ke markup.
 *
 * Catatan metode: kebenaran "dapat dipindai" dibuktikan terpisah dengan
 * **decoder independen** (jsQR) di luar repo — 5/5 kasus (termasuk QRIS ~230
 * karakter, versi 10) terbaca identik. Hasilnya dicatat di
 * `docs/38-pembayaran-langganan-gateway.md`. Uji di berkas ini adalah penjaga
 * regresi agar hasilnya tidak rusak di kemudian hari.
 *
 * Jalankan: node --test scripts/test-qr-code.mjs   (atau npm run test:qr)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Pustaka vendor HARUS dimuat lebih dulu: modul bersama mengambilnya dari
// `globalThis.qrcode` (di browser diisi oleh <script src="./src/vendor/...">).
globalThis.qrcode = require('../shared/vendor/qrcode-generator.js');

const { default: NovaQr } = await import(new URL('../shared/qr-code.js', import.meta.url));

/** Contoh isi QRIS (struktur EMVCo: panjang ~230 karakter, seperti aslinya). */
const QRIS =
  '00020101021226610014ID.CO.QRIS.WWW0118ID10200234567890215ID12345678901230303UMI51440014ID.CO.QRIS.WWW0215ID10200234567890303UMI5204541153033605802ID5910TOKO CONTOH6007JAKARTA61051234062070703A016304ABCD';

const FIXED = 'KASIR NOVA';

// --------------------------------------------------------------------------
// 1. Ketersediaan pustaka
// --------------------------------------------------------------------------

test('pustaka vendor termuat: isAvailable() true dan keluaran berbentuk data URL SVG', () => {
  assert.equal(NovaQr.isAvailable(), true);
  const url = NovaQr.toDataUrl(FIXED);
  assert.ok(url.startsWith('data:image/svg+xml;charset=utf-8,'), 'awalan data URL salah');
  const svg = decodeURIComponent(url.slice('data:image/svg+xml;charset=utf-8,'.length));
  assert.ok(svg.startsWith('<svg '), 'markup bukan SVG');
  assert.ok(svg.endsWith('</svg>'), 'SVG tidak ditutup');
});

test('tanpa pustaka vendor: isAvailable() false dan pesan galat jelas (panel tetap aman)', () => {
  const saved = globalThis.qrcode;
  delete globalThis.qrcode;
  try {
    assert.equal(NovaQr.isAvailable(), false);
    assert.throws(() => NovaQr.toDataUrl(FIXED), /belum termuat/i);
  } finally {
    globalThis.qrcode = saved;
  }
  assert.equal(NovaQr.isAvailable(), true);
});

// --------------------------------------------------------------------------
// 2. Ukuran matriks & versi
// --------------------------------------------------------------------------

test('ukuran matriks = 21 + 4×(versi−1) dan versi terkecil dipilih otomatis', () => {
  const pendek = NovaQr.encode('HELLO WORLD');
  assert.equal(pendek.version, 1, 'isi pendek seharusnya versi 1');
  assert.equal(pendek.count, 21);
  assert.equal(pendek.ecc, 'M');

  const qris = NovaQr.encode(QRIS);
  assert.ok(qris.version >= 10, `QRIS ~230 karakter harus versi >= 10 (dapat ${qris.version})`);
  assert.equal(qris.count, 21 + 4 * (qris.version - 1));
  assert.equal(qris.count, qris.qr.getModuleCount());

  // Isi lebih panjang harus memakai versi yang tidak lebih kecil.
  const lebihPanjang = NovaQr.encode('X'.repeat(600));
  assert.ok(lebihPanjang.version > qris.version, 'isi lebih panjang harus menaikkan versi');
});

// --------------------------------------------------------------------------
// 3. Quiet zone (syarat QRIS/EMVCo) & struktur standar
// --------------------------------------------------------------------------

const darkRuns = (qr, count) => {
  let dark = 0;
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) if (qr.isDark(r, c)) dark++;
  }
  return dark;
};

/** Ambil semua koordinat perintah path `M<x> <y>h1v1h-1z` dari SVG. */
const pathPoints = (svg) => {
  const d = svg.match(/<path d="([^"]*)"/);
  assert.ok(d, 'path QR tidak ditemukan di SVG');
  if (!d[1]) return [];
  return [...d[1].matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((m) => [Number(m[1]), Number(m[2])]);
};

test('quiet zone 4 modul benar-benar kosong di empat sisi SVG (syarat QRIS)', () => {
  assert.equal(NovaQr.QUIET_ZONE_MODULES, 4);

  const { qr, count } = NovaQr.encode(QRIS);
  const svg = NovaQr.toSvg(QRIS);
  const viewBox = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  assert.ok(viewBox, 'viewBox tidak ditemukan');
  assert.equal(Number(viewBox[1]), count + 8, 'viewBox harus memuat quiet zone 4 modul per sisi');
  assert.equal(Number(viewBox[2]), count + 8);

  // Matriks = modul QR saja (21 + 4×(versi−1)); quiet zone ada di SVG.
  assert.equal(qr.getModuleCount(), count);

  // Setiap modul gelap digambar pada posisi margin..margin+count-1 (dua sisi).
  const points = pathPoints(svg);
  assert.equal(points.length, darkRuns(qr, count), 'jumlah modul gelap ≠ jumlah perintah path');
  for (const [x, y] of points) {
    assert.ok(x >= 4 && x <= count + 3, `modul gelap di luar area QR (x=${x})`);
    assert.ok(y >= 4 && y <= count + 3, `modul gelap di luar area QR (y=${y})`);
  }

  // Modul pertama (kiri-atas) digambar di (4,4) ⇒ 4 modul sunyi di kiri & atas.
  assert.deepEqual(points[0], [4, 4], 'sudut kiri-atas tidak bergeser 4 modul');
});

test('pola finder (3 sudut) & timing sesuai standar QR', () => {
  const { qr, count } = NovaQr.encode(QRIS);

  // Finder 7×7: cincin luar gelap, cincin dalam terang, inti 3×3 gelap.
  const finderAt = (top, left) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const tepi = r === 0 || r === 6 || c === 0 || c === 6;
        const inti = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        const harusGelap = tepi || inti;
        assert.equal(
          qr.isDark(top + r, left + c),
          harusGelap,
          `finder (${top + r},${left + c}) salah (harus ${harusGelap ? 'gelap' : 'terang'})`
        );
      }
    }
  };
  finderAt(0, 0);
  finderAt(0, count - 7);
  finderAt(count - 7, 0);

  // Timing: baris/kolom ke-6 bergantian gelap-terang mulai modul ke-8.
  for (let i = 8; i < count - 8; i++) {
    const harusGelap = i % 2 === 0;
    assert.equal(qr.isDark(6, i), harusGelap, `timing baris 6 kolom ${i} salah`);
    assert.equal(qr.isDark(i, 6), harusGelap, `timing kolom 6 baris ${i} salah`);
  }
});

test('format information lolos BCH(15,5) dan tingkat ECC sesuai permintaan', () => {
  // BCH(15,5) generator 0x537, XOR mask 0x5412 (ISO/IEC 18004 §8.9).
  const GEN = 0x537;
  const MASK = 0x5412;
  const remainder = (data) => {
    let d = data << 10;
    for (let i = 14; i >= 10; i--) if ((d >>> i) & 1) d ^= GEN << (i - 10);
    return d & 0x3ff;
  };
  const valid = new Map();
  for (let d = 0; d < 32; d++) valid.set(((d << 10) | remainder(d)) ^ MASK, d);
  const eccName = { 0b01: 'L', 0b00: 'M', 0b11: 'Q', 0b10: 'H' };

  // Penempatan 15 bit format di sekitar finder kiri-atas:
  // bit ke-b (b=0..14) -> baris/kolom sesuai daftar di bawah, dikirim MSB lebih
  // dulu sehingga bit ke-b menempati posisi (14 - b).
  const pos = [];
  for (let b = 0; b < 15; b++) {
    if (b < 6) pos.push([8, b]);
    else if (b === 6) pos.push([8, 7]);
    else if (b === 7) pos.push([8, 8]);
    else if (b === 8) pos.push([7, 8]);
    else pos.push([14 - b, 8]);
  }

  for (const ecc of ['M', 'L', 'Q']) {
    const { qr } = NovaQr.encode(QRIS, { ecc });
    let bits = 0;
    for (let b = 0; b < 15; b++) {
      const [row, col] = pos[b];
      if (qr.isDark(row, col)) bits |= 1 << (14 - b);
    }
    const data = valid.get(bits);
    assert.notEqual(data, undefined, `format info tidak sah (ECC ${ecc}): 0b${bits.toString(2)}`);
    assert.equal(eccName[(data >> 3) & 0b11], ecc, `tingkat ECC terbaca bukan ${ecc}`);
  }
});

// --------------------------------------------------------------------------
// 4. Determinisme, kapasitas, dan galat
// --------------------------------------------------------------------------

test('determinisme: masukan sama menghasilkan SVG identik', () => {
  const a = NovaQr.toSvg(QRIS);
  const b = NovaQr.toSvg(QRIS);
  assert.equal(a, b, 'keluaran tidak boleh berubah antar pemanggilan');
  assert.equal(NovaQr.toSvg(QRIS, { margin: 0 }).includes('viewBox="0 0 57 57"'), true);
});

test('isi sangat panjang: ECC turun M→L; terlalu panjang untuk QR: pesan galat jelas', () => {
  const m = NovaQr.encode('A'.repeat(2400)); // melampaui kapasitas ECC M (2331 byte)
  assert.equal(m.ecc, 'L', 'seharusnya turun ke ECC L');
  assert.ok(m.version <= 40, 'versi QR maksimum 40');

  assert.throws(() => NovaQr.encode('B'.repeat(4000)), /terlalu panjang/i);
  assert.throws(() => NovaQr.encode('   '), /kosong/i);
  assert.throws(() => NovaQr.encode(FIXED, { ecc: 'Z' }), /ECC tidak dikenal/i);
});

test('opsi tampilan: margin & warna dapat diatur, isi QR tidak masuk ke markup', () => {
  const svg = NovaQr.toSvg(QRIS, { margin: 0, dark: '#0b3a7a', light: '#ffffff', scale: 2 });
  assert.ok(svg.includes('fill="#0b3a7a"'), 'warna gelap tidak dipakai');
  assert.ok(svg.includes('fill="#ffffff"'), 'warna terang tidak dipakai');
  assert.ok(svg.includes('viewBox="0 0 57 57"'), 'margin 0 tidak diterapkan');
  // Hanya koordinat modul (angka) yang masuk markup — bukan isi QR.
  assert.equal(svg.includes(QRIS.slice(0, 20)), false, 'isi QR bocor ke markup SVG');
  assert.equal(/[<>]/.test(QRIS), false);
});
