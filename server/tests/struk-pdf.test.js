/**
 * Uji STRUK PDF panel Kasir (17 Okt 2026) + pengirimannya (simpan/kirim/cetak).
 *
 * `apps/kasir/src/receipt-pdf.js` dan `struk-share.js` sengaja murni (tanpa DOM
 * wajib, tanpa impor relatif) sehingga dimuat lewat data: URL — mengikuti pola
 * `printer-escpos.test.js` / `receipt-struk.test.js`.
 *
 * Fokus: berkas PDF benar-benar VALID (header, tabel xref, trailer), isinya
 * sama dengan struk thermal, dan jalur simpan/kirim/cetak bekerja baik di
 * peramban maupun di APK (plugin native `NovaReceipt`).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const kasirSrc = join(here, '..', '..', 'apps', 'kasir', 'src');

const loadEsm = (file) => {
  const source = readFileSync(join(kasirSrc, file), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
};

const pdf = await loadEsm('receipt-pdf.js');
const share = await loadEsm('struk-share.js');

const CONTEXT = {
  business: { name: 'Demo Kasir NOVA' },
  outlet: { name: 'Outlet Utama', address: 'Jl. Melati No. 3', phone: '021-555' },
};

const baseTx = (over = {}) => ({
  id: '11111111-2222-3333-4444-555555555555',
  invoice_no: 'INV-20261013-0009',
  created_at: '2026-10-13T04:30:00.000Z',
  status: 'completed',
  subtotal: 4000000,
  discount_total: 0,
  tax_total: 0,
  tax_rate: 0,
  total: 4000000,
  paid_amount: 5000000,
  change_amount: 1000000,
  items: [{ product_name: 'Nasi Goreng Spesial', qty: 1, unit_price: 4000000, line_total: 4000000 }],
  payments: [{ method: 'cash', status: 'paid' }],
  ...over,
});

const latin1 = (bytes) => Buffer.from(bytes).toString('latin1');

/** Ambil isi objek `id 0 obj ... endobj` dari teks PDF mentah. */
const pdfObject = (text, id) => {
  const marker = `\n${id} 0 obj\n`;
  const start = text.indexOf(marker);
  assert.ok(start >= 0, `objek ${id} ada`);
  const end = text.indexOf('\nendobj', start);
  assert.ok(end > start, `objek ${id} ditutup endobj`);
  return text.slice(start + marker.length, end);
};

/** Panjang stream menurut /Length vs panjang byte sebenarnya. */
const streamLength = (body) => {
  const m = body.match(/^<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream$/);
  assert.ok(m, 'objek stream memuat /Length, stream, dan endstream');
  return { declared: Number(m[1]), actual: m[2].length };
};

/**
 * Pohon halaman PDF harus SAH: /Kids menunjuk objek `/Type /Page` (bukan stream
 * isi), tiap halaman menunjuk induk & isinya, dan /Length tepat. (Bug 17 Okt 2026:
 * /Kids menunjuk objek stream -> berkas terbuka tetapi halaman KOSONG.)
 */
