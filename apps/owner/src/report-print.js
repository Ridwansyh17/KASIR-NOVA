/**
 * Halaman cetak "Laporan Transaksi" (Owner) — 17 Okt 2026.
 *
 * Modul ini **murni** (hanya menyusun string HTML, tanpa DOM) agar dapat diuji
 * langsung di Node — pola yang sama dengan `apps/kasir/src/receipt.js`.
 *
 * ## Mengapa penomoran halaman dibuat manual?
 *
 * Peramban memenggal halaman cetak sendiri, tetapi **CSS paged media tidak
 * menyediakan nomor halaman** yang bisa dipakai di dalam aliran dokumen
 * (`@page … content: counter(page)` tidak didukung Chrome). Karena itu laporan
 * dibagi menjadi **beberapa halaman eksplisit** (satu `<div class="pr-page">`
 * per halaman, dipisah `break-before: page`) sehingga setiap halaman dapat
 * menulis footer-nya sendiri: **"Halaman i dari N"**.
 *
 * ## Kapasitas baris per halaman
 *
 * Kapasitas diambil dari pengukuran nyata (Chrome headless `--print-to-pdf`,
 * lihat `scripts/print-report-check.mjs` + `docs/35` §5c), bukan dugaan:
 * A4 (297 mm) − margin 12 mm atas/bawah = 273 mm area cetak, tetapi baris tabel
 * ini sering terlipat menjadi dua baris karena tabelnya memuat 10 kolom.
 * Hasil ukur pada data uji yang memuat nama produk panjang:
 * halaman pertama ≈ 24 baris, halaman lanjutan ≈ 29 baris, dan blok bawah
 * (Ringkasan + Produk Terlaris + Catatan) ≈ 5 baris.
 *
 * Nilai yang dipakai di bawah **sudah dikurangi** dari batas ukur itu sebagai
 * margin aman, supaya laporan dengan nama produk lebih panjang tetap muat:
 * halaman yang belum penuh itu wajar, sedangkan isi yang terpotong tidak.
 * `scripts/print-report-check.mjs` membuktikan bahwa jumlah halaman PDF = jumlah
 * halaman yang direncanakan untuk 0…400 baris (tanpa halaman meluber/kosong).
 *
 * Semua nominal diterima dalam **SEN** dan diformat oleh `fmt` (dependensi
 * disuntikkan) supaya format angka tetap satu sumber dengan panel Owner.
 */

/**
 * Kapasitas & tata letak paginasi (satuan: baris tabel).
 *
 * @typedef {object} PrintLayout
 * @property {number} rowsFirstPage  Baris pada halaman 1 (ada kop + info + KPI).
 * @property {number} rowsNextPage   Baris pada halaman lanjutan (kop ringkas).
 * @property {number} tailRows       Perkiraan tinggi blok bawah dalam "satuan baris"
 *                                   (Ringkasan Penjualan + Produk Terlaris + Catatan).
 */
export const PRINT_LAYOUT = {
  rowsFirstPage: 21,
  rowsNextPage: 26,
  tailRows: 5,
};

/**
 * Bagi baris laporan menjadi halaman-halaman cetak.
 *
 * Aturan:
 *   - Halaman 1 memakai `rowsFirstPage`, halaman berikutnya `rowsNextPage`.
 *   - Blok bawah (Ringkasan/Produk Terlaris/Catatan) menempel pada halaman
 *     terakhir **bila masih ada ruang**; bila tidak, dibuatkan halaman sendiri
 *     supaya tidak terpotong.
 *   - Laporan tanpa transaksi tetap menghasilkan **satu** halaman.
 *
 * @param {Array<object>} rows
 * @param {PrintLayout} [layout]
 * @returns {{total: number, sheets: Array<{page:number, kind:'first'|'next', rows:Array<object>, withTail:boolean, startIndex:number}>}}
 */
