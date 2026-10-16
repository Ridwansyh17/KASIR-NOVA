/**
 * Buat/perbarui akun Admin Platform & Owner (seeding internal yang terkontrol).
 *
 * Mengapa lewat skrip ini?
 * - Admin Platform TIDAK dibuat lewat pendaftaran publik (keputusan proyek).
 * - Password di-hash memakai util aplikasi yang sama (server/src/utils/hash.js)
 *   sehingga login dijamin cocok.
 *
 * Pemakaian (dari root repo):
 *   # dev lokal (default: server/.env -> localhost:5433/nova_kasir_dev)
 *   node scripts/create-accounts.mjs \
 *     --admin-email admin.ridwan@nova.test --admin-name Ridwan \
 *     --owner-email ridwan@nova.test      --owner-name Ridwan
 *
 *   # produksi (root .env -> Neon branch "production")
 *   node scripts/create-accounts.mjs --env .env --owner-email ... --owner-name ...
 *
 * Opsi:
 *   --env <path>             berkas env (default: server/.env)
 *   --password <pwd>         password sama untuk semua akun yang dibuat
 *   --admin-password <pwd>   password khusus Admin Platform
 *   --owner-password <pwd>   password khusus Owner
 *   --force                  bila email sudah ada: perbarui nama + password
 *   --admin-only / --owner-only
 *
 * Idempoten: email yang sudah ada dilewati (kecuali --force). Password acak
 * kuat ditampilkan SEKALI; verifikasi hash dilakukan sebelum melaporkan sukses.
 */
import { readFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import pg from 'pg';
import { hashPassword, verifyPassword } from '../server/src/utils/hash.js';

// --- Argumen ------------------------------------------------------------------
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const flag = (name) => args.includes(name);

const ADMIN_EMAIL = opt('--admin-email');
const ADMIN_NAME = opt('--admin-name', 'Ridwan');
const OWNER_EMAIL = opt('--owner-email');
const OWNER_NAME = opt('--owner-name', 'Ridwan');
const SHARED_PASSWORD = opt('--password');
const ADMIN_PASSWORD = opt('--admin-password');
const OWNER_PASSWORD = opt('--owner-password');
const ENV_FILE = opt('--env', 'server/.env');
const FORCE = flag('--force');
const ADMIN_ONLY = flag('--admin-only');
const OWNER_ONLY = flag('--owner-only');

if (!ADMIN_EMAIL && !OWNER_EMAIL) {
  console.error('ERROR: beri minimal --admin-email dan/atau --owner-email');
  process.exit(1);
}

// --- Env ----------------------------------------------------------------------
const root = process.cwd();
const raw = readFileSync(ENV_FILE, 'utf8');
const env = {};
for (const line of raw.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
if (!env.DATABASE_URL) {
  console.error(`ERROR: DATABASE_URL tidak ada di ${ENV_FILE}`);
  process.exit(1);
}
console.log('Env file  :', ENV_FILE);
console.log('Target DB :', /neon\.tech/.test(env.DATABASE_URL) ? 'Neon (produksi/remote)' : 'lokal/other');

// --- Password acak kuat (tanpa karakter ambigu) --------------------------------
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGIT = '23456789';
const SYM = '@#%+=!?*-_';
const ALL = LOWER + UPPER + DIGIT + SYM;
const pick = (set) => set[randomInt(set.length)];
const makePassword = (len = 16) => {
  const chars = [pick(LOWER), pick(UPPER), pick(DIGIT), pick(SYM)];
  while (chars.length < len) chars.push(pick(ALL));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
};

const client = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: /neon\.tech|sslmode=require/.test(env.DATABASE_URL) ? { rejectUnauthorized: false } : undefined,
});
await client.connect();

const upsert = async ({ table, email, name, label, password: fixed }) => {
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error(`ERROR: email tidak valid: ${email}`);
    process.exit(1);
  }

  const existing = await client.query(
    `SELECT id, full_name FROM ${table} WHERE lower(email) = lower($1)`,
    [email]
  );
  if (existing.rows.length && !FORCE) {
    console.log(`SKIP    ${label} <${email}> sudah ada (nama: ${existing.rows[0].full_name}). Pakai --force untuk memperbarui.`);
    return null;
  }

  const password = fixed ?? SHARED_PASSWORD ?? makePassword(16);
  const hash = await hashPassword(password);

  if (existing.rows.length) {
    await client.query(
      `UPDATE ${table} SET password_hash = $1, full_name = $2, updated_at = now() WHERE id = $3`,
      [hash, name, existing.rows[0].id]
    );
    console.log(`UPDATED ${label} <${email}> (nama: ${name})`);
  } else {
    await client.query(
      `INSERT INTO ${table} (email, password_hash, full_name, status) VALUES ($1, $2, $3, 'active')`,
      [email, hash, name]
    );
    console.log(`CREATED ${label} <${email}> (nama: ${name})`);
  }

  // Verifikasi: hash tersimpan benar-benar cocok dengan password (scrypt).
  const verify = await client.query(`SELECT password_hash FROM ${table} WHERE lower(email) = lower($1)`, [email]);
  const ok = await verifyPassword(password, verify.rows[0].password_hash);
  console.log(`        verifikasi hash: ${ok ? 'OK' : 'GAGAL'}`);
  if (!ok) process.exit(1);

  return { email, label, name, password, generated: !fixed && !SHARED_PASSWORD };
};

const results = [];
if (ADMIN_EMAIL && !OWNER_ONLY) {
  results.push(
    await upsert({ table: 'platform_admins', email: ADMIN_EMAIL, name: ADMIN_NAME, label: 'Admin Platform', password: ADMIN_PASSWORD })
  );
}
if (OWNER_EMAIL && !ADMIN_ONLY) {
  results.push(
    await upsert({ table: 'owners', email: OWNER_EMAIL, name: OWNER_NAME, label: 'Owner', password: OWNER_PASSWORD })
  );
}

await client.end();

const created = results.filter(Boolean);
if (created.length) {
  console.log('\n=== KREDENSIAL (ditampilkan sekali — segera ganti setelah login) ===');
  for (const r of created) {
    console.log(`${r.label.padEnd(15)} | ${r.email} | ${r.password}`);
  }
}
