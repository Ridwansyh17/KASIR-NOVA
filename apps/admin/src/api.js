/**
 * Klien API panel Admin + manajemen token.
 *
 * - Access token di `sessionStorage` (hilang saat tab ditutup).
 * - Refresh token di `localStorage` agar sesi bisa dipulihkan di tab baru.
 *   (Untuk produksi, refresh token idealnya di cookie HttpOnly; lihat
 *   docs/08-api-auth.md — keputusan hardening dicatat sebagai item lanjutan.)
 * - `request()` otomatis mencoba /refresh SEKALI saat menerima 401.
 */
const ACCESS_KEY = 'nova_admin_access';
const REFRESH_KEY = 'nova_admin_refresh';

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
    body: JSON.stringify({ role: 'platform_admin', email, password }),
  });
  tokenStore.save(body);
  return body.user;
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

export const api = {
  me: () => request('/api/auth/me'),

  listOwners({ search = '', status = '', page = 1, limit = 10 } = {}) {
    const q = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search) q.set('search', search);
    if (status) q.set('status', status);
    return request(`/api/platform/owners?${q.toString()}`);
  },

  createOwner: (data) =>
    request('/api/platform/owners', { method: 'POST', body: JSON.stringify(data) }),

  updateOwner: (id, data) =>
    request(`/api/platform/owners/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  setStatus: (id, status) =>
    request(`/api/platform/owners/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  resetPassword: (id, newPassword) =>
    request(`/api/platform/owners/${id}/password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword }),
    }),

  deleteOwner: (id) => request(`/api/platform/owners/${id}`, { method: 'DELETE' }),

  // Paket langganan
  listPlans: () => request('/api/platform/plans'),
  createPlan: (data) => request('/api/platform/plans', { method: 'POST', body: JSON.stringify(data) }),
  updatePlan: (id, data) =>
    request(`/api/platform/plans/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // Bisnis & langganan
  listBusinesses({ search = '', status = '', page = 1, limit = 20 } = {}) {
    const q = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search) q.set('search', search);
    if (status) q.set('status', status);
    return request(`/api/platform/businesses?${q.toString()}`);
  },

  getBusinessSubscription: (businessId) =>
    request(`/api/platform/businesses/${businessId}/subscription`),

  assignSubscription: (businessId, planId) =>
    request(`/api/platform/businesses/${businessId}/subscription`, {
      method: 'POST',
      body: JSON.stringify({ planId }),
    }),

  setSubscriptionStatus: (businessId, status) =>
    request(`/api/platform/businesses/${businessId}/subscription/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  // Laporan penjualan (baca saja, sesuai matriks hak akses).
  reports: {
    grouped: (businessId, params = {}) => {
      const q = new URLSearchParams();
      if (params.groupBy) q.set('groupBy', params.groupBy);
      if (params.from) q.set('from', params.from);
      if (params.to) q.set('to', params.to);
      const suffix = q.toString() ? `?${q.toString()}` : '';
      return request(`/api/platform/businesses/${businessId}/reports${suffix}`);
    },
    summary: (businessId, params = {}) => {
      const q = new URLSearchParams();
      if (params.from) q.set('from', params.from);
      if (params.to) q.set('to', params.to);
      const suffix = q.toString() ? `?${q.toString()}` : '';
      return request(`/api/platform/businesses/${businessId}/reports/summary${suffix}`);
    },
    /** @returns {Promise<string|object>} teks CSV atau {items}. */
    download: (businessId, params = {}, format = 'csv') => {
      const q = new URLSearchParams();
      if (params.from) q.set('from', params.from);
      if (params.to) q.set('to', params.to);
      q.set('format', format);
      return request(`/api/platform/businesses/${businessId}/reports/export?${q.toString()}`);
    },
  },

  // Audit log (baca lintas bisnis — matriks §9).
  listAuditLogs(params = {}) {
    const q = new URLSearchParams();
    if (params.actorRole) q.set('actorRole', params.actorRole);
    if (params.action) q.set('action', params.action);
    if (params.from) q.set('from', params.from);
    if (params.to) q.set('to', params.to);
    if (params.limit) q.set('limit', String(params.limit));
    if (params.offset !== undefined) q.set('offset', String(params.offset));
    return request(`/api/platform/audit-logs?${q.toString()}`);
  },

  // Manajemen sesi kasir (Fase 11).
  listCashierSessions: () => request('/api/platform/sessions'),
  revokeCashierSessions: (cashierId) =>
    request(`/api/platform/sessions/${cashierId}/revoke`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
};
