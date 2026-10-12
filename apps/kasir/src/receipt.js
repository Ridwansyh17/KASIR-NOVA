/**
 * Pembentuk markup struk thermal (POS) — murni (tanpa DOM) agar mudah diuji.
 *
 * Dipakai oleh `app.js` (panel Kasir) untuk mengisi `#print-struk` sebelum
 * `window.print()`. Tanggung jawab file ini hanya: escape teks, format angka
 * Rupiah (dari nilai SEN yang dikirim server), dan menyusun HTML struk.
 * Perhitungan total tetap milik server — di sini kita hanya menampilkan.
 */

/** Escape aman untuk konteks teks maupun atribut (meng-escape & < > " '). */
export const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

/** Nilai server dalam SEN -> "Rp 31.000" (dibagi 100). */
export const fmtIDR = (sen) => `Rp ${(Number(sen ?? 0) / 100).toLocaleString('id-ID')}`;

/** Tanggal/waktu lokal ringkas; "—" bila kosong/tak valid. */
export const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('id-ID');
};

export const METHOD_LABELS = { cash: 'Tunai', card: 'Kartu', qr: 'QRIS', wallet: 'E-Wallet' };

/**
 * Status pembayaran AKTUAL dari data transaksi (tidak mengarang "Lunas").
 * - Transaksi batal -> DIBATALKAN; refund -> DIKEMBALIKAN.
 * - Pembayaran pending -> BELUM LUNAS; gagal -> GAGAL.
 * - Selain itu (completed + paid) -> LUNAS.
 */
export const paymentStatusLabel = (t = {}) => {
  const pay = t.payments?.[0]?.status;
  if (t.status === 'voided') return 'DIBATALKAN';
  if (t.status === 'refunded' || pay === 'refunded') return 'DIKEMBALIKAN';
  if (pay === 'failed') return 'GAGAL';
  if (pay === 'pending') return 'BELUM LUNAS';
  return 'LUNAS';
};

/**
 * Aturan `@page` sesuai lebar kertas. Konten efektif:
 * 58mm - margin 5mm/5mm ≈ 48mm; 80mm - margin 4mm/4mm ≈ 72mm.
 */
export const strukPageCss = (width) => {
  const w = String(width) === '80' ? '80' : '58';
  const margin = w === '80' ? '4mm' : '5mm';
  return `@page { size: ${w}mm auto; margin: ${margin}; }`;
};

/**
 * Susun isi `#print-struk` dari transaksi aktual.
 * @param {object} p
 * @param {object} p.transaction detail transaksi (items, payments, total, ...).
 * @param {object} [p.context] konteks outlet/bisnis dari /me.
 * @param {string} [p.cashier] nama kasir.
 * @returns {string} HTML struk.
 */
