/**
 * KASIR NOVA — alur "Smart Receipt Preview" (FASE 3).
 *
 * Modul ini MURNI (tanpa DOM, jaringan, atau impor relatif) sehingga dapat
 * diuji langsung di Node lewat `data:` URL — sama seperti `receipt.js`.
 *
 * Aturan penting yang dijaga di sini:
 *   1. Pratinjau (draft) TIDAK PERNAH berstatus LUNAS. Pratinjau hanya boleh
 *      dirender sebagai "BELUM DIBAYAR".
 *   2. Hanya transaksi yang sudah dikonfirmasi server (`mode: 'final'`) yang
 *      boleh dicetak.
 *   3. Kegagalan printer TIDAK membatalkan transaksi yang sudah berhasil —
 *      state tetap `final`, hanya menambah catatan galat.
 *   4. Cetak ulang memakai SNAPSHOT (HTML + data saat transaksi dikonfirmasi),
 *      bukan data hidup yang bisa berubah.
 */

export const MODE_DRAFT = 'draft';
export const MODE_FINAL = 'final';

/** Nilai `status` pada objek transaksi pratinjau (bukan data server). */
export const DRAFT_STATUS = 'draft';
export const DRAFT_LABEL = 'BELUM DIBAYAR';
export const DRAFT_NOTICE = 'Pratinjau — transaksi belum dicatat.';
export const REPRINT_LABEL = 'CETAK ULANG';

/** Escape minimal (modul ini tidak boleh mengimpor apa pun). */
const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

/** Waktu ringkas untuk penanda cetak ulang. */
const waktu = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('id-ID');
};

