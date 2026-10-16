/**
 * KASIR NOVA — Smart Product Image (FASE 2)
 * =============================================================================
 * Menentukan gambar produk secara otomatis dengan urutan prioritas:
 *
 *   1. `manual`      — foto yang diunggah pemilik/kasir (data URL di kolom
 *                      `products.photo_url`; perilaku lama tidak berubah).
 *   2. `library`     — pustaka internal KASIR NOVA, dipilih dari **nama produk**
 *                      lewat pencocokan kata kunci/sinonim (mis. "aqua" ->
 *                      botol, "indomie" -> mie instan).
 *   3. `category`    — gambar berdasarkan **nama kategori** produk.
 *   4. `placeholder` — gambar generik bila tidak ada yang cocok.
 *
 * Catatan penting:
 *  - Pustaka gambar di sini adalah **SVG buatan sendiri** (bentuk geometris
 *    sederhana): lisensinya jelas, bukan hasil mengambil gambar dari Google
 *    Images atau sumber tanpa lisensi. Pemilik dapat menambah/mengganti gambar
 *    pustaka tanpa mengubah logika pemilihan.
 *  - Gambar dikembalikan sebagai **data URL SVG**, sehingga semua pemakaian
 *    cukup `<img src="...">` — sama seperti foto unggahan (data URL base64).
 *  - Modul ini murni (tidak menyentuh DOM), jadi bisa diuji di Node.
 *
 * Berkas ini adalah **sumber kanonik**. Salinannya ada di
 * `apps/{owner,kasir}/src/product-image.js` dan dijaga agar identik oleh
 * `scripts/verify-ui.mjs`. Jalankan `node scripts/sync-shared.mjs` setelah
 * mengubah berkas ini.
 *
 * Format: UMD — di browser memasang `window.NovaProductImage`; di Node
 * mengembalikan lewat `module.exports`.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NovaProductImage = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function () {
  /* ---------------------------------------------------------------- Pustaka --
   * 18 gambar sederhana (viewBox 24x24) memakai warna brand V2:
   * navy #042650 (garis), biru #0072F6 (aksen), latar lembut #EEF3FA.        */
  const GLYPHS = {
    placeholder:
      '<rect x="5.5" y="5.5" width="13" height="13" rx="2"/>' +
      '<path d="M8.4 15.2l2.7-3.1 2.2 2.4 1.6-1.9 2.3 2.6"/>' +
      '<circle cx="10.1" cy="9.7" r="1.2"/>',
    minuman:
      '<path d="M7 8h10l-1.2 10.4a1.6 1.6 0 0 1-1.6 1.4H9.8A1.6 1.6 0 0 1 8.2 18.4z"/>' +
      '<path d="M13.7 4.3l3.1 1.5"/><path d="M6.6 11.6h10.8"/>',
    botol:
      '<path d="M10.2 4h3.6v2.3c0 .8.4 1.5 1 1.9l.6.5c.7.4 1.1 1.2 1.1 2v8.4a1.6 1.6 0 0 1-1.6 1.6H9.7a1.6 1.6 0 0 1-1.6-1.6v-8.4c0-.8.4-1.6 1.1-2l.6-.5c.6-.4 1-1.1 1-1.9z"/>' +
      '<path d="M8.1 13.6h8.4"/>',
    kopi:
      '<path d="M6 9.5h11v4.2a4.3 4.3 0 0 1-4.3 4.3h-2.4A4.3 4.3 0 0 1 6 13.7z"/>' +
      '<path d="M17 10.7h1.4a1.9 1.9 0 0 1 0 3.8H17"/>' +
      '<path d="M8.4 4.6v1.9M11.6 4.2v2.3M14.8 4.6v1.9"/>',
    susu:
      '<path d="M8.6 9.2 11.2 6h4v13H8.6z"/><path d="M8.6 9.2h6.6"/>' +
      '<path d="M11.2 6v3.2"/>',
    makanan:
      '<path d="M4.6 12.6h14.8a7.4 7.4 0 0 1-14.8 0z"/>' +
      '<path d="M9.2 4.4v2.2M12 3.8v2.6M14.8 4.4v1.9"/>',
    mie:
      '<rect x="6" y="5.5" width="12" height="13" rx="2"/>' +
      '<path d="M9 8.8c1-.8 2.1-.8 3.1 0s2 .8 3 0M9 11.8c1-.8 2.1-.8 3.1 0s2 .8 3 0M9 14.8c1-.8 2.1-.8 3.1 0s2 .8 3 0"/>',
    snack:
      '<path d="M8.2 8.4h7.6l-1 9.6a1.6 1.6 0 0 1-1.6 1.4h-2.4a1.6 1.6 0 0 1-1.6-1.4z"/>' +
      '<path d="M9 7.1c0-1 .9-1.8 2-1.8h2c1.1 0 2 .8 2 1.8"/><path d="M9.6 12.4h4.8"/>',
    beras:
      '<path d="M8.3 6.2c0-1.1 1.6-1.9 3.7-1.9s3.7.8 3.7 1.9"/>' +
      '<path d="M8.3 6.2c-1.1 3.9-1.1 8.9.7 13.1h6c1.8-4.2 1.8-9.2.7-13.1z"/>' +
      '<path d="M9.9 12h4.2"/>',
    telur: '<ellipse cx="9.4" cy="12.6" rx="3.1" ry="4.2"/><ellipse cx="15" cy="13.7" rx="2.8" ry="3.8"/>',
    roti:
      '<path d="M6.2 12.4c0-3.2 2.6-5.4 5.8-5.4s5.8 2.2 5.8 5.4v3a2.9 2.9 0 0 1-2.9 2.9H9.1a2.9 2.9 0 0 1-2.9-2.9z"/>' +
      '<path d="M9.4 9.6l.9.9M12.4 8.9l.9.9M15.3 9.8l.9.9"/>',
    rokok:
      '<rect x="6.2" y="8.2" width="11.6" height="9.6" rx="1.6"/><path d="M6.2 11.4h11.6"/>' +
      '<path d="M15.6 5.6c1.3.6 1.3 2.1 0 2.7"/>',
    sabun:
      '<rect x="6.6" y="9.4" width="10.8" height="9.4" rx="2.4"/><path d="M9.4 13.4h5.2"/>' +
      '<path d="M11.2 9.4V6.6h3.4"/>',
    obat:
      '<rect x="5.4" y="9.2" width="13.2" height="5.8" rx="2.9"/><path d="M12 9.2v5.8"/>' +
      '<path d="M8.4 6.6h7.2"/>',
    gas:
      '<rect x="8.1" y="7.2" width="7.8" height="11.8" rx="2.9"/><path d="M10.6 7.2V5.5h2.8v1.7"/>' +
      '<path d="M8.1 12.2h7.8"/>',
    pulsa: '<rect x="7.6" y="4.6" width="8.8" height="14.8" rx="2"/><path d="M10.9 17.2h2.2"/>',
    pakaian:
      '<path d="M9.2 5.4 6.1 7l-1.3 3.2 2.3 1V19h9.8v-7.8l2.3-1L17.9 7l-3.1-1.6a2.8 2.8 0 0 1-5.6 0z"/>',
    elektronik:
      '<rect x="5.4" y="5.8" width="13.2" height="9.2" rx="1.8"/><path d="M9 19h6M12 15v4"/>',
    lainnya:
      '<path d="M12.4 4.6H19v6.6l-8.1 8.1-6.6-6.6z"/><circle cx="15.9" cy="7.7" r="1.2"/>',
  };

  const svgFor = (key) =>
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" role="img" aria-hidden="true">' +
    '<rect width="24" height="24" rx="4" fill="#EEF3FA"/>' +
    '<g fill="none" stroke="#042650" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
    (GLYPHS[key] ?? GLYPHS.placeholder) +
    "</g></svg>";

  const dataUrlCache = new Map();
  const dataUrlFor = (key) => {
    const k = GLYPHS[key] ? key : "placeholder";
    if (!dataUrlCache.has(k)) {
      dataUrlCache.set(k, "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgFor(k)));
    }
    return dataUrlCache.get(k);
  };

  /* ------------------------------------------------------------ Pencocokan --
   * Aturan nama produk (spesifik -> umum). Pencocokan memakai bobot panjang
   * kata kunci sehingga istilah paling spesifik menang.                      */
  const NAME_RULES = [
    ["kopi", ["kopi", "coffee", "latte", "cappuccino", "espresso", "kapucino", "mocca", "moka", "nescafe", "good day", "kapal api", "abc"]],
    ["susu", ["susu", "milk", "uht", "kental manis", "skm", "yogurt", "yoghurt", "keju", "mentega", "milo", "dancow", "ultra", "bear brand", "oval tine"]],
    ["mie", ["mie", "indomie", "sarimi", "sedaap", "ramen", "noodle", "bihun", "kwetiau", "yamin", "pop mie"]],
    ["gas", ["gas", "elpiji", "lpg", "bright gas", "tabung gas"]],
    ["rokok", ["rokok", "sigaret", "sampoerna", "gudang garam", "djarum", "marlboro", "dji sam soe", "magnum", "esse", "surya"]],
    ["obat", ["obat", "vitamin", "paracetamol", "panadol", "bodrex", "promag", "tolak angin", "antangin", "oralit", "plester", "betadine", "hansaplast", "mixagrip"]],
    ["pulsa", ["pulsa", "kuota", "voucher", "paket data", "token listrik", "token pln"]],
    ["elektronik", ["elektronik", "baterai", "battery", "lampu", "kabel", "charger", "headset", "earphone", "powerbank", "senter", "stop kontak", "dispenser"]],
    ["sabun", ["sabun", "sampo", "shampoo", "pasta gigi", "odol", "deterjen", "detergen", "pewangi", "pembersih", "tisu", "pampers", "pembalut", "hand sanitizer"]],
    ["pakaian", ["pakaian", "baju", "kaos", "kemeja", "celana", "sarung", "jilbab", "hijab", "jaket", "topi", "kaus kaki"]],
    ["botol", ["minyak", "minyak goreng", "kecap", "saus", "saos", "sambal", "cuka", "sirup", "sirop", "madu", "air kelapa"]],
    ["beras", ["beras", "gula", "tepung", "terigu", "sembako", "bawang", "cabai", "cabe", "garam", "kemiri", "santan"]],
    ["telur", ["telur", "egg"]],
    ["roti", ["roti", "bread", "burger", "donat", "kue", "cake", "bolu", "puding"]],
    ["snack", ["snack", "keripik", "kerupuk", "chiki", "wafer", "biskuit", "coklat", "cokelat", "permen", "kacang", "marshmallow", "taro", "chitato", "oreo", "stik"]],
    ["makanan", ["makanan", "nasi", "lauk", "soto", "bakso", "ayam", "gorengan", "bubur", "sate", "sosis", "nugget", "kornet", "ikan", "tempe", "tahu", "sayur", "kentang"]],
    ["minuman", ["minuman", "air", "aqua", "teh", "jus", "juice", "soda", "cola", "coca", "fanta", "sprite", "mineral", "pocari", "isotonik", "ale ale", "frutang", "pulpy", "buavita"]],
  ];

  /** Aturan nama kategori (dipakai bila nama produk tidak cocok). */
  const CATEGORY_RULES = [
    ["minuman", ["minuman", "minum", "drink", "beverage", "teh", "kopi", "susu", "jus"]],
    ["makanan", ["makanan", "makan", "food", "lauk", "nasi", "kuliner", "warung"]],
    ["snack", ["snack", "camilan", "cemilan", "jajanan", "kue", "keripik"]],
    ["beras", ["sembako", "beras", "gula", "tepung", "bahan pokok", "pokok", "dapur"]],
    ["rokok", ["rokok", "tembakau", "sigaret"]],
    ["obat", ["obat", "apotek", "farmasi", "kesehatan"]],
    ["sabun", ["kebersihan", "perawatan", "toiletries", "perawatan diri", "mandi"]],
    ["gas", ["gas", "elpiji", "lpg"]],
    ["pulsa", ["pulsa", "kuota", "voucher", "digital", "token"]],
    ["pakaian", ["pakaian", "baju", "sandang", "fashion", "tekstil"]],
    ["elektronik", ["elektronik", "aksesoris", "gadget", "listrik", "peralatan"]],
    ["lainnya", ["lainnya", "lain lain", "umum", "other", "lain"]],
  ];

  /** Normalisasi: huruf kecil, tanpa aksen, hanya a-z/0-9, spasi tunggal. */
  const normalize = (value) =>
    " " +
    String(value ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() +
    " ";

  /** Kunci gambar dengan kata kunci terpanjang yang cocok (paling spesifik). */
  const bestMatch = (text, rules) => {
    let bestKey = null;
    let bestScore = 0;
    for (const [key, words] of rules) {
      for (const word of words) {
        if (text.includes(" " + word + " ") && word.length > bestScore) {
          bestScore = word.length;
          bestKey = key;
        }
      }
    }
    return bestKey;
  };

  /** Tentukan kunci gambar + sumbernya untuk nama produk & nama kategori. */
  const keyFor = (name, categoryName) => {
    const byName = bestMatch(normalize(name), NAME_RULES);
    if (byName) return { key: byName, source: "library" };
    const byCategory = bestMatch(normalize(categoryName), CATEGORY_RULES);
    if (byCategory) return { key: byCategory, source: "category" };
    return { key: "placeholder", source: "placeholder" };
  };

  const manualOf = (product) => {
    const value = product?.photo_url ?? product?.photoUrl ?? "";
    return typeof value === "string" && value.trim() ? value.trim() : "";
  };

  /**
   * Gambar final untuk sebuah produk.
   * @returns {{src:string, source:'manual'|'library'|'category'|'placeholder', key:string}}
   */
  const resolveImage = (product) => {
    const manual = manualOf(product);
    if (manual) return { src: manual, source: "manual", key: "manual" };
    const { key, source } = keyFor(product?.name, product?.category_name ?? product?.categoryName);
    return { src: dataUrlFor(key), source, key };
  };

  /** Saran gambar otomatis untuk form produk (tanpa memandang foto unggahan). */
  const suggestImage = (name, categoryName) => {
    const { key, source } = keyFor(name, categoryName);
    return { src: dataUrlFor(key), source, key };
  };

  const escapeAttr = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  /** HTML `<img>` siap pakai (semua atribut di-escape). */
  const renderThumb = (product, options = {}) => {
    const { className = "product-photo", alt = product?.name ?? "", extra = "" } = options;
    const image = resolveImage(product);
    return (
      `<img class="${escapeAttr(className)}" src="${escapeAttr(image.src)}"` +
      ` alt="${escapeAttr(alt)}" loading="lazy" data-img-source="${escapeAttr(image.source)}"` +
      (extra ? " " + extra : "") +
      " />"
    );
  };

  return {
    resolveImage,
    suggestImage,
    renderThumb,
    normalize,
    keyFor,
    svgFor,
    dataUrlFor,
    escapeAttr,
    /** Daftar kunci pustaka internal (untuk dokumentasi/uji). */
    libraryKeys: () => Object.keys(GLYPHS),
    nameRules: NAME_RULES,
    categoryRules: CATEGORY_RULES,
  };
});