const assertPageTreeValid = (text) => {
  const pages = pdfObject(text, 2);
  assert.match(pages, /\/Type \/Pages\b/, 'objek 2 adalah /Pages');
  const kidsRaw = pages.match(/\/Kids \[([^\]]*)\]/);
  assert.ok(kidsRaw, 'objek /Pages memuat /Kids');
  const tokens = kidsRaw[1].trim().split(/\s+/);
  assert.equal(tokens.length % 3, 0, '/Kids berisi pasangan "n 0 R"');
  const kidIds = [];
  for (let i = 0; i < tokens.length; i += 3) {
    assert.equal(tokens[i + 1], '0', '/Kids memakai generasi 0');
    assert.equal(tokens[i + 2], 'R', '/Kids memakai referensi tidak langsung');
    kidIds.push(Number(tokens[i]));
  }
  assert.ok(kidIds.length > 0, '/Kids tidak kosong');
  assert.equal(Number(pages.match(/\/Count (\d+)/)[1]), kidIds.length, '/Count = jumlah /Kids');

  for (const id of kidIds) {
    const body = pdfObject(text, id);
    assert.match(body, /\/Type \/Page\b/, `objek ${id} harus halaman, bukan stream isi`);
    assert.match(body, /\/Parent 2 0 R/, `halaman ${id} menunjuk pohon halaman`);
    assert.match(body, /\/MediaBox \[0 0 /, `halaman ${id} punya MediaBox`);
    for (const font of ['/F1 3 0 R', '/F2 4 0 R']) {
      assert.ok(body.includes(font), `halaman ${id} menyediakan font ${font}`);
    }
    const contentsId = Number(body.match(/\/Contents (\d+) 0 R/)[1]);
    const stream = pdfObject(text, contentsId);
    const { declared, actual } = streamLength(stream);
    assert.equal(declared, actual, `/Length objek ${contentsId} tepat`);
    assert.ok(declared > 0, `isi halaman ${id} tidak kosong`);
    assert.match(stream, /BT[\s\S]*ET/, `isi halaman ${id} berupa teks`);
    assert.match(stream, /Tj\b/, `isi halaman ${id} menggambar teks (Tj)`);
  }

  // Tidak boleh ada halaman yang "yatim" (tidak dirujuk /Kids).
  const pageObjects = [...text.matchAll(/\n(\d+) 0 obj\n<< [^\n]*\/Type \/Page\b/g)].map((m) => Number(m[1]));
  assert.deepEqual(
    [...pageObjects].sort((a, b) => a - b),
    [...kidIds].sort((a, b) => a - b),
    'semua objek /Type /Page dirujuk /Kids'
  );
};

/** Periksa tabel xref: setiap offset harus menunjuk tepat ke "<n> 0 obj". */
const assertXrefValid = (text) => {
  const at = text.lastIndexOf('startxref');
  assert.ok(at > 0, 'ada startxref');
  const offset = Number(text.slice(at + 'startxref'.length).trim().split(/\s+/)[0]);
  assert.ok(offset > 0 && offset < text.length, 'startxref menunjuk di dalam berkas');

  const rows = text.slice(offset).split('\n');
  assert.equal(rows[0], 'xref', 'tabel xref diawali "xref"');
  const [first, count] = rows[1].split(' ').map(Number);
  assert.equal(first, 0, 'xref dimulai dari objek 0');
  assert.equal(rows[2].trim(), '0000000000 65535 f', 'entri bebas objek 0');
  const entries = rows.slice(3, 3 + count - 1);
  assert.equal(entries.length, count - 1, 'jumlah entri xref sesuai /Size');
  entries.forEach((row, i) => {
    const objOffset = Number(row.slice(0, 10));
    assert.match(
      text.slice(objOffset, objOffset + 20),
      new RegExp(`^${i + 1} 0 obj`),
      `offset objek ${i + 1} tepat`
    );
  });
};

test('struk PDF: berkas valid (header, xref, trailer) & berukuran 58 mm', () => {
  const bytes = pdf.buildStrukPdf({ transaction: baseTx(), context: CONTEXT, cashier: 'Rina Wati' });
  assert.ok(bytes instanceof Uint8Array, 'hasil berupa byte');
  const text = latin1(bytes);
  assert.ok(text.startsWith('%PDF-1.4'), 'diawali %PDF-1.4');
  assert.ok(text.trimEnd().endsWith('%%EOF'), 'diakhiri %%EOF');
  assert.ok(text.includes('/MediaBox [0 0 164.41 '), 'lebar halaman 58 mm (164,41 pt)');
  assert.ok(text.includes('/BaseFont /Courier'), 'font Courier base-14 (tanpa sematan)');
  assertXrefValid(text);
  assertPageTreeValid(text);
});

