/**
 * Klien API panel Kasir + manajemen token.
 *
 * - Access token di `sessionStorage`, refresh token di `localStorage` (sama
 *   seperti panel lain; hardening cookie HttpOnly dicatat sebagai item
 *   lanjutan di docs/08-api-auth.md).
 * - `login()` TERKUNCI ke peran `cashier` — panel ini tidak bisa dipakai
 *   untuk masuk sebagai owner/admin.
 * - Kunci penyimpanan dibedakan agar sesi tidak tercampur antar panel.
 */
const ACCESS_KEY = 'nova_kasir_access';
const REFRESH_KEY = 'nova_kasir_refresh';

/**
 * Akses storage secara aman. Beberapa lingkungan (mode privat, storage penuh,
 * WebView yang dibatasi) melempar error saat membaca/menulis storage; tanpa
 * penjagaan ini kegagalan storage membuat bootstrap aplikasi gagal total.
 */
const readStore = (store, key) => {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
};

const writeStore = (store, key, value) => {
  try {
    if (value === null) store.removeItem(key);
    else store.setItem(key, value);
  } catch {
    /* storage tidak tersedia — abaikan agar aplikasi tetap berjalan */
  }
};

export const tokenStore = {
  get access() {
    return readStore(sessionStorage, ACCESS_KEY);
  },
  get refresh() {
    return readStore(localStorage, REFRESH_KEY);
  },
  /** Ada sesi tersimpan (access dan/atau refresh) yang bisa dipulihkan. */
  get hasSession() {
    return Boolean(readStore(sessionStorage, ACCESS_KEY) || readStore(localStorage, REFRESH_KEY));
  },
  save({ accessToken, refreshToken }) {
    if (accessToken) writeStore(sessionStorage, ACCESS_KEY, accessToken);
    if (refreshToken) writeStore(localStorage, REFRESH_KEY, refreshToken);
  },
  clear() {
    writeStore(sessionStorage, ACCESS_KEY, null);
    writeStore(localStorage, REFRESH_KEY, null);
  },
};

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

/**
 * Basis URL API. Kosong = origin yang sama (dev). Untuk produksi Firebase
 * Hosting diisi lewat `window.NOVA_API_BASE` (lihat ./config.js di root app).
 */
const API_BASE =
  typeof window !== 'undefined' && typeof window.NOVA_API_BASE === 'string'
    ? window.NOVA_API_BASE.replace(/\/+$/, '')
    : '';
