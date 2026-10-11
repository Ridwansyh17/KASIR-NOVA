/**
 * Layanan autentikasi & sesi.
 *
 * Menangani pencarian pengguna per peran, verifikasi password, penerbitan
 * token, rotasi refresh token, dan pencabutan sesi.
 *
 * Arsitektur peran: `USER_STORES` memetakan peran -> tabel pengguna. Fase 1
 * mengaktifkan platform_admin & owner; Fase 5 menambahkan 'cashier'
 * (tabel `cashiers`) tanpa mengubah alur di sini.
 */
import { query, withTransaction } from '../../config/db.js';
import { verifyPassword } from '../../utils/hash.js';
import {
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiryMs,
} from '../../utils/token.js';
import { AppError, UnauthorizedError } from '../../middleware/error.js';

/**
 * Peta peran -> tabel pengguna yang didukung.
 * Nilai `table` adalah konstanta hardcode (bukan input pengguna), sehingga
 * aman diinterpolasi ke SQL.
 */
const USER_STORES = {
  platform_admin: { table: 'platform_admins', label: 'Admin Platform' },
  owner: { table: 'owners', label: 'Owner' },
  cashier: { table: 'cashiers', label: 'Kasir' }, // diaktifkan di Fase 5
};

export const SUPPORTED_ROLES = Object.keys(USER_STORES);

/** Apakah peran didukung modul auth saat ini. */
export const isRoleSupported = (role) => SUPPORTED_ROLES.includes(role);

// Hash dummy (format scrypt valid) agar verifikasi tetap berjalan saat email
// tidak ditemukan -> waktu respons seragam, mencegah enumerasi akun.
const DUMMY_HASH = `scrypt:32768:8:1:${'00'.repeat(32)}:${'00'.repeat(64)}`;

/**
 * Ambil pengguna (tanpa password) berdasarkan peran & id.
 * @returns {Promise<{id:string,email:string,full_name:string,status:string}|null>}
 */