test('struk PDF: pohon halaman sah & isi halaman tidak kosong (58 mm & 80 mm)', () => {
  for (const width of ['58', '80']) {
    const bytes = pdf.buildStrukPdf({
      transaction: baseTx(),
      context: CONTEXT,
      cashier: 'Rina Wati',
      width,
    });
    const text = latin1(bytes);
    assertXrefValid(text);
    assertPageTreeValid(text);
    // Teks struk benar-benar berada DI DALAM stream isi halaman.
    const pages = pdfObject(text, 2);
    const firstPageId = Number(pages.match(/\/Kids \[(\d+)/)[1]);
    const contentsId = Number(pdfObject(text, firstPageId).match(/\/Contents (\d+) 0 R/)[1]);
    const stream = pdfObject(text, contentsId);
    for (const needle of ['Demo Kasir NOVA', 'INV-20261013-0009', 'TOTAL', 'KASIR NOVA']) {
      assert.ok(stream.includes(needle), `isi halaman (${width} mm) memuat "${needle}"`);
    }
  }
});

test('struk PDF: lebar 80 mm & isi struk lengkap', () => {
  const text = latin1(
    pdf.buildStrukPdf({ transaction: baseTx(), context: CONTEXT, cashier: 'Rina Wati', width: '80' })
  );
  assert.ok(text.includes('/MediaBox [0 0 226.77 '), 'lebar halaman 80 mm (226,77 pt)');
  for (const needle of [
    'INV-20261013-0009',
    'Demo Kasir NOVA',
    'Outlet Utama',
    'Nasi Goreng Spesial',
    'TOTAL',
    'Rp 40.000',
    'Tunai',
    'LUNAS',
    'Uang Diterima',
    'Kembalian',
    'No. Struk',
    'Kasir',
    'Terima kasih atas kunjungan Anda',
    'KASIR NOVA',
  ]) {
    assert.ok(text.includes(needle), `struk memuat "${needle}"`);
  }
});

test('struk PDF: baris tidak melebihi lebar kertas (32 kolom / 48 kolom)', () => {
  const long = {
    product_name: 'Nasi Goreng Spesial dengan Telur Mata Sapi dan Kerupuk Udang Extra',
    qty: 3,
    unit_price: 4000000,
    line_total: 12000000,
  };
  const lines58 = pdf.buildStrukLines({
    transaction: baseTx({ items: [long] }),
    context: { business: { name: 'Warung Makan Nusantara Rasa Bintang Lima Cabang Utama' }, outlet: { name: 'Outlet Utama' } },
    cashier: 'Rina Wati',
  });
  assert.ok(lines58.length > 0, 'menghasilkan baris');
  assert.ok(lines58.every((l) => l.length <= 32), `maks 32 kolom (58 mm): ${JSON.stringify(lines58)}`);

  const lines80 = pdf.buildStrukLines({
    transaction: baseTx({ items: [long] }),
    context: CONTEXT,
    cashier: 'Rina Wati',
    width: '80',
  });
  assert.ok(lines80.every((l) => l.length <= 48), 'maks 48 kolom (80 mm)');
});

test('struk PDF: teks non-ASCII & karakter khusus PDF diamankan', () => {
  const tx = baseTx({
    items: [{ product_name: 'Kopi(Besar)\\Spesial—日本', qty: 1, unit_price: 1500000, line_total: 1500000 }],
  });
  const text = latin1(pdf.buildStrukPdf({ transaction: tx, context: CONTEXT }));
  assert.ok(text.includes('Kopi\\(Besar\\)'), 'tanda kurung di-escape untuk PDF');
  assert.ok(text.includes('Kopi\\(Besar\\)\\\\Spesial'), 'garis miring di-escape untuk PDF');
  assert.ok(!/[^\x00-\x7f]/.test(text), 'berkas hanya berisi byte ASCII');
});

test('struk PDF: pratinjau (draft) tidak pernah berstatus LUNAS', () => {
  const lines = pdf.buildStrukLines({ transaction: baseTx({ status: 'draft' }), context: CONTEXT });
  assert.ok(lines.some((l) => l.includes('BELUM DIBAYAR')), 'ada penanda BELUM DIBAYAR');
  assert.ok(!lines.some((l) => l.includes('LUNAS')), 'tidak pernah LUNAS');
});

test('struk PDF: penanda CETAK ULANG & status void/refund jujur', () => {
  const ulang = pdf.buildStrukLines({ transaction: baseTx(), context: CONTEXT, reprint: true });
  assert.ok(ulang.some((l) => l.includes('CETAK ULANG')), 'penanda cetak ulang');

  const voided = pdf.buildStrukLines({ transaction: baseTx({ status: 'voided' }), context: CONTEXT });
  assert.ok(voided.some((l) => l.includes('DIBATALKAN')), 'status void jujur');

  const refund = pdf.buildStrukLines({
    transaction: baseTx({ status: 'refunded', payments: [{ method: 'cash', status: 'refunded' }] }),
    context: CONTEXT,
  });
  assert.ok(refund.some((l) => l.includes('DIKEMBALIKAN')), 'status refund jujur');
});

test('struk PDF: struk sangat panjang dipecah ke beberapa halaman', () => {
  const items = Array.from({ length: 240 }, (_, i) => ({
    product_name: `Produk Panjang ${i + 1}`,
    qty: 1,
    unit_price: 1000,
    line_total: 1000,
  }));
  const bytes = pdf.buildStrukPdf({
    transaction: baseTx({ items, subtotal: 240000, total: 240000 }),
    context: CONTEXT,
  });
  const text = latin1(bytes);
  const count = Number(text.match(/\/Count (\d+)/)?.[1] ?? 0);
  assert.ok(count > 1, `lebih dari satu halaman (dapat ${count})`);
  assertXrefValid(text);
  assertPageTreeValid(text);
  assert.equal((text.match(/\/Type \/Page[^s]/g) ?? []).length, count, 'jumlah halaman sesuai /Count');
});

test('struk PDF: base64 & nama berkas aman', () => {
  const bytes = pdf.buildStrukPdf({ transaction: baseTx(), context: CONTEXT });
  const b64 = pdf.bytesToBase64(bytes);
  assert.ok(Buffer.from(b64, 'base64').equals(Buffer.from(bytes)), 'base64 bolak-balik utuh');
  assert.equal(pdf.strukPdfFileName({ invoice_no: 'INV-20261013-0009' }), 'Struk-INV-20261013-0009.pdf');
  assert.equal(pdf.strukPdfFileName({ invoice_no: 'INV/2026 10#9' }), 'Struk-INV-2026-10-9.pdf');
  assert.equal(pdf.strukPdfFileName({}), 'Struk-kasir.pdf');
});

// --------------------------------------------------------------- pengiriman --
const withGlobals = async (patch, fn) => {
  const saved = new Map();
  for (const [key, value] of Object.entries(patch)) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    try {
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    } catch {
      return; // lingkungan tidak mengizinkan (mis. navigator read-only) -> lewati
    }
  }
  try {
    await fn();
  } finally {
    for (const [key, desc] of saved) {
      if (desc) Object.defineProperty(globalThis, key, desc);
      else delete globalThis[key];
    }
  }
};