export const buildStrukHtml = ({ transaction: t = {}, context = {}, cashier = '' } = {}) => {
  const payment = t.payments?.[0];
  const method = payment?.method ?? 'cash';
  const methodLabel = METHOD_LABELS[method] ?? '-';
  const statusLabel = paymentStatusLabel(t);
  const isCash = method === 'cash';
  const isPaid = statusLabel === 'LUNAS';

  const business = context?.business ?? {};
  const outlet = context?.outlet ?? {};
  const cashierName = cashier || t.cashier_name || '';

  const paid = Number(t.paid_amount ?? 0);
  const change = Number(t.change_amount ?? 0);
  const discount = Number(t.discount_total ?? 0);
  const tax = Number(t.tax_total ?? 0);
  const taxRate = Number(t.tax_rate ?? 0);
  const totalQty = (t.items ?? []).reduce((s, it) => s + Number(it.qty || 0), 0);

  const itemsHtml = (t.items ?? [])
    .map((it) => {
      const qty = Number(it.qty ?? 0);
      const unit = Number(it.unit_price ?? 0);
      const line = Number(it.line_total ?? 0);
      const note = it.note || it.variant_name || null;
      const rows = [
        `<div class="struk-item">`,
        `<span class="struk-item-qty">${escapeHtml(qty)}x</span>`,
        `<span class="struk-item-name">${escapeHtml(it.product_name ?? '')}</span>`,
        `<span class="struk-item-total">${escapeHtml(fmtIDR(line))}</span>`,
        `</div>`,
      ];
      if (qty > 1) rows.push(`<div class="struk-item-sub">@ ${escapeHtml(fmtIDR(unit))}</div>`);
      if (note) rows.push(`<div class="struk-item-sub">${escapeHtml(note)}</div>`);
      return rows.join('');
    })
    .join('');

  const logoUrl = outlet.logo_url || business.logo_url || '';
  const customer = [t.customer_name, t.customer_phone, t.customer_code]
    .filter(Boolean)
    .join(' · ');

  return [
    logoUrl ? `<img class="struk-logo" src="${escapeHtml(logoUrl)}" alt="" />` : '',
    `<div class="struk-head"><strong>${escapeHtml(business.name ?? 'KASIR NOVA')}</strong></div>`,
    outlet.name ? `<div class="struk-sub">${escapeHtml(outlet.name)}</div>` : '',
    outlet.address ? `<div class="struk-sub">${escapeHtml(outlet.address)}</div>` : '',
    outlet.phone ? `<div class="struk-sub">Telp. ${escapeHtml(outlet.phone)}</div>` : '',
    `<div class="struk-divider"></div>`,
    `<div class="struk-info">`,
    `<span class="label">No. Struk</span><span class="value mono">${escapeHtml(t.invoice_no)}</span>`,
    `<span class="label">Tanggal</span><span class="value">${escapeHtml(fmtDate(t.created_at))}</span>`,
    `<span class="label">ID Transaksi</span><span class="value mono">${escapeHtml(t.id)}</span>`,
    cashierName ? `<span class="label">Kasir</span><span class="value">${escapeHtml(cashierName)}</span>` : '',
    customer ? `<span class="label">Pelanggan</span><span class="value">${escapeHtml(customer)}</span>` : '',
    `</div>`,
    `<div class="struk-divider"></div>`,
    `<div class="struk-items">${itemsHtml}</div>`,
    `<div class="struk-divider"></div>`,
    `<div class="struk-summary">`,
    `<div class="struk-row"><span>Total Produk</span><span>${escapeHtml(totalQty)} item</span></div>`,
    `<div class="struk-row"><span>Subtotal</span><span>${escapeHtml(fmtIDR(t.subtotal))}</span></div>`,
    discount !== 0
      ? `<div class="struk-row"><span>Diskon</span><span>-${escapeHtml(fmtIDR(Math.abs(discount)))}</span></div>`
      : '',
    tax !== 0 || taxRate !== 0
      ? `<div class="struk-row"><span>Pajak (${escapeHtml(taxRate)}%)</span><span>${escapeHtml(fmtIDR(tax))}</span></div>`
      : '',
    `<div class="struk-row total"><span>TOTAL</span><span>${escapeHtml(fmtIDR(t.total))}</span></div>`,
    `</div>`,
    `<div class="struk-divider"></div>`,
    `<div class="struk-info">`,
    `<span class="label">Pembayaran</span><span class="value">${escapeHtml(methodLabel)}</span>`,
    `<span class="label">Status</span><span class="value status">${escapeHtml(statusLabel)}</span>`,
    isCash && isPaid
      ? `<span class="label">Uang Diterima</span><span class="value">${escapeHtml(fmtIDR(paid))}</span>`
      : '',
    isCash && isPaid
      ? `<span class="label">Kembalian</span><span class="value">${escapeHtml(fmtIDR(change))}</span>`
      : '',
    `</div>`,
    `<div class="struk-divider"></div>`,
    `<div class="struk-foot">Terima kasih atas kunjungan Anda</div>`,
    `<div class="struk-foot brand">KASIR NOVA</div>`,
  ].join('');
};

export default { escapeHtml, fmtIDR, fmtDate, METHOD_LABELS, paymentStatusLabel, strukPageCss, buildStrukHtml };
