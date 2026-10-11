/**
 * Hash & verifikasi password memakai scrypt bawaan Node (node:crypto).
 *
 * Mengapa scrypt, bukan bcrypt/argon2?
 * - Tidak butuh dependency native (addon C++) yang sering gagal di Windows
 *   tanpa Visual Studio Build Tools.
 * - Aman terhadap serangan rainbow table & GPU (memory-hard).
 * - Ringan untuk RAM ~2 GB.
 *
 * Format penyimpanan: `scrypt:N:r:p:saltHex:hashHex` (semua parameter disimpan
 * agar verifikasi tetap benar walau default berubah).
 */
import { scrypt as scryptCallback, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

// Parameter: N=2^15 (~32MB per hash), r=8, p=1.
// N dipilih 2^15 (bukan 2^16) karena Node 24 membatasi memori scrypt bawaan
// OpenSSL ke ~32MB. Tetap memory-hard terhadap serangan GPU.
const PARAMS = { N: 2 ** 15, r: 8, p: 1 };
const KEY_LEN = 64;
const SALT_LEN = 32;

// maxmem dinaikkan ke 128MB; default Node (~32MB) terlalu kecil untuk N>=2^15.
const MAXMEM = 128 * 1024 * 1024;

/**
 * Hash password.
 * @param {string} password - plain password dari user
 * @returns {Promise<string>} string `scrypt:N:r:p:salt:hash`
 */
export const hashPassword = async (password) => {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Password minimal 8 karakter');
  }
  const salt = randomBytes(SALT_LEN);
  const derived = await scrypt(password, salt, KEY_LEN, { ...PARAMS, maxmem: MAXMEM });
  return `scrypt:${PARAMS.N}:${PARAMS.r}:${PARAMS.p}:${salt.toString('hex')}:${derived.toString('hex')}`;
};

/**
 * Verifikasi password terhadap hash (konstan-waktu).
 * @param {string} password - plain password
 * @param {string} stored - format `scrypt:N:r:p:salt:hash`
 * @returns {Promise<boolean>}
 */
export const verifyPassword = async (password, stored) => {
  if (!password || !stored) return false;

  const parts = stored.split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    console.warn('[hash] format hash tidak dikenali');
    return false;
  }

  const [, n, r, p, saltHex, hashHex] = parts;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');

  const derived = await scrypt(password, salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: MAXMEM,
  });

  // timingSafeEqual butuh panjang sama; cek dulu
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
};

/**
 * Hash PIN (4-6 digit) untuk login cepat kasir: format `pin:N:r:p:salt:hash`.
 * PIN bukan pengganti password; verifikasi PIN ditambahkan saat area kasir
 * memakai login PIN (fase selanjutnya).
 */
export const hashPin = async (pin) => {
  if (typeof pin !== 'string' || !/^\d{4,6}$/.test(pin)) {
    throw new Error('PIN harus 4–6 digit angka');
  }
  const salt = randomBytes(SALT_LEN);
  const derived = await scrypt(pin, salt, KEY_LEN, { ...PARAMS, maxmem: MAXMEM });
  return `pin:${PARAMS.N}:${PARAMS.r}:${PARAMS.p}:${salt.toString('hex')}:${derived.toString('hex')}`;
};

export default { hashPassword, verifyPassword, hashPin };