test('struk-share: jalur APK memakai plugin NovaReceipt (share/save/print)', async () => {
  const calls = [];
  const plugin = {
    share: async (o) => calls.push(['share', o]),
    save: async (o) => calls.push(['save', o]),
    print: async (o) => calls.push(['print', o]),
  };
  await withGlobals({ Capacitor: { isNativePlatform: () => true, registerPlugin: () => plugin } }, async () => {
    assert.equal(share.isNative(), true);
    assert.equal(share.canUseNative(), true);

    const r1 = await share.sharePdf({ bytes: new Uint8Array([1]), base64: 'AA==', filename: 'S.pdf' });
    const r2 = await share.savePdf({ bytes: new Uint8Array([1]), base64: 'AA==', filename: 'S.pdf' });
    const r3 = await share.printPdf({ base64: 'AA==', filename: 'S.pdf', jobName: 'Struk INV-1' });

    assert.equal(r1.via, 'native-share');
    assert.equal(r2.via, 'native-save');
    assert.equal(r3.via, 'native-print');
    assert.equal(calls.length, 3, 'tiga panggilan ke plugin native');
    assert.equal(calls[0][1].mime, 'application/pdf');
    assert.equal(calls[0][1].base64, 'AA==', 'berkas dikirim sebagai base64');
    assert.equal(calls[2][1].jobName, 'Struk INV-1');
  });
});

test('struk-share: tanpa Web Share → ditandai agar UI mengunduh berkas', async () => {
  await withGlobals({ Capacitor: undefined, navigator: {} }, async () => {
    assert.equal(share.isNative(), false);
    assert.equal(share.canUseNative(), false);
    assert.equal(share.canSharePdf(new Uint8Array([1]), 'S.pdf'), false);

    const res = await share.sharePdf({ bytes: new Uint8Array([1]), filename: 'S.pdf' });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'share_unsupported');

    const print = await share.printPdf({ base64: 'AA==', filename: 'S.pdf' });
    assert.equal(print.ok, false);
    assert.equal(print.reason, 'not_native');
  });
});

