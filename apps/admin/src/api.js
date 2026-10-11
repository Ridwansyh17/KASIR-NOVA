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
