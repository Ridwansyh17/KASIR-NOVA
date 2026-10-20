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
import { hashPassword, verifyPassword, verifyPin } from '../../utils/hash.js';
import { writeAudit } from '../audit/service.js';
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
            o.address AS outlet_address, o.phone AS outlet_phone,
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
      address: rows[0].outlet_address,
      phone: rows[0].outlet_phone,
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
 * Login PIN kasir (Fase 10b).
 *
 * Aturan (keputusan pemilik):
 *   - PIN 4 digit, opsional; salah -> 401 seragam (anti-enumerasi).
 *   - Lockout di server, atomik per percobaan: 5x salah -> kunci sementara
 *     15 menit (429 + retryAfterSeconds); 10x salah -> status 'locked'
 *     (403, hanya Owner yang membuka via endpoint unlock).
 *   - Kasir yang `pin_hash`-nya NULL (belum diberi PIN) tidak bisa lewat PIN.
 */
export const loginCashierWithPin = async ({ cashierId, pin, ip, userAgent }) => {
  const { rows } = await query(
    `SELECT c.id, c.email, c.full_name, c.status, c.pin_hash,
            c.pin_locked_until, c.pin_failed_attempts,
            o.id AS outlet_id, o.status AS outlet_status,
            b.status AS business_status
       FROM cashiers c
       JOIN outlets o ON o.id = c.outlet_id
       JOIN businesses b ON b.id = o.business_id
      WHERE c.id = $1 AND o.deleted_at IS NULL AND b.deleted_at IS NULL`,
    [cashierId]
  );
  const cashier = rows[0];

  // Pesan seragam agar tidak ter-enumerasi keberadaan akun.
  if (!cashier || !cashier.pin_hash) {
    throw new UnauthorizedError('Kasir atau PIN tidak valid');
  }
  if (cashier.status === 'locked') {
    throw new AppError('Kasir terkunci. Mintalah Owner membuka kunci.', 403);
  }
  if (cashier.status !== 'active' || cashier.outlet_status !== 'active' || cashier.business_status !== 'active') {
    throw new AppError('Akun Anda dinonaktifkan. Hubungi administrator.', 403);
  }

  // Kunci sementara masih aktif -> 429 + berapa detik lagi tersedia.
  if (cashier.pin_locked_until && new Date(cashier.pin_locked_until) > new Date()) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((new Date(cashier.pin_locked_until) - new Date()) / 1000)
    );
    throw new AppError('Terlalu banyak percobaan PIN. Coba lagi nanti.', 429, {
      retryAfterSeconds,
    });
  }

  const pinOk = await verifyPin(pin, cashier.pin_hash);
  if (!pinOk) {
    // Kenaikan atomik + kunci sementara/status locked dalam SATU statement.
    const { rows: fail } = await query(
      `UPDATE cashiers
          SET pin_failed_attempts = pin_failed_attempts + 1,
              pin_locked_until = CASE
                WHEN pin_failed_attempts + 1 >= 10 THEN NULL
                WHEN pin_failed_attempts + 1 >= 5
                  THEN now() + interval '15 minutes'
                ELSE pin_locked_until
              END,
              status = CASE
                WHEN pin_failed_attempts + 1 >= 10 THEN 'locked'::account_status
                ELSE status
              END
        WHERE id = $1
        RETURNING pin_failed_attempts, pin_locked_until, status`,
      [cashierId]
    );
    const after = fail[0];
    if (after.status === 'locked') {
      throw new AppError('Kasir terkunci. Mintalah Owner membuka kunci.', 403);
    }
    if (after.pin_failed_attempts >= 5) {
      throw new AppError('Terlalu banyak percobaan PIN. Coba lagi nanti.', 429, {
        retryAfterSeconds: 900,
      });
    }
    throw new UnauthorizedError('Kasir atau PIN tidak valid');
  }

  // Sukses: reset penghitung lockout, lalu terbitkan sesi seperti login biasa.
  await query(
    `UPDATE cashiers SET pin_failed_attempts = 0, pin_locked_until = NULL WHERE id = $1`,
    [cashierId]
  );
  const { accessToken, refreshToken } = await issueTokens({
    role: 'cashier',
    userId: cashier.id,
    ip,
    userAgent,
  });

  return {
    accessToken,
    refreshToken,
    user: { id: cashier.id, email: cashier.email, fullName: cashier.full_name, role: 'cashier' },
  };
};

