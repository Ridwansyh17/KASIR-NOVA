/**
 * Seeding data awal — HANYA untuk development.
 *
 * Membuat SATU akun platform admin (super admin) dari variabel lingkungan.
 * Inilah satu-satunya jalur pembuatan admin platform; TIDAK ada endpoint
 * pendaftaran publik untuk admin.
 *
 * Password diambil dari SEED_ADMIN_PASSWORD (tidak di-hardcode).
 *
 * Jalankan: npm run db:seed
 */
import { query } from '../config/db.js';
import { hashPassword } from '../utils/hash.js';

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@nova.test';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;
const ADMIN_NAME = process.env.SEED_ADMIN_NAME ?? 'Platform Admin';

const main = async () => {
  if (!ADMIN_PASSWORD) {
    console.error('[seed] SEED_ADMIN_PASSWORD wajib diisi di .env');
    console.error('[seed] Contoh: SEED_ADMIN_PASSWORD=ubah_saya_minimal_8_karakter');
    process.exit(1);
  }

  // Cek apakah admin dengan email ini sudah ada (idempoten)
  const { rows } = await query('SELECT id FROM platform_admins WHERE email = $1', [ADMIN_EMAIL]);

  if (rows.length > 0) {
    console.log(`[seed] Admin platform sudah ada: ${ADMIN_EMAIL} (dilewati)`);
    return;
  }

  const passwordHash = await hashPassword(ADMIN_PASSWORD);

  await query(
    `INSERT INTO platform_admins (email, password_hash, full_name, status)
     VALUES ($1, $2, $3, 'active')`,
    [ADMIN_EMAIL, passwordHash, ADMIN_NAME]
  );

  console.log(`[seed] Admin platform dibuat: ${ADMIN_EMAIL}`);
  console.log('[seed] Simpan password ini di tempat aman. Jangan gunakan di produksi.');
};

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed] GAGAL:', err.message);
    process.exit(1);
  });