/** UUID v4 untuk idempotensi server (aman bila WebCrypto tidak ada). */
export const newClientRef = () => {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

/**
 * Validasi form penjualan SEBELUM pratinjau. Nominal dalam SEN.
 * @returns {{ok:boolean, error?:string}}
 */
export const validateSale = ({ items = [], method = 'cash', amount = 0, total = 0 } = {}) => {
  if (!items.length) return { ok: false, error: 'Keranjang masih kosong.' };
  const paid = Math.round(Number(amount) || 0);
  const bill = Math.round(Number(total) || 0);
  if (method === 'cash' && paid < bill) {
    return { ok: false, error: 'Uang tunai kurang dari total.' };
  }
  if (method !== 'cash' && paid !== total) {
    return { ok: false, error: 'Jumlah bayar non-tunai harus sama dengan total.' };
  }
  return { ok: true };
};

/**
 * Buat draft pratinjau dari keranjang + form. TIDAK menulis apa pun ke server.
 * `clientRef` dibuat sekali di sini dan dipakai ulang saat konfirmasi supaya
 * percobaan ulang (mis. jaringan terputus) tidak membuat transaksi ganda.
 */
export const createDraft = ({
  items = [],
  method = 'cash',
  amount = 0,
  discount = null,
  note = '',
  clientRef = '',
  context = {},
  cashier = '',
  createdAt = '',
} = {}) => ({
  mode: MODE_DRAFT,
  clientRef: clientRef || newClientRef(),
  createdAt: createdAt || new Date().toISOString(),
  items: (items ?? []).map((it) => ({
    productId: it.productId ?? it.product_id ?? null,
    qty: Math.max(1, Math.trunc(Number(it.qty) || 1)),
  })),
  method,
  amount: Math.round(Number(amount) || 0),
  discount: discount ?? null,
  note: note ?? '',
  context: context ?? {},
  cashier: cashier ?? '',
});

/**
 * Objek transaksi tiruan untuk MERENDER pratinjau struk.
 * `items` sudah berupa baris struk (product_name/unit_price/qty/line_total) dan
 * `totals` adalah perkiraan di perangkat — angka FINAL tetap milik server.
 */
export const draftToTransaction = (draft = {}, { items = [], totals = {} } = {}) => {
  const total = Number(totals.total ?? 0);
  const paid = Number(draft.amount ?? 0);
  const isCash = draft.method === 'cash';
  return {
    id: '',
    invoice_no: '(belum dicatat)',
    created_at: draft.createdAt,
    status: DRAFT_STATUS,
    subtotal: Number(totals.subtotal ?? 0),
    discount_total: Number(totals.discount_total ?? totals.discountTotal ?? 0),
    tax_total: Number(totals.tax_total ?? totals.taxTotal ?? 0),
    tax_rate: Number(totals.tax_rate ?? totals.taxRate ?? 0),
    total,
    paid_amount: paid,
    change_amount: isCash && paid > total ? paid - total : 0,
    items,
    payments: [{ method: draft.method, amount: paid, status: 'pending' }],
  };
};

/** Payload PERSIS yang dikirim ke `POST /transactions` (tanpa harga dari klien). */
export const buildSalePayload = (draft = {}) => {
  const payload = {
    items: (draft.items ?? []).map((it) => ({ productId: it.productId, qty: it.qty })),
    payment: { method: draft.method, amount: Math.round(Number(draft.amount) || 0) },
  };
  if (draft.discount) payload.discount = draft.discount;
  if (draft.note) payload.note = draft.note;
  // clientRef SELALU ikut: kunci idempotensi (anti transaksi ganda).
  if (draft.clientRef) payload.clientRef = draft.clientRef;
  return payload;
};

/** Draft -> state final setelah server mengonfirmasi (transaksi sudah tercatat). */
export const confirmDraft = (draft, transaction, { at = '' } = {}) => ({
  mode: MODE_FINAL,
  draft,
  transaction,
  confirmedAt: at || new Date().toISOString(),
  idempotent: false,
  printError: '',
});

/** Hanya transaksi terkonfirmasi yang boleh dicetak. */
export const isPrintable = (state) =>
  state?.mode === MODE_FINAL && Boolean(state?.transaction?.id || state?.transaction?.invoice_no);

/** Apakah state ini masih pratinjau (belum dibayar / belum dicatat)? */
export const isDraftState = (state) => state?.mode === MODE_DRAFT;

/**
 * Catat kegagalan printer TANPA membatalkan transaksi.
 * Transaksi yang sudah sukses tetap `final` dan tetap boleh dicetak ulang.
 */
export const afterPrintFailure = (state, message = '') => ({
  ...(state ?? {}),
  printError: String(message || 'Cetak gagal. Transaksi tetap tersimpan; coba cetak lagi.'),
});

/** Snapshot untuk cetak ulang: HTML struk + data saat konfirmasi. */
export const createSnapshot = ({
  transaction = null,
  context = {},
  cashier = '',
  html = '',
  width = '58',
  at = '',
} = {}) => ({
  transaction,
  context: context ?? {},
  cashier: cashier ?? '',
  html: String(html ?? ''),
  width: String(width) === '80' ? '80' : '58',
  at: at || new Date().toISOString(),
  reprint: false,
  reprintedAt: '',
});

/** Tandai snapshot sebagai cetak ulang (tidak mengubah snapshot asal). */
export const markReprint = (snapshot, { at = '' } = {}) => ({
  ...(snapshot ?? {}),
  reprint: true,
  reprintedAt: at || new Date().toISOString(),
});

/** Ada isi struk yang bisa dicetak? */
export const hasSnapshot = (snapshot) => Boolean(snapshot?.html);

/**
 * HTML yang disuntik ke `#print-struk`. Cetakan PERTAMA = HTML apa adanya;
 * cetak ulang menambahkan penanda "CETAK ULANG" + waktu.
 */
export const renderPrintHtml = (snapshot) => {
  if (!snapshot?.html) return '';
  if (!snapshot.reprint) return snapshot.html;
  const w = waktu(snapshot.reprintedAt);
  const tail = w ? ` · ${esc(w)}` : '';
  return `<div class="struk-reprint">${esc(REPRINT_LABEL)}${tail}</div>` + snapshot.html;
};

export default {
  MODE_DRAFT,
  MODE_FINAL,
  DRAFT_STATUS,
  DRAFT_LABEL,
  DRAFT_NOTICE,
  REPRINT_LABEL,
  newClientRef,
  validateSale,
  createDraft,
  draftToTransaction,
  buildSalePayload,
  confirmDraft,
  isPrintable,
  isDraftState,
  afterPrintFailure,
  createSnapshot,
  markReprint,
  hasSnapshot,
  renderPrintHtml,
};
