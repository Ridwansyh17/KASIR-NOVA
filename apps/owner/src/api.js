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

/** Bangun query string dari pasangan yang ber-isi (mengabaikan kosong/null). */
const queryString = (params) => {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') qs.set(key, value);
  }
  const suffix = qs.toString();
  return suffix ? `?${suffix}` : '';
};

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

/** Fetch biner (Blob) dengan header Authorization; tanpa parsing JSON. */
const fetchBinary = (path, options = {}) => {
  const headers = { ...(options.headers ?? {}) };
  const access = tokenStore.access;
  if (access) headers.Authorization = `Bearer ${access}`;
  return fetch(apiUrl(path), { ...options, headers });
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
    body: JSON.stringify({ role: 'owner', email, password }),
  });
  tokenStore.save(body);
  return body.user;
};

/** Pendaftaran Owner mandiri (publik): akun dibuat, email verifikasi dikirim. */
export const registerOwner = (payload) =>
  request('/api/auth/register-owner', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

/** Kirim ulang tautan verifikasi (respons selalu generik). */
export const resendVerification = (email) =>
  request('/api/auth/resend-verification', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });

/** Status pendaftaran Firebase berdasarkan state halaman verifikasi. */
export const firebaseVerificationStatus = (state) =>
  request(
    `/api/auth/firebase/verification-status?state=${encodeURIComponent(state)}`
  );

/** Minta backend memeriksa status terbaru ke Firebase Admin SDK. */
export const verifyFirebaseOwner = (state, idToken) =>
  request('/api/auth/firebase/verify-owner', {
    method: 'POST',
    body: JSON.stringify({ state, ...(idToken ? { idToken } : {}) }),
  });

/** Kirim ulang email verifikasi Firebase (dibatasi cooldown server). */
export const resendFirebaseVerification = (state) =>
  request('/api/auth/firebase/resend-verification', {
    method: 'POST',
    body: JSON.stringify({ state }),
  });

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

/**
 * Unduh berkas .xlsx dari `basePath`: menambahkan `format=xlsx`, membuang
 * parameter kosong, dan mencoba refresh token SEKALI saat 401.
 * @returns {Promise<{blob: Blob, filename: string}>}
 */
const downloadXlsx = async (basePath, params = {}, fallbackName) => {
  const qs = new URLSearchParams(params);
  for (const [key, value] of [...qs]) {
    if (value === '') qs.delete(key);
  }
  qs.set('format', 'xlsx');
  const path = `${basePath}?${qs.toString()}`;

  let res = await fetchBinary(path);
  if (res.status === 401 && tokenStore.refresh) {
    if (await refreshSession()) res = await fetchBinary(path);
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      message = body?.error?.message ?? message;
    } catch {
      // body tidak berupa JSON — abaikan
    }
    throw new ApiError(message, res.status);
  }

  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  const filename = match?.[1] ?? fallbackName;
  return { blob, filename };
};

