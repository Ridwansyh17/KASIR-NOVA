/**
 * Seeding data awal — HANYA untuk development.
 *
 * - Membuat SATU akun platform admin (super admin) dari variabel lingkungan.
 * - Opsional: membuat SATU akun owner demo untuk menguji login area Owner.
 *
 * Inilah satu-satunya jalur pembuatan admin platform; TIDAK ada endpoint
 * pendaftaran publik untuk admin. Password diambil dari .env (tidak
 * di-hardcode). Idempoten: aman dijalankan berulang.
 *
 * Jalankan: npm run db:seed
 */
import { query } from '../config/db.js';
import { hashPassword } from '../utils/hash.js';

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@nova.test';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;
const ADMIN_NAME = process.env.SEED_ADMIN_NAME ?? 'Platform Admin';

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL;
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD;
const OWNER_NAME = process.env.SEED_OWNER_NAME ?? 'Owner Demo';

const seedAdmin = async () => {
  if (!ADMIN_PASSWORD) {
    throw new Error('SEED_ADMIN_PASSWORD wajib diisi di .env');
  }

  const existing = await query('SELECT id FROM platform_admins WHERE email = $1', [
    ADMIN_EMAIL,
  ]);
  if (existing.rows.length > 0) {
    console.log(`[seed] Admin platform sudah ada: ${ADMIN_EMAIL} (dilewati)`);
    return existing.rows[0].id;
  }

  const passwordHash = await hashPassword(ADMIN_PASSWORD);
  const { rows } = await query(
    `INSERT INTO platform_admins (email, password_hash, full_name, status)
     VALUES ($1, $2, $3, 'active')
     RETURNING id`,
    [ADMIN_EMAIL, passwordHash, ADMIN_NAME]
  );
  console.log(`[seed] Admin platform dibuat: ${ADMIN_EMAIL}`);
  return rows[0].id;
};

const seedOwner = async (createdBy) => {
  if (!OWNER_EMAIL || !OWNER_PASSWORD) {
    console.log('[seed] SEED_OWNER_EMAIL/PASSWORD kosong — owner demo dilewati.');
    return;
  }

  const existing = await query('SELECT id FROM owners WHERE email = $1', [OWNER_EMAIL]);
  if (existing.rows.length > 0) {
    console.log(`[seed] Owner sudah ada: ${OWNER_EMAIL} (dilewati)`);
    return;
  }

  const passwordHash = await hashPassword(OWNER_PASSWORD);
  await query(
    `INSERT INTO owners (email, password_hash, full_name, phone, status, created_by)
     VALUES ($1, $2, $3, $4, 'active', $5)`,
    [OWNER_EMAIL, passwordHash, OWNER_NAME, null, createdBy]
  );
  console.log(`[seed] Owner demo dibuat: ${OWNER_EMAIL}`);
};

const main = async () => {
  const adminId = await seedAdmin();
  await seedOwner(adminId);
  console.log('[seed] Selesai. Password dev ada di .env — jangan dipakai di produksi.');
};

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed] GAGAL:', err.message);
    process.exit(1);
  });