test('struk-share: Web Share dengan berkas PDF di peramban', async () => {
  const shared = [];
  class FakeFile {
    constructor(parts, name, opts) {
      this.name = name;
      this.type = opts?.type;
    }
  }
  await withGlobals(
    {
      Capacitor: undefined,
      File: FakeFile,
      navigator: {
        canShare: ({ files }) => Array.isArray(files) && files.length === 1,
        share: async (data) => shared.push(data),
      },
    },
    async () => {
      const res = await share.sharePdf({
        bytes: new Uint8Array([1]),
        filename: 'Struk-INV-1.pdf',
        title: 'Struk',
        text: 'Struk INV-1',
      });
      assert.equal(res.ok, true);
      assert.equal(res.via, 'share');
      assert.equal(shared.length, 1);
      assert.equal(shared[0].files[0].name, 'Struk-INV-1.pdf');
      assert.equal(shared[0].files[0].type, 'application/pdf');
    }
  );
});

// ------------------------------- Ekspor Excel (laporan transaksi kasir) -----
test('struk-share: saveXlsx mengirim MIME Excel ke plugin native (APK)', async () => {
  const calls = [];
  const plugin = {
    save: async (o) => calls.push(['save', o]),
    share: async (o) => calls.push(['share', o]),
  };
  await withGlobals(
    { Capacitor: { isNativePlatform: () => true, registerPlugin: () => plugin } },
    async () => {
      const res = await share.saveXlsx({
        bytes: new Uint8Array([1, 2, 3]),
        base64: 'AQID',
        filename: 'Laporan.xlsx',
      });
      assert.equal(res.ok, true);
      assert.equal(res.via, 'native-save');
      assert.equal(calls.length, 1);
      assert.equal(calls[0][1].filename, 'Laporan.xlsx');
      assert.equal(calls[0][1].base64, 'AQID', 'byte dikirim sebagai base64');
      assert.equal(calls[0][1].mime, share.XLSX_MIME, 'MIME spreadsheet, bukan PDF');
      assert.match(calls[0][1].mime, /spreadsheetml\.sheet/);
    }
  );
});

test('struk-share: tanpa plugin native → berkas Excel diunduh (web)', async () => {
  const created = [];
  const clicked = [];
  const fakeDoc = {
    createElement: () => ({
      set href(v) {
        created.push(v);
      },
      click() {
        clicked.push(true);
      },
      remove() {},
    }),
    body: { appendChild() {} },
  };
  await withGlobals(
    {
      Capacitor: undefined,
      document: fakeDoc,
      URL: { createObjectURL: () => 'blob:uji', revokeObjectURL() {} },
      Blob: class {
        constructor(parts, opts) {
          this.parts = parts;
          this.type = opts?.type;
        }
      },
      setTimeout: () => 0,
    },
    async () => {
      const res = await share.saveXlsx({
        bytes: new Uint8Array([1]),
        base64: 'AQ==',
        filename: 'Laporan.xlsx',
      });
      assert.equal(res.ok, true);
      assert.equal(res.via, 'download');
      assert.deepEqual(created, ['blob:uji']);
      assert.equal(clicked.length, 1, 'tautan unduhan diklik sekali');
    }
  );
});

test('struk-share: shareFile memakai Web Share dengan MIME Excel', async () => {
  const shared = [];
  class FakeFile {
    constructor(parts, name, opts) {
      this.name = name;
      this.type = opts?.type;
    }
  }
  await withGlobals(
    {
      Capacitor: undefined,
      File: FakeFile,
      navigator: {
        canShare: ({ files }) => Array.isArray(files) && files.length === 1,
        share: async (data) => shared.push(data),
      },
    },
    async () => {
      const res = await share.shareFile({
        bytes: new Uint8Array([1]),
        filename: 'Laporan.xlsx',
        mime: share.XLSX_MIME,
      });
      assert.equal(res.ok, true);
      assert.equal(res.via, 'share');
      assert.equal(shared[0].files[0].name, 'Laporan.xlsx');
      assert.equal(shared[0].files[0].type, share.XLSX_MIME);
    }
  );
});
