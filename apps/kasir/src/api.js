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
    body: JSON.stringify({ role: 'cashier', email, password }),
  });
  tokenStore.save(body);
  return body;
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
};