/**
 * Kartu kasir untuk layar pemilih PIN (publik, scoped per outlet).
 * Hanya kasir AKTIF yang SUDAH punya PIN yang muncul — nama saja, tanpa
 * email/password. Outlet diidentifikasi via UUID (tidak dapat ditebak).
 */
export const listPinCashiers = async ({ outletId }) => {
  const { rows } = await query(
    `SELECT c.id, c.full_name
       FROM cashiers c
       JOIN outlets o ON o.id = c.outlet_id
       JOIN businesses b ON b.id = o.business_id
      WHERE c.outlet_id = $1
        AND o.deleted_at IS NULL AND b.deleted_at IS NULL
        AND c.status = 'active'
        AND c.pin_hash IS NOT NULL
      ORDER BY c.full_name ASC`,
    [outletId]
  );
  return rows;
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

/**
 * Ganti sandi sendiri (Keputusan #5).
 *
 * Aturan:
 *   - wajib verifikasi sandi lama (mencegah pengambilalihan sesi pasif);
 *   - setelah sukses, SEMUA refresh token pengguna dicabut KECUALI sesi
 *     perangkat yang dipakai mengganti (bila `refreshToken` dikirim), sehingga
 *     perangkat/peramban lain dipaksa login ulang;
 *   - perubahan + pencabutan + audit terjadi dalam SATU transaksi DB.
 *
 * @param {object} p
 * @param {'platform_admin'|'owner'|'cashier'} p.role
 * @param {string} p.userId
 * @param {string} p.currentPassword
 * @param {string} p.newPassword
 * @param {string|null} [p.refreshToken] sesi perangkat ini yang dipertahankan
 * @param {string|null} [p.ip]
 * @returns {Promise<{sessionsRevoked:number}>}
 */
export const changePassword = async ({
  role,
  userId,
  currentPassword,
  newPassword,
  refreshToken = null,
  ip = null,
}) => {
  const store = USER_STORES[role];
  if (!store) throw new AppError('Peran tidak didukung', 400);

  const { rows } = await query(
    `SELECT id, password_hash, status FROM ${store.table} WHERE id = $1`,
    [userId]
  );
  const account = rows[0];
  if (!account) throw new UnauthorizedError('Sesi tidak valid');
  if (account.status !== 'active') {
    throw new AppError('Akun Anda dinonaktifkan. Hubungi administrator.', 403);
  }

  const currentOk = await verifyPassword(currentPassword, account.password_hash);
  if (!currentOk) throw new AppError('Sandi saat ini salah', 400);
  if (currentPassword === newPassword) {
    throw new AppError('Sandi baru harus berbeda dari sandi saat ini', 422);
  }

  const newHash = await hashPassword(newPassword);
  const keepHash = refreshToken ? hashRefreshToken(refreshToken) : null;

  const sessionsRevoked = await withTransaction(async (client) => {
    await client.query(
      `UPDATE ${store.table} SET password_hash = $1 WHERE id = $2`,
      [newHash, userId]
    );

    const { rowCount } = await client.query(
      `UPDATE refresh_tokens
          SET revoked_at = now()
        WHERE user_role = $1 AND user_id = $2 AND revoked_at IS NULL
          AND ($3::text IS NULL OR token_hash <> $3)`,
      [role, userId, keepHash]
    );

    await writeAudit({
      client,
      actorRole: role,
      actorId: userId,
      action: 'auth.change_password',
      entityType: role,
      entityId: userId,
      ip,
    });

    return rowCount;
  });

  return { sessionsRevoked };
};

export default {
  login,
  refresh,
  logout,
  getUserById,
  getCashierContext,
  isRoleSupported,
  revokeAllSessions,
  changePassword,
  SUPPORTED_ROLES,
};