const apiUrl = (path) => (/^https?:\/\//i.test(path) ? path : `${API_BASE}${path}`);

const raw = async (path, options = {}) => {
  const headers = { 'Content-Type': 'application/json', ...(options.headers ?? {}) };
  const access = tokenStore.access;
  if (access) headers.Authorization = `Bearer ${access}`;

  let res;
  try {
    res = await fetch(apiUrl(path), { ...options, headers });
  } catch {
    // Normalisasi kegagalan jaringan -> ApiError status 0 (BUKAN 401) agar
    // pemanggil tidak salah menganggap sesi tidak valid lalu menghapus token.
    throw new ApiError('Tidak dapat menghubungi server. Periksa koneksi Anda.', 0);
  }
  const text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { res, body };
};

let refreshing = null;

/**
 * Perbarui access token memakai refresh token (rotasi sekali pakai di server).
 *
 * Ketahanan:
 *  - Kegagalan jaringan BUKAN alasan menghapus token: pengguna tetap login
 *    dan refresh akan dicoba lagi pada permintaan berikutnya.
 *  - Bila server menolak karena token tersimpan sudah berubah (tab/instance
 *    lain sudah merotasi lebih dulu), coba sekali lagi dengan token terbaru.
 *  - `refreshing` selalu direset (finally) agar promise yang gagal tidak
 *    "membeku" dan memblokir refresh berikutnya.
 *
 * @returns {Promise<boolean>} true bila access token berhasil diperbarui.
 */
const refreshSession = () => {
  if (refreshing) return refreshing;
  if (!tokenStore.refresh) return Promise.resolve(false);

  refreshing = (async () => {
    try {
      let sent = tokenStore.refresh;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let res;
        let body;
        try {
          ({ res, body } = await raw('/api/auth/refresh', {
            method: 'POST',
            body: JSON.stringify({ refreshToken: sent }),
          }));
        } catch {
          // Masalah jaringan: pertahankan sesi, jangan hapus token. Lempar
          // error status 0 (bukan 401) agar pemanggil tidak menghapus token.
          throw new ApiError('Tidak dapat menghubungi server untuk memperbarui sesi.', 0);
        }
        if (res.ok && body?.accessToken) {
          tokenStore.save(body);
          return true;
        }
        const current = tokenStore.refresh;
        if (current && current !== sent) {
          sent = current;
          continue;
        }
        break;
      }
      // Server menolak token secara definitif (kedaluwarsa/dicabut).
      tokenStore.clear();
      return false;
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
};

export const request = async (path, options = {}) => {
  let { res, body } = await raw(path, options);

  if (res.status === 401 && tokenStore.refresh) {
    if (await refreshSession()) {
      ({ res, body } = await raw(path, options));
    }
  }

  if (!res.ok) {
    throw new ApiError(
      body?.error?.message ?? `HTTP ${res.status}`,
      res.status,
      body?.error?.details
    );
  }
  return body;
};

/**
 * Ambil BERKAS (mis. .xlsx) dari server: byte + nama berkas dari header.
 *
 * Alur autentikasi/refresh SENGAJA sama dengan `request()`, tetapi isi respons
 * TIDAK diparse sebagai JSON karena biner. Dipakai tombol "Ekspor Excel" di
 * panel Kasir (jalur web mengunduh berkas, jalur APK menyerahkan byte ke
 * plugin native lewat `struk-share.saveXlsx`).
 *
 * @returns {Promise<{bytes: Uint8Array, filename: string}>}
 */
const requestFile = async (path) => {
  const once = async () => {
    const headers = {};
    const access = tokenStore.access;
    if (access) headers.Authorization = `Bearer ${access}`;

    let res;
    try {
      res = await fetch(apiUrl(path), { method: 'GET', headers });
    } catch {
      throw new ApiError('Tidak dapat menghubungi server. Periksa koneksi Anda.', 0);
    }

    if (res.status === 401 && tokenStore.refresh && (await refreshSession())) {
      return once();
    }
    if (!res.ok) {
      // Server tetap mengirim JSON error walau permintaan biner.
      let message = `HTTP ${res.status}`;
      let details;
      try {
        const body = JSON.parse(await res.text());
        message = body?.error?.message ?? message;
        details = body?.error?.details;
      } catch {
        // Bukan JSON (mis. halaman error) -> pakai pesan HTTP di atas.
      }
      throw new ApiError(message, res.status, details);
    }

    const disposition = res.headers.get('content-disposition') ?? '';
    const match = /filename="?([^";]+)"?/.exec(disposition);
    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      filename: match ? match[1] : 'laporan-transaksi.xlsx',
    };
  };
  return once();
};

/**
 * Pulihkan sesi saat aplikasi dibuka kembali (persistent login).
 *
 * Memverifikasi token tersimpan ke server. Bila access token sudah hilang
 * (aplikasi/tab ditutup) atau kedaluwarsa, `request()` otomatis memakai
 * refresh token yang tersimpan di localStorage terlebih dahulu.
 *
 * @returns {Promise<{user: object, context?: object|null}|null>}
 *   Payload `/api/auth/me` bila sesi masih valid; `null` bila sesi memang
 *   tidak valid (token dicabut/kedaluwarsa/akun nonaktif).
 * @throws {ApiError} status 0/5xx bila server tidak dapat dihubungi — token
 *   TIDAK dihapus sehingga pengguna tidak dipaksa login karena gangguan jaringan.
 */
export const restoreSession = async () => {
  if (!tokenStore.hasSession) return null;
  try {
    const body = await request('/api/auth/me');
    return body?.user ? body : null;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      tokenStore.clear();
      return null;
    }
    throw err;
  }
};

export const login = async (email, password) => {
  const body = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ role: 'cashier', email, password }),
  });
  tokenStore.save(body);
  return body;
};

