/**
 * Bersihkan fixture tes yang tertinggal dari run yang TERPUTUS.
 *
 * Dijalankan otomatis SEBELUM `npm test` (lewat `pretest`). Ini membuat suite
 * tes idempoten: bila sebuah run gagal/dihentikan di tengah (mis. timeout),
 * baris `uji-*@nova.test` yang belum terhapus tidak lagi meracuni run berikutnya.
 *
 * KEAMANAN:
 *   - Hanya menyentuh akun berdomain `@nova.test` (domain khusus UJI).
 *   - Akun seed aplikasi dev SELALU dipertahankan: SEED_ADMIN_EMAIL /
 *     SEED_OWNER_EMAIL (default admin@nova.test / owner@nova.test).
 *   - Data ber-email asli (bukan @nova.test) TIDAK disentuh.
 *
 * Cascade: `owners` → businesses → outlets/cashiers/products/stocks/
 * transactions (skema memakai ON DELETE CASCADE). refresh_tokens & audit_logs
 * dihapus eksplisit karena tidak ikut cascade.
 *
 * Jalankan manual: node scripts/clean-test-fixtures.mjs
 */
import { query, pool } from '../src/config/db.js';

const PRESERVE = new Set(
  [
    process.env.SEED_ADMIN_EMAIL ?? 'admin@nova.test',
    process.env.SEED_OWNER_EMAIL ?? 'owner@nova.test',
    'admin@nova.test',
    'owner@nova.test',
  ].filter(Boolean)
);

const isFixture = (email) =>
  typeof email === 'string' && email.toLowerCase().endsWith('@nova.test') && !PRESERVE.has(email);

const delOwners = async (ids) => {
  if (!ids.length) return 0;
  await query('DELETE FROM refresh_tokens WHERE user_role = $1 AND user_id = ANY($2::uuid[])', [
    'owner',
    ids,
  ]);
  await query('DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])', [ids]);
  const r = await query('DELETE FROM owners WHERE id = ANY($1::uuid[])', [ids]);
  return r.rowCount;
};

const delAdmins = async (ids) => {
  if (!ids.length) return 0;
  await query(
    'DELETE FROM refresh_tokens WHERE user_role = $1 AND user_id = ANY($2::uuid[])',
    ['platform_admin', ids]
  );
  await query('DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])', [ids]);
  const r = await query('DELETE FROM platform_admins WHERE id = ANY($1::uuid[])', [ids]);
  return r.rowCount;
};

const main = async () => {
  // Hapus owners dulu (mereka mungkin mereferensikan platform_admins.created_by).
  const owners = (await query('SELECT id, email FROM owners')).rows.filter((r) => isFixture(r.email));
  const admins = (await query('SELECT id, email FROM platform_admins')).rows.filter((r) =>
    isFixture(r.email)
  );

  const o = await delOwners(owners.map((r) => r.id));
  const a = await delAdmins(admins.map((r) => r.id));

  if (o || a) {
    console.log(`[clean-test-fixtures] sisa dihapus: owners=${o} admins=${a}`);
  } else {
    console.log('[clean-test-fixtures] tidak ada sisa fixture.');
  }
  console.log(`[clean-test-fixtures] dipertahankan: ${[...PRESERVE].join(', ')}`);
};

main()
  .then(() => pool.end())
  .catch(async (err) => {
    // Fail-soft: jangan blokir tes bila DB belum siap; biarkan tes melaporkan
    // error koneksinya sendiri dengan jelas.
    console.warn(`[clean-test-fixtures] dilewati (${err.message})`);
    try {
      await pool.end();
    } catch {
      /* abaikan */
    }
    process.exit(0);
  });
