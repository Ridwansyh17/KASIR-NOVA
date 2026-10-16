/**
 * test-product-image.mjs — uji Smart Product Image (FASE 2).
 *
 * Menguji modul murni `shared/product-image.js`:
 *  1. Prioritas: unggahan manual > pustaka (nama) > kategori > placeholder.
 *  2. Pencocokan kata kunci/sinonim nama produk.
 *  3. Fallback kategori.
 *  4. Integritas pustaka (semua kunci dipakai sah, SVG valid, data URL unik).
 *  5. Determinisme (hasil sama untuk masukan sama).
 *
 * Jalankan: node --test scripts/test-product-image.mjs   (atau npm run test:image)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { default: Nova } = await import(new URL('../shared/product-image.js', import.meta.url));

const keys = Nova.libraryKeys();

test('prioritas: foto unggahan (manual) selalu menang', () => {
  const manual = 'data:image/jpeg;base64,AAAA';
  const out = Nova.resolveImage({ name: 'Indomie Goreng', photo_url: manual });
  assert.equal(out.source, 'manual');
  assert.equal(out.src, manual);

  // photoUrl (camelCase) juga dikenali.
  assert.equal(Nova.resolveImage({ name: 'Aqua', photoUrl: manual }).source, 'manual');
});

test('prioritas: nama produk dicocokkan ke pustaka internal', () => {
  const cases = [
    ['Aqua 600ml', 'minuman'],
    ['Teh Botol Sosro', 'minuman'],
    ['Indomie Goreng Spesial', 'mie'],
    ['Kopi Kapal Api Sachet', 'kopi'],
    ['Susu Ultra 1 Liter', 'susu'],
    ['Minyak Goreng Sania 2L', 'botol'],
    ['Beras Pandan Wangi 5kg', 'beras'],
    ['Telur Ayam Negeri', 'telur'],
    ['Roti Tawar Sari Roti', 'roti'],
    ['Keripik Chitato Sapi', 'snack'],
    ['Sabun Lifebuoy 85g', 'sabun'],
    ['Rokok Sampoerna Mild', 'rokok'],
    ['Gas Elpiji 3kg', 'gas'],
    ['Pulsa Telkomsel 50rb', 'pulsa'],
    ['Baterai ABC AA', 'elektronik'],
    ['Kaos Polos Hitam', 'pakaian'],
    ['Paracetamol 500mg', 'obat'],
    ['Nasi Goreng Spesial', 'makanan'],
  ];
  for (const [name, expected] of cases) {
    const out = Nova.keyFor(name, '');
    assert.equal(out.key, expected, `"${name}" -> ${out.key} (harap: ${expected})`);
    assert.equal(out.source, 'library');
  }
});

test('pencocokan memakai istilah paling spesifik (bukan awalan kata lain)', () => {
  // "sampoerna" harus menang atas "sampo" walau keduanya awalan sama.
  assert.equal(Nova.keyFor('Rokok Sampoerna', '').key, 'rokok');
  assert.equal(Nova.keyFor('Sampo Lifebuoy', '').key, 'sabun');
});

test('fallback: nama tidak dikenal -> kategori produk', () => {
  const out = Nova.keyFor('Produk XYZ 123', 'Minuman');
  assert.equal(out.key, 'minuman');
  assert.equal(out.source, 'category');

  assert.equal(Nova.keyFor('Barang A', 'Sembako').key, 'beras');
  assert.equal(Nova.keyFor('Barang B', 'Camilan').key, 'snack');
});

test('fallback terakhir: placeholder', () => {
  const out = Nova.resolveImage({ name: 'Produk XYZ 123', category_name: 'Kategori Aneh' });
  assert.equal(out.key, 'placeholder');
  assert.equal(out.source, 'placeholder');

  const empty = Nova.resolveImage({});
  assert.equal(empty.source, 'placeholder');
  assert.equal(empty.key, 'placeholder');
});

test('normalisasi: huruf besar, tanda baca, dan aksen diabaikan', () => {
  assert.equal(Nova.normalize('  Kopi  Susu  '), ' kopi susu ');
  assert.equal(Nova.normalize('Teh-Botol!!'), ' teh botol ');
  assert.equal(Nova.keyFor('AQUA (600 ML)', '').key, 'minuman');
});

test('pustaka: SVG valid, data URL unik, dan semua kunci aturan tersedia', () => {
  assert.ok(keys.length >= 15, `pustaka terlalu kecil: ${keys.length}`);

  const urls = new Set();
  for (const key of keys) {
    const svg = Nova.svgFor(key);
    assert.match(svg, /^<svg [^>]*viewBox="0 0 24 24"/, `SVG tidak valid: ${key}`);
    assert.match(svg, /<\/svg>$/, `SVG tidak tertutup: ${key}`);

    const url = Nova.dataUrlFor(key);
    assert.ok(url.startsWith('data:image/svg+xml'), `bukan data URL SVG: ${key}`);
    assert.ok(decodeURIComponent(url).includes('<svg'), `data URL rusak: ${key}`);
    assert.ok(!urls.has(url), `data URL duplikat: ${key}`);
    urls.add(url);
  }

  // Setiap kunci gambar yang dirujuk aturan harus ada di pustaka, dan setiap
  // aturan harus punya kata kunci yang tidak kosong.
  const rules = [...Nova.nameRules, ...Nova.categoryRules];
  for (const [key, words] of rules) {
    assert.ok(keys.includes(key), `kunci aturan tidak ada di pustaka: ${key}`);
    assert.ok(Array.isArray(words) && words.length > 0, `aturan tanpa kata kunci: ${key}`);
    for (const w of words) {
      assert.equal(Nova.normalize(w), ` ${w} `, `kata kunci tidak ternormalisasi: "${w}"`);
    }
  }
});

test('renderThumb: atribut di-escape dan sumber dilaporkan', () => {
  const html = Nova.renderThumb({ name: 'Teh "Manis" <besar>', photo_url: '' });
  assert.ok(html.startsWith('<img '), html);
  assert.ok(html.includes('data-img-source="library"'), html);
  assert.ok(!html.includes('"Manis"'), 'kutip ganda pada alt tidak di-escape');
  assert.ok(html.includes('&quot;Manis&quot;'), html);
  assert.ok(html.includes('&lt;besar&gt;'), html);
});

test('determinisme: masukan sama -> hasil sama', () => {
  const a = Nova.resolveImage({ name: 'Aqua 600ml', category_name: 'Minuman' });
  const b = Nova.resolveImage({ name: 'Aqua 600ml', category_name: 'Minuman' });
  assert.deepEqual(a, b);
  assert.equal(Nova.dataUrlFor('minuman'), Nova.dataUrlFor('minuman'));
});