/** Login PIN kasir (Fase 10b): kirim id kartu + PIN 4 digit, terima token. */
export const loginWithPin = async (cashierId, pin) => {
  const body = await request('/api/auth/cashier-pin', {
    method: 'POST',
    body: JSON.stringify({ cashierId, pin }),
  });
  tokenStore.save(body);
  return body;
};

/** Kartu kasir ber-PIN untuk layar pemilih login PIN (per outlet). */
export const listPinCashiers = async (outletId) => {
  const body = await request(`/api/auth/cashiers?outletId=${encodeURIComponent(outletId)}`);
  return body.items ?? [];
};

export const logout = async () => {
  const refreshToken = tokenStore.refresh;
  try {
    if (refreshToken) {
      await request('/api/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      });
    }
  } catch {
    // logout tetap dianggap berhasil di sisi klien
  } finally {
    tokenStore.clear();
  }
};

/** Bangun query string dari objek; lewati nilai kosong/null/undefined. */
const qs = (params = {}) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
};

export const api = {
  me: () => request('/api/auth/me'),

  /** Info outlet/bisnis kasir + izin (mis. `can_view_profit`). */
  info: () => request('/api/cashier/me'),

  // ------------------------------------------------------------- Produk ----
  products: (params = {}) => request(`/api/cashier/products${qs(params)}`),
  categories: () => request('/api/cashier/categories'),
  createProduct: (data) =>
    request('/api/cashier/products', { method: 'POST', body: JSON.stringify(data) }),
  updateProduct: (productId, data) =>
    request(`/api/cashier/products/${productId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  /** Fase 2: tandai HABIS manual / aktifkan kembali. */
  setStockStatus: (productId, outOfStock, note) =>
    request(`/api/cashier/products/${productId}/stock-status`, {
      method: 'PATCH',
      body: JSON.stringify({ outOfStock, note: note || undefined }),
    }),
  /** Isi/koreksi stok outlet kasir sendiri. */
  setStock: (productId, quantity, reason) =>
    request(`/api/cashier/products/${productId}/stock`, {
      method: 'PATCH',
      body: JSON.stringify({ quantity, reason: reason || undefined }),
    }),

  // ---------------------------------------------------------- Transaksi ----
  createTransaction: (data) =>
    request('/api/cashier/transactions', { method: 'POST', body: JSON.stringify(data) }),

  transactions: (params = {}) => request(`/api/cashier/transactions${qs(params)}`),

  transaction: (id) => request(`/api/cashier/transactions/${id}`),

  // -------------------------------------------------------- Pengeluaran ----
  expenses: (params = {}) => request(`/api/cashier/expenses${qs(params)}`),
  createExpense: (data) =>
    request('/api/cashier/expenses', { method: 'POST', body: JSON.stringify(data) }),
  voidExpense: (expenseId, reason) =>
    request(`/api/cashier/expenses/${expenseId}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  // ------------------------------------------------------------- Laporan ---
  /** Laporan harian outlet (Fase 4). `params`: { date | period | from, to }. */
  daily: (params = {}) => request(`/api/cashier/reports/daily${qs(params)}`),

  /** Seri omzet per hari untuk grafik Beranda. `params`: { period }. */
  dailySeries: (params = {}) => request(`/api/cashier/reports/daily-series${qs(params)}`),

  /** Histori pergerakan stok outlet (append-only, Fase 2). */
  inventoryMovements: (params = {}) =>
    request(`/api/cashier/inventory-movements${qs(params)}`),

  /**
   * Laporan transaksi outlet kasir (17 Okt 2026) — SATU BARIS PER TRANSAKSI
   * (keputusan B1) untuk outlet akun kasir. `params`:
   * { period | date | from, to, status, search, limit }.
   */
  transactionsReport: (params = {}) =>
    request(`/api/cashier/reports/transactions${qs(params)}`),

  /** Berkas .xlsx laporan transaksi outlet (byte + nama berkas dari server). */
  transactionsReportFile: (params = {}) =>
    requestFile(`/api/cashier/reports/transactions/export${qs(params)}`),
};