export const getUserById = async (role, id) => {
  const store = USER_STORES[role];
  if (!store) return null;
  const { rows } = await query(
    `SELECT id, email, full_name, status FROM ${store.table} WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
};

/** Ambil pengguna termasuk password_hash (khusus login). */
const findUserWithSecret = async (role, email) => {
  const store = USER_STORES[role];
  if (!store) return null;
  const { rows } = await query(
    `SELECT id, email, password_hash, full_name, status
       FROM ${store.table}
      WHERE lower(email) = lower($1)
      LIMIT 1`,
    [email]
  );
  return rows[0] ?? null;
};

/**
 * Konteks kasir untuk `/me`: outlet + bisnis yang ditetapkan.
 * Dipakai panel Kasir dan penegakan tenant di sisi klien (server tetap
 * memverifikasi kepemilikan pada setiap operasi penting).
 */
export const getCashierContext = async (cashierId) => {
  const { rows } = await query(
    `SELECT o.id AS outlet_id, o.name AS outlet_name,
            o.tax_rate, o.tax_inclusive,
            b.id AS business_id, b.name AS business_name, b.currency
       FROM cashiers c
       JOIN outlets o ON o.id = c.outlet_id
       JOIN businesses b ON b.id = o.business_id
      WHERE c.id = $1`,
    [cashierId]
  );
  if (!rows[0]) return null;
  return {
    outlet: {
      id: rows[0].outlet_id,
      name: rows[0].outlet_name,
      tax_rate: Number(rows[0].tax_rate),
      tax_inclusive: rows[0].tax_inclusive,
    },
    business: { id: rows[0].business_id, name: rows[0].business_name, currency: rows[0].currency },
  };
};

/**
 * Terbitkan pasangan token baru & simpan HASH refresh ke DB.
 * Bila `client` diberikan, query ikut dalam transaksi pemanggil.
 */
const issueTokens = async ({ role, userId, ip, userAgent, client }) => {
  const accessToken = signAccessToken({ userId, role });
  const refreshToken = generateRefreshToken();
  const tokenHash = hashRefreshToken(refreshToken);
  const expiresAt = new Date(Date.now() + refreshTokenExpiryMs());

  const sql = `INSERT INTO refresh_tokens (user_role, user_id, token_hash, expires_at, ip, user_agent)
               VALUES ($1, $2, $3, $4, $5, $6)`;
  const params = [role, userId, tokenHash, expiresAt, ip ?? null, userAgent ?? null];

  if (client) await client.query(sql, params);
  else await query(sql, params);

  return { accessToken, refreshToken };
};

/**
 * Login per peran.
 * @throws {AppError} 404 peran belum aktif, 401 kredensial salah, 403 akun nonaktif
 */
export const login = async ({ role, email, password, ip, userAgent }) => {
  if (!isRoleSupported(role)) {
    throw new AppError(`Login peran '${role}' belum tersedia pada fase ini`, 404);
  }

  const user = await findUserWithSecret(role, email);

  // Selalu verifikasi (pakai hash dummy bila user tak ada) agar waktu respons
  // seragam terhadap keberadaan akun.
  const stored = user?.password_hash ?? DUMMY_HASH;
  const passwordOk = await verifyPassword(password, stored);

  if (!user || !passwordOk) {
    throw new UnauthorizedError('Email atau password salah');
  }
  if (user.status !== 'active') {
    throw new AppError('Akun Anda dinonaktifkan. Hubungi administrator.', 403);
  }

  const { accessToken, refreshToken } = await issueTokens({
    role,
    userId: user.id,
    ip,
    userAgent,
  });

  return {
    accessToken,
    refreshToken,
    user: { id: user.id, email: user.email, fullName: user.full_name, role },
  };
};

/**
 * Rotasi refresh token (sekali pakai): cabut token lama, terbitkan pasangan
 * baru secara ATOMIK. Refresh token lama langsung tidak berlaku.
 */
export const refresh = async ({ refreshToken }) => {
  const tokenHash = hashRefreshToken(refreshToken);

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, user_role, user_id, expires_at, revoked_at
         FROM refresh_tokens
        WHERE token_hash = $1
        FOR UPDATE`,
      [tokenHash]
    );

    const record = rows[0];
    if (!record) throw new UnauthorizedError('Refresh token tidak valid');
    if (record.revoked_at) throw new UnauthorizedError('Refresh token sudah dicabut');
    if (new Date(record.expires_at) <= new Date()) {
      throw new UnauthorizedError('Refresh token kedaluwarsa');
    }

    const store = USER_STORES[record.user_role];
    if (!store) throw new UnauthorizedError('Peran tidak dikenal');

    const { rows: userRows } = await client.query(
      `SELECT id, email, full_name, status FROM ${store.table} WHERE id = $1`,
      [record.user_id]
    );
    const account = userRows[0];
    if (!account) throw new UnauthorizedError('Akun tidak ditemukan');
    if (account.status !== 'active') throw new UnauthorizedError('Akun Anda dinonaktifkan');

    // Rotasi atomik di dalam transaksi yang sama
    await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [
      record.id,
    ]);
    const { accessToken, refreshToken: newRefresh } = await issueTokens({
      role: record.user_role,
      userId: record.user_id,
      client,
    });

    return {
      accessToken,
      refreshToken: newRefresh,
      user: {
        id: account.id,
        email: account.email,
        fullName: account.full_name,
        role: record.user_role,
      },
    };
  });
};

/**
 * Logout: cabut satu refresh token (sesi tunggal). Idempoten — token yang tak
 * dikenal tetap dianggap sukses agar tidak membocorkan keberadaan token.
 */
export const logout = async ({ refreshToken, userId, role }) => {
  const tokenHash = hashRefreshToken(refreshToken);
  const { rowCount } = await query(
    `UPDATE refresh_tokens
        SET revoked_at = now()
      WHERE token_hash = $1 AND user_id = $2 AND user_role = $3 AND revoked_at IS NULL`,
    [tokenHash, userId, role]
  );
  return { revoked: rowCount > 0 };
};

/**
 * Cabut SEMUA sesi aktif milik seorang pengguna.
 * Dipakai manajemen sesi (Fase 11) / pemaksaan logout oleh admin.
 */
export const revokeAllSessions = async (role, userId) => {
  const { rowCount } = await query(
    `UPDATE refresh_tokens
        SET revoked_at = now()
      WHERE user_role = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [role, userId]
  );
  return rowCount;
};

export default {
  login,
  refresh,
  logout,
  getUserById,
  getCashierContext,
  isRoleSupported,
  revokeAllSessions,
  SUPPORTED_ROLES,
};
