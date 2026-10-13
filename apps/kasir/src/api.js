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

export const tokenStore = {
  get access() {
    return sessionStorage.getItem(ACCESS_KEY);
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY);
  },
  save({ accessToken, refreshToken }) {
    if (accessToken) sessionStorage.setItem(ACCESS_KEY, accessToken);
    if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
  },
  clear() {
    sessionStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
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

  const res = await fetch(apiUrl(path), { ...options, headers });
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
const refreshSession = () => {
  if (refreshing) return refreshing;
  const refreshToken = tokenStore.refresh;
  if (!refreshToken) return Promise.resolve(false);

  refreshing = (async () => {
    const { res, body } = await raw('/api/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    });
    refreshing = null;
    if (res.ok && body?.accessToken) {
      tokenStore.save(body);
      return true;
    }
    tokenStore.clear();
    return false;
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

  /** Histori pergerakan stok outlet (append-only, Fase 2). */
  inventoryMovements: (params = {}) =>
    request(`/api/cashier/inventory-movements${qs(params)}`),
};