export const planPrintPages = (rows, layout = PRINT_LAYOUT) => {
  const list = Array.isArray(rows) ? rows : [];
  // Kapasitas halaman (dinormalkan): kapasitas 0/negatif akan membuat
  // perulangan tanpa akhir, jadi diperlakukan sebagai 1 baris per halaman.
  const capacityOf = (index) => {
    const raw = index === 0 ? layout.rowsFirstPage : layout.rowsNextPage;
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1;
  };

  const chunks = [];
  let i = 0;
  while (i < list.length) {
    const capacity = capacityOf(chunks.length);
    chunks.push(list.slice(i, i + capacity));
    i += capacity;
  }
  if (chunks.length === 0) chunks.push([]);

  // Blok bawah (Ringkasan/Produk Terlaris/Catatan) menempel pada halaman
  // terakhir **bila masih ada ruang menurut kapasitas halaman itu** (halaman 1
  // punya kop+info+KPI sehingga kapasitasnya berbeda dari halaman lanjutan);
  // bila tidak, dibuatkan halaman sendiri supaya tidak pernah terpotong.
  const last = chunks.length - 1;
  const tailFits = chunks[last].length + layout.tailRows <= capacityOf(last);
  if (!tailFits) chunks.push([]);

  let next = 0;
  const sheets = chunks.map((sheetRows, index) => {
    const sheet = {
      page: index + 1,
      kind: index === 0 ? 'first' : 'next',
      rows: sheetRows,
      withTail: index === chunks.length - 1,
      startIndex: next,
    };
    next += sheetRows.length;
    return sheet;
  });

  return { total: sheets.length, sheets };
};

/** Label nomor halaman: 'Halaman 1 dari 3'. */
export const pageLabel = (page, total) => `Halaman ${page} dari ${total}`;

/**
 * Label status transaksi untuk blok "Ringkasan Penjualan".
 *
 * Sebelumnya panel memakai `STATUS_LABELS` yang **tidak pernah didefinisikan**,
 * sehingga mencetak laporan dengan filter `status=voided`/`refunded` gagal
 * (`ReferenceError`). Sekarang labelnya hidup di sini dan diuji.
 */
export const PRINT_STATUS_LABELS = {
  completed: 'Selesai',
  voided: 'Dibatalkan',
  refunded: 'Refund',
};

/**
 * Bangun HTML halaman cetak dari data server (semua nilai di-escape).
 *
 * @param {object} data hasil `GET /reports/transactions`
 * @param {{
 *   escape: (value: unknown) => string,
 *   idr: (sen: number) => string,
 *   periode: (from: string, to: string) => string,
 *   cetak: (iso: string, timezone?: string) => string,
 *   tanggalJam: (date: string, time: string) => string,
 *   metode: (list?: string[]) => string,
 *   status: (key: string) => string,
 * }} fmt
 * @param {PrintLayout} [layout] kapasitas paginasi (dapat diubah untuk pengujian)
 * @returns {string}
 */
export const renderPrintReport = (data, fmt, layout = PRINT_LAYOUT) => {
  const s = data.summary;
  const periode = fmt.periode(data.period.from, data.period.to);
  const outletLabel = data.outlet?.name ?? 'Semua outlet';
  const kasirLabel = data.cashier?.name ?? 'Semua kasir yang bertugas';
  const dicetak = fmt.cetak(data.printed_at, data.business.timezone);
  const plan = planPrintPages(data.rows, layout);

  // Kartu KPI: total transaksi, total penjualan, tiap metode, lalu rata-rata.
  const kpi = [
    { label: 'Total Transaksi', value: String(s.transactions), sub: 'Transaksi' },
    { label: 'Total Penjualan', value: fmt.idr(s.total), sub: '' },
    ...data.payment_methods.map((m) => ({
      label: m.label,
      value: fmt.idr(m.total),
      sub: `(${m.percent}%)`,
    })),
    { label: 'Rata-rata Transaksi', value: fmt.idr(s.avg_total), sub: 'transaksi' },
  ];

  const peringatan = data.truncated
    ? `<p class="pr-warn">Perhatian: laporan dipotong pada ${data.rows.length} baris pertama.
       Persempit rentang tanggal atau pilih satu outlet agar seluruh baris tercetak.</p>`
    : '';

  const metodeRingkas = data.payment_methods.length
    ? data.payment_methods
        .map(
          (m) => `<div class="pr-line"><span>${fmt.escape(m.label)}</span>
            <strong>${fmt.escape(fmt.idr(m.total))} <small>(${m.percent}%)</small></strong></div>`
        )
        .join('')
    : '<div class="pr-line"><span>Belum ada pembayaran lunas</span></div>';

  const produkHtml = data.top_products.length
    ? data.top_products
        .map(
          (p) => `<tr><td>${fmt.escape(p.product_name)}</td>
            <td class="pr-right">${fmt.escape(p.qty)}</td>
            <td class="pr-right">${fmt.escape(fmt.idr(p.revenue))}</td></tr>`
        )
        .join('')
    : '<tr><td colspan="3" class="pr-empty">Belum ada produk terjual.</td></tr>';

  const voidInfo =
    s.voided_transactions || s.refunded_transactions
      ? `<div class="pr-line"><span>Dibatalkan (void)</span>
           <strong>${fmt.escape(fmt.idr(s.voided_total))}
           <small>${s.voided_transactions} transaksi</small></strong></div>
         <div class="pr-line"><span>Refund</span>
           <strong>${fmt.escape(fmt.idr(s.refunded_total))}
           <small>${s.refunded_transactions} transaksi</small></strong></div>`
      : '';

  /** Baris tabel detail (nomor menerus antar halaman). */
  const rowsHtml = (sheet) =>
    data.rows.length
      ? sheet.rows
          .map((r, i) => {
            const no = sheet.startIndex + i + 1;
            return `<tr>
            <td class="pr-num">${no}</td>
            <td class="pr-mono">${fmt.escape(r.invoice_no)}</td>
            <td>${fmt.escape(fmt.tanggalJam(r.date, r.time))}</td>
            <td>${fmt.escape(r.product_name)}</td>
            <td class="pr-right">${fmt.escape(r.qty)}</td>
            <td class="pr-right">${fmt.escape(fmt.idr(r.unit_price))}</td>
            <td class="pr-right pr-strong">${fmt.escape(fmt.idr(r.line_total))}</td>
            <td>${fmt.escape(fmt.metode(r.methods))}</td>
            <td>${fmt.escape(r.cashier_name ?? '—')}</td>
            <td>${fmt.escape(r.outlet_name ?? outletLabel)}</td>
          </tr>`;
          })
          .join('')
      : '<tr><td colspan="10" class="pr-empty">Belum ada transaksi pada rentang ini.</td></tr>';

  /** Kop lengkap (hanya halaman pertama). */
  const headFull = `
      <header class="pr-head">
        <div class="pr-brand">
          <img class="pr-logo" src="./assets/logo-kasir-nova.png" alt="" />
          <div class="pr-brand-text">
            <strong class="pr-brand-name">KASIR NOVA</strong>
            <span class="pr-brand-tag">Solusi Kasir Semua Bisnis</span>
          </div>
        </div>
        <div class="pr-head-right">
          <h1 class="pr-title">Laporan Transaksi</h1>
          <span class="pr-periode">Periode ${fmt.escape(periode)}</span>
        </div>
      </header>

      <section class="pr-meta">
        <div><span>Outlet</span><strong>${fmt.escape(outletLabel)}</strong></div>
        <div><span>Kasir</span><strong>${fmt.escape(kasirLabel)}</strong></div>
        <div><span>Tanggal Cetak</span><strong>${fmt.escape(dicetak)}</strong></div>
      </section>

      <section class="pr-kpi">
        ${kpi
          .map(
            (c) => `<div class="pr-kpi-card">
              <span class="pr-kpi-label">${fmt.escape(c.label)}</span>
              <strong class="pr-kpi-value">${fmt.escape(c.value)}</strong>
              ${c.sub ? `<small>${fmt.escape(c.sub)}</small>` : ''}
            </div>`
          )
          .join('')}
      </section>`;

  /** Kop ringkas untuk halaman lanjutan. */
  const headCompact = `
      <header class="pr-cont">
        <span><strong>KASIR NOVA</strong> — Laporan Transaksi (lanjutan)</span>
        <span>Periode ${fmt.escape(periode)}</span>
      </header>`;

  /** Blok bawah 3 kolom. */
  const tail = `
      <section class="pr-bottom">
        <div class="pr-box">
          <h3 class="pr-box-title">Ringkasan Penjualan</h3>
          ${
            s.status === 'completed'
              ? ''
              : `<div class="pr-line"><span>Status transaksi</span>
            <strong>${fmt.escape(fmt.status(s.status))}</strong></div>`
          }
          <div class="pr-line"><span>Total Transaksi</span>
            <strong>${s.transactions} transaksi</strong></div>
          <div class="pr-line"><span>Total Penjualan (Omzet)</span>
            <strong>${fmt.escape(fmt.idr(s.total))}</strong></div>
          ${metodeRingkas}
          ${voidInfo}
        </div>

        <div class="pr-box">
          <h2 class="pr-section-title">Produk Terlaris</h2>
          <table class="pr-table pr-table-mini">
            <thead>
              <tr><th>Produk</th><th class="pr-right">Qty</th><th class="pr-right">Total</th></tr>
            </thead>
            <tbody>${produkHtml}</tbody>
          </table>
        </div>

        <div class="pr-box pr-notes">
          <h2 class="pr-section-title">Catatan</h2>
          <p>Laporan ini dihasilkan dari sistem KASIR NOVA.</p>
          <p>Data berdasarkan transaksi pada outlet: <strong>- ${fmt.escape(outletLabel)}</strong></p>
          <p>Kasir yang bertugas: <strong>${fmt.escape(kasirLabel)}</strong></p>
          <p>Periode: <strong>${fmt.escape(periode)}</strong></p>
          <p>Terima kasih telah menggunakan KASIR NOVA.</p>
        </div>
      </section>`;

  /** Footer tiap halaman (menyertakan nomor halaman). */
  const foot = (sheet) => `
      <footer class="pr-foot">
        <div><strong>KASIR NOVA</strong> · Solusi Kasir Semua Bisnis</div>
        <div>Dicetak ${fmt.escape(dicetak)} | ${pageLabel(sheet.page, plan.total)}</div>
      </footer>`;

  return plan.sheets
    .map(
      (sheet) => `
    <div class="pr-page">
      ${sheet.kind === 'first' ? headFull : headCompact}

      <section class="pr-section">
        <h2 class="pr-section-title">Detail Transaksi${
          sheet.kind === 'first' ? '' : ' (lanjutan)'
        }</h2>
        ${sheet.kind === 'first' ? peringatan : ''}
        <table class="pr-table">
          <thead>
            <tr>
              <th class="pr-num">NO</th>
              <th>No. Transaksi</th>
              <th>Tanggal &amp; Waktu</th>
              <th>Produk</th>
              <th class="pr-right">Qty</th>
              <th class="pr-right">Harga Satuan</th>
              <th class="pr-right">Total</th>
              <th>Metode Pembayaran</th>
              <th>Kasir</th>
              <th>Outlet</th>
            </tr>
          </thead>
          <tbody>${rowsHtml(sheet)}</tbody>
        </table>
      </section>

      ${sheet.withTail ? tail : ''}
      ${foot(sheet)}
    </div>`
    )
    .join('')
    .trim();
};
