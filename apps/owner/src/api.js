/**
 * Klien API panel Owner + manajemen token.
 *
 * - Access token di `sessionStorage` (hilang saat tab ditutup).
 * - Refresh token di `localStorage` agar sesi bisa dipulihkan di tab baru.
 *   (Untuk produksi, refresh token idealnya di cookie HttpOnly; lihat
 *   docs/08-api-auth.md — keputusan hardening dicatat sebagai item lanjutan.)
 * - `request()` otomatis mencoba /refresh SEKALI saat menerima 401.
 *
 * Kunci penyimpanan dibedakan dari panel admin agar sesi tidak tercampur.
 */
const ACCESS_KEY = 'nova_owner_access';
const REFRESH_KEY = 'nova_owner_refresh';

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

const raw = async (path, options = {}) => {
  const headers = { 'Content-Type': 'application/json', ...(options.headers ?? {}) };
  const access = tokenStore.access;
  if (access) headers.Authorization = `Bearer ${access}`;

  const res = await fetch(path, { ...options, headers });
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
    body: JSON.stringify({ role: 'owner', email, password }),
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

  listBusinesses: () => request('/api/owner/businesses'),

  createBusiness: (data) =>
    request('/api/owner/businesses', { method: 'POST', body: JSON.stringify(data) }),

  getBusiness: (id) => request(`/api/owner/businesses/${id}`),

  updateBusiness: (id, data) =>
    request(`/api/owner/businesses/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  setStatus: (id, status) =>
    request(`/api/owner/businesses/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  subscription: (businessId) =>
    request(`/api/owner/businesses/${businessId}/subscription`),

  outlets: {
    list: (businessId) => request(`/api/owner/businesses/${businessId}/outlets`),
    create: (businessId, data) =>
      request(`/api/owner/businesses/${businessId}/outlets`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (businessId, outletId, data) =>
      request(`/api/owner/businesses/${businessId}/outlets/${outletId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    remove: (businessId, outletId) =>
      request(`/api/owner/businesses/${businessId}/outlets/${outletId}`, {
        method: 'DELETE',
      }),
  },

  categories: {
    list: (businessId) => request(`/api/owner/businesses/${businessId}/categories`),
    create: (businessId, data) =>
      request(`/api/owner/businesses/${businessId}/categories`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    remove: (businessId, categoryId) =>
      request(`/api/owner/businesses/${businessId}/categories/${categoryId}`, {
        method: 'DELETE',
      }),
  },

  products: {
    list: (businessId, params = {}) => {
      const qs = new URLSearchParams();
      if (params.search) qs.set('search', params.search);
      if (params.categoryId) qs.set('categoryId', params.categoryId);
      if (params.status) qs.set('status', params.status);
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      return request(`/api/owner/businesses/${businessId}/products${suffix}`);
    },
    get: (businessId, productId) =>
      request(`/api/owner/businesses/${businessId}/products/${productId}`),
    create: (businessId, data) =>
      request(`/api/owner/businesses/${businessId}/products`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (businessId, productId, data) =>
      request(`/api/owner/businesses/${businessId}/products/${productId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    remove: (businessId, productId) =>
      request(`/api/owner/businesses/${businessId}/products/${productId}`, {
        method: 'DELETE',
      }),
    setStock: (businessId, productId, outletId, quantity) =>
      request(`/api/owner/businesses/${businessId}/products/${productId}/stocks/${outletId}`, {
        method: 'PATCH',
        body: JSON.stringify({ quantity }),
      }),
  },
};