export const api = {
  me: () => request('/api/auth/me'),

  /**
   * Ganti sandi sendiri. Refresh token perangkat ini dikirim agar server
   * mencabut sesi lain tetapi mempertahankan sesi yang sedang dipakai.
   */
  changePassword: ({ currentPassword, newPassword }) =>
    request('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword,
        newPassword,
        ...(tokenStore.refresh ? { refreshToken: tokenStore.refresh } : {}),
      }),
    }),

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

  // Pembayaran langganan (payment gateway, uji sandbox Duitku).
  subscriptionPlans: (businessId) =>
    request(`/api/owner/businesses/${businessId}/subscription/plans`),

  subscriptionInvoices: (businessId, params = {}) =>
    request(`/api/owner/businesses/${businessId}/subscription/invoices${queryString(params)}`),

  subscriptionInvoice: (businessId, invoiceId) =>
    request(`/api/owner/businesses/${businessId}/subscription/invoices/${invoiceId}`),

  createSubscriptionInvoice: (businessId, data) =>
    request(`/api/owner/businesses/${businessId}/subscription/invoices`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /** Cek status ke gateway (manual; dibatasi server untuk menjaga hit rate). */
  syncSubscriptionInvoice: (businessId, invoiceId) =>
    request(`/api/owner/businesses/${businessId}/subscription/invoices/${invoiceId}/sync`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  outlets: {
    list: (businessId) => request(`/api/owner/businesses/${businessId}/outlets`),
    get: (businessId, outletId) =>
      request(`/api/owner/businesses/${businessId}/outlets/${outletId}`),
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

  cashiers: {
    list: (businessId) => request(`/api/owner/businesses/${businessId}/cashiers`),
    create: (businessId, data) =>
      request(`/api/owner/businesses/${businessId}/cashiers`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    /** Ubah data kasir (mis. izin melihat HPP: `{ canViewProfit: true }`). */
    update: (businessId, cashierId, data) =>
      request(`/api/owner/businesses/${businessId}/cashiers/${cashierId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    setPin: (businessId, cashierId, pin) =>
      request(`/api/owner/businesses/${businessId}/cashiers/${cashierId}/pin`, {
        method: 'POST',
        body: JSON.stringify({ pin }),
      }),
    removePin: (businessId, cashierId) =>
      request(`/api/owner/businesses/${businessId}/cashiers/${cashierId}/pin`, {
        method: 'DELETE',
      }),
    unlock: (businessId, cashierId) =>
      request(`/api/owner/businesses/${businessId}/cashiers/${cashierId}/pin/unlock`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    sessions: {
      list: (businessId, cashierId) =>
        request(`/api/owner/businesses/${businessId}/cashiers/${cashierId}/sessions`),
      revoke: (businessId, cashierId) =>
        request(`/api/owner/businesses/${businessId}/cashiers/${cashierId}/sessions/revoke`, {
          method: 'POST',
          body: JSON.stringify({}),
        }),
    },
  },

  auditLogs: {
    list: (businessId, params = {}) => {
      const qs = new URLSearchParams();
      if (params.actorRole) qs.set('actorRole', params.actorRole);
      if (params.action) qs.set('action', params.action);
      if (params.from) qs.set('from', params.from);
      if (params.to) qs.set('to', params.to);
      if (params.limit) qs.set('limit', String(params.limit));
      if (params.offset !== undefined) qs.set('offset', String(params.offset));
      return request(`/api/owner/businesses/${businessId}/audit-logs?${qs.toString()}`);
    },
  },

  transactions: {
    list: (businessId, params = {}) => {
      const qs = new URLSearchParams();
      if (params.status) qs.set('status', params.status);
      if (params.outletId) qs.set('outletId', params.outletId);
      if (params.cashierId) qs.set('cashierId', params.cashierId);
      if (params.dateFrom) qs.set('dateFrom', params.dateFrom);
      if (params.dateTo) qs.set('dateTo', params.dateTo);
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      return request(`/api/owner/businesses/${businessId}/transactions${suffix}`);
    },
    get: (businessId, transactionId) =>
      request(`/api/owner/businesses/${businessId}/transactions/${transactionId}`),
    void: (businessId, transactionId) =>
      request(`/api/owner/businesses/${businessId}/transactions/${transactionId}/void`, {
        method: 'POST',
        body: '{}',
      }),
  },

  reports: {
    /** @param {{groupBy?,from?,to?,outletId?,cashierId?,status?,paymentMethod?,paymentStatus?,search?}} params */
    grouped: (businessId, params = {}) =>
      request(`/api/owner/businesses/${businessId}/reports${queryString(params)}`),
    summary: (businessId, params = {}) =>
      request(`/api/owner/businesses/${businessId}/reports/summary${queryString(params)}`),
    /**
     * Laporan transaksi detail siap-cetak (Fase 17): SATU BARIS PER ITEM +
     * rekap metode pembayaran & produk terlaris. Milik panel Owner saja.
     * @param {{from?,to?,outletId?,cashierId?,status?,paymentMethod?,paymentStatus?,search?,limit?}} params
     */
    transactions: (businessId, params = {}) =>
      request(`/api/owner/businesses/${businessId}/reports/transactions${queryString(params)}`),
    /**
     * Unduh Laporan Transaksi (SATU BARIS PER ITEM) sebagai .xlsx
     * (Ringkasan + Detail Transaksi + Rekap Metode + Produk Terlaris).
     * Server memakai batas baris lebih tinggi (bawaan 5000) daripada halaman.
     * @returns {Promise<{blob: Blob, filename: string}>}
     */
    transactionsXlsx: (businessId, params = {}) =>
      downloadXlsx(
        `/api/owner/businesses/${businessId}/reports/transactions/export`,
        params,
        'KASIR_NOVA_Laporan_Transaksi.xlsx'
      ),
    /** Perbandingan agregat tiap outlet dalam satu bisnis (Fase 16). */
    outlets: (businessId, params = {}) =>
      request(`/api/owner/businesses/${businessId}/reports/outlets${queryString(params)}`),
    /**
     * Ringkasan keuangan/laba (Fase 4/6): pendapatan per metode, HPP,
     * biaya transaksi, pengeluaran operasional, laba kotor & bersih.
     * @param {{period?,date?,from?,to?,outletId?}} params
     */
    finance: (businessId, params = {}) =>
      request(`/api/owner/businesses/${businessId}/reports/finance${queryString(params)}`),
    /** Unduh laporan keuangan .xlsx (Ringkasan + Per Outlet + Pengeluaran). */
    financeXlsx: (businessId, params = {}) =>
      downloadXlsx(
        `/api/owner/businesses/${businessId}/reports/finance/export`,
        params,
        'KASIR_NOVA_Laporan_Keuangan.xlsx'
      ),
    /** Perbandingan agregat tiap bisnis milik Owner (Fase 16). */
    businesses: (params = {}) => request(`/api/owner/reports/businesses${queryString(params)}`),
    /** @returns {Promise<string|object>} teks CSV atau objek {items}. */
    download: (businessId, params = {}, format = 'csv') => {
      const qs = new URLSearchParams(params);
      // Buang nilai kosong agar tidak memicu 422 validasi (enum kosong).
      for (const [key, value] of [...qs]) {
        if (value === '') qs.delete(key);
      }
      qs.set('format', format);
      return request(`/api/owner/businesses/${businessId}/reports/export?${qs.toString()}`);
    },
    /**
     * Unduh rekapan transaksi .xlsx sebagai berkas biner.
     * @returns {Promise<{blob: Blob, filename: string}>}
     */
    downloadXlsx: (businessId, params = {}) =>
      downloadXlsx(
        `/api/owner/businesses/${businessId}/reports/export`,
        params,
        'KASIR_NOVA_Rekapan_Transaksi.xlsx'
      ),
    /** Unduh perbandingan outlet .xlsx (Fase 16). */
    outletsXlsx: (businessId, params = {}) =>
      downloadXlsx(
        `/api/owner/businesses/${businessId}/reports/outlets/export`,
        params,
        'KASIR_NOVA_Perbandingan_Outlet.xlsx'
      ),
    /** Unduh perbandingan lintas-bisnis .xlsx (Fase 16). */
    businessesXlsx: (params = {}) =>
      downloadXlsx(
        '/api/owner/reports/businesses/export',
        params,
        'KASIR_NOVA_Perbandingan_Bisnis.xlsx'
      ),
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
    /** Fase 2: tandai produk HABIS manual / aktifkan kembali. */
    setStockStatus: (businessId, productId, outOfStock) =>
      request(`/api/owner/businesses/${businessId}/products/${productId}/stock-status`, {
        method: 'PATCH',
        body: JSON.stringify({ outOfStock }),
      }),
  },

  /**
   * Pengeluaran outlet (Fase 5). Koreksi memakai void + alasan (bukan hapus).
   * Nominal dalam SEN di body (`amount`).
   */
  expenses: {
    list: (businessId, params = {}) =>
      request(`/api/owner/businesses/${businessId}/expenses${queryString(params)}`),
    create: (businessId, data) =>
      request(`/api/owner/businesses/${businessId}/expenses`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    void: (businessId, expenseId, reason) =>
      request(`/api/owner/businesses/${businessId}/expenses/${expenseId}/void`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
  },

  /**
   * Setoran kas (uang tunai kasir -> Owner). Bukan pendapatan/beban.
   * Koreksi memakai void + alasan (append-only). Nominal SEN di body.
   */
  cashDeposits: {
    /**
     * Daftar setoran (paginasi).
     * @param {{outletId?,cashierId?,status?,from?,to?,page?,limit?}} params
     */
    list: (businessId, params = {}) =>
      request(`/api/owner/businesses/${businessId}/cash-deposits${queryString(params)}`),

    /** Detail setoran + snapshot transaksi & pengeluaran. */
    detail: (businessId, depositId) =>
      request(`/api/owner/businesses/${businessId}/cash-deposits/${depositId}`),

    /**
     * Rekap setoran per hari/minggu/bulan (hanya status SELESAI).
     * @param {{outletId?,cashierId?,from?,to?,group?:'day'|'week'|'month'}} params
     */
    report: (businessId, params = {}) =>
      request(`/api/owner/businesses/${businessId}/cash-deposits/report${queryString(params)}`),

    /**
     * Unduh laporan setoran .xlsx sesuai filter (tanpa paginasi).
     * @returns {Promise<{blob: Blob, filename: string}>}
     */
    exportXlsx: (businessId, params = {}) =>
      downloadXlsx(
        `/api/owner/businesses/${businessId}/cash-deposits/export`,
        params,
        'KASIR_NOVA_Laporan_Setoran.xlsx'
      ),

    /** Pratinjau perhitungan setoran (read-only; outlet WAJIB untuk Owner). */
    preview: (businessId, params = {}) =>
      request(
        `/api/owner/businesses/${businessId}/cash-deposits/settlement/preview${queryString(params)}`
      ),

    /** Buat setoran baru (langsung selesai atau simpan sebagai draft). */
    createSettlement: (businessId, data) =>
      request(`/api/owner/businesses/${businessId}/cash-deposits/settlement`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    /** Selesaikan setoran DRAFT dengan uang tunai aktual. */
    complete: (businessId, depositId, data) =>
      request(`/api/owner/businesses/${businessId}/cash-deposits/${depositId}/complete`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),

    /** Hapus setoran DRAFT (belum menjadi bukti setoran). */
    deleteDraft: (businessId, depositId) =>
      request(`/api/owner/businesses/${businessId}/cash-deposits/${depositId}`, {
        method: 'DELETE',
      }),

    /** Catat setoran legacy (nominal saja) — dipertahankan untuk kompatibilitas. */
    create: (businessId, data) =>
      request(`/api/owner/businesses/${businessId}/cash-deposits`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    /** Batalkan setoran (append-only; wajib alasan). */
    void: (businessId, depositId, reason) =>
      request(`/api/owner/businesses/${businessId}/cash-deposits/${depositId}/void`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
  },

  /** Histori pergerakan stok (Fase 2, append-only). */
  inventoryMovements: {
    list: (businessId, params = {}) =>
      request(`/api/owner/businesses/${businessId}/inventory-movements${queryString(params)}`),
  },
};
