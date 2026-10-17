/**
 * admin-account.mjs — kelola akun Admin Platform (tabel `platform_admins`).
 *
 * MENGAPA SKRIP INI ADA
 *   Akun Admin Platform tidak dapat dibuat/diubah dari aplikasi (hanya lewat
 *   `db:seed` saat instalasi pertama). Skrip ini menutup celah itu secara
 *   terkendali: idempoten (aman dijalankan berulang), dapat dipakai untuk
 *   lingkungan dev maupun produksi, dan TIDAK PERNAH mencetak sandi.
 *
 * KEAMANAN
 *   - Sandi hanya dibaca dari lingkungan (bukan argumen CLI, karena argumen
 *     terlihat di daftar proses / riwayat shell):
 *       NOVA_ADMIN_PASSWORD       isi sandi langsung
 *       NOVA_ADMIN_PASSWORD_FILE  path berkas berisi sandi; hanya akhir baris
 *                                 (\r?\n) yang dipangkas — spasi tetap dianggap
 *                                 bagian sandi
 *   - Sandi ditolak bila < 8 atau > 200 karakter (sama dengan aturan API).
 *   - Melihat/mengubah data produksi wajib eksplisit: bila DATABASE_URL tidak
 *     menunjuk host lokal, skrip berhenti kecuali diberi `--allow-production`.
 *   - Mencabut seluruh sesi (`refresh_tokens`) saat sandi diganti atau akun
 *     disuspend, supaya sesi lama tidak tetap hidup.
 *   - Perubahan penting dicatat ke `audit_logs` (tanpa sandi, hanya email/nama/
 *     status). Karena berjalan di luar HTTP, kolom `ip` diisi `cli`.
 *
 * PEMAKAIAN (dari folder `server/`)
 *   node scripts/admin-account.mjs list
 *   node scripts/admin-account.mjs create      # NOVA_ADMIN_EMAIL, NOVA_ADMIN_PASSWORD[, NOVA_ADMIN_NAME]
 *   node scripts/admin-account.mjs create --force   # akun sudah ada: ganti sandi + nama
 *   node scripts/admin-account.mjs password    # NOVA_ADMIN_EMAIL, NOVA_ADMIN_PASSWORD
 *   node scripts/admin-account.mjs status      # NOVA_ADMIN_EMAIL, NOVA_ADMIN_STATUS=active|suspended
 *
 *   Tambahkan `--allow-production` bila DATABASE_URL memang basis data produksi.
 *
 * Contoh (PowerShell, sandi dari berkas agar tidak bocor ke riwayat perintah):
 *   $env:NOVA_ADMIN_EMAIL='admin.ridwan@nova.test'
 *   $env:NOVA_ADMIN_PASSWORD_FILE="$env:TEMP\nova-admin-pw.txt"
 *   npm.cmd run admin:create
 */
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { query, withTransaction } from '../src/config/db.js';
import { hashPassword } from '../src/utils/hash.js';
import { writeAudit } from '../src/modules/audit/service.js';

export const COMMANDS = ['list', 'create', 'password', 'status'];
export const STATUSES = ['active', 'suspended'];
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;
const MAX_EMAIL = 320;
const DEFAULT_NAME = 'Platform Admin';

/** Host yang dianggap lokal (aman untuk diubah tanpa izin tambahan). */
export const isLocalDatabase = (databaseUrl) => {
  try {
    const host = new URL(String(databaseUrl)).hostname.toLowerCase();
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.endsWith('.local')
    );
  } catch {
    return false;
  }
};

/** Nama host saja (TANPA kredensial) untuk ditampilkan ke operator. */
export const databaseHost = (databaseUrl) => {
  try {
    const url = new URL(String(databaseUrl));
    return `${url.hostname}${url.port ? `:${url.port}` : ''}`;
  } catch {
    return '(tidak terbaca)';
  }
};

/** Email selalu disimpan huruf kecil (login sendiri tidak peka huruf besar/kecil). */
export const normalizeEmail = (email) => String(email ?? '').trim().toLowerCase();

export const assertEmail = (email) => {
  const value = normalizeEmail(email);
  if (!value || value.length > MAX_EMAIL || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error(`Email tidak valid: ${value || '(kosong)'}`);
  }
  return value;
};

export const assertPassword = (password) => {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    throw new Error(`Sandi minimal ${MIN_PASSWORD} karakter`);
  }
  if (password.length > MAX_PASSWORD) {
    throw new Error(`Sandi maksimal ${MAX_PASSWORD} karakter`);
  }
  return password;
};

export const assertFullName = (fullName) => {
  const value = String(fullName ?? '').trim() || DEFAULT_NAME;
  if (value.length < 2 || value.length > 120) {
    throw new Error('Nama minimal 2 dan maksimal 120 karakter');
  }
  return value;
};

/**
 * Ambil sandi dari lingkungan. Utamakan berkas (aman untuk karakter khusus
 * seperti `$`, kutip, atau backtick yang akan rusak bila lewat shell).
 */
export const readPasswordFromEnv = (envVars = process.env) => {
  const file = envVars.NOVA_ADMIN_PASSWORD_FILE;
  if (file) {
    let raw;
    try {
      raw = readFileSync(file, 'utf8');
    } catch (err) {
      throw new Error(`Gagal membaca NOVA_ADMIN_PASSWORD_FILE (${file}): ${err.message}`);
    }
    // Hanya akhir baris yang dipangkas; spasi awal/akhir tetap bagian sandi.
    return raw.replace(/\r?\n$/, '');
  }
  return envVars.NOVA_ADMIN_PASSWORD ?? null;
};

// ------------------------------------------------------------------ operasi DB

export const listAdmins = async () => {
  const { rows } = await query(
    `SELECT id, email, full_name, status, created_at, updated_at
       FROM platform_admins
      ORDER BY created_at`
  );
  return rows;
};

export const findAdmin = async (email) => {
  const { rows } = await query(
    `SELECT id, email, full_name, status
       FROM platform_admins
      WHERE lower(email) = lower($1)`,
    [email]
  );
  return rows[0] ?? null;
};

const revokeSessions = async (client, adminId) => {
  const r = await client.query(
    `DELETE FROM refresh_tokens WHERE user_role = 'platform_admin' AND user_id = $1`,
    [adminId]
  );
  return r.rowCount ?? 0;
};

/**
 * Buat akun admin (idempoten).
 * - Akun belum ada  → dibuat dengan status `active`.
 * - Akun sudah ada  → TIDAK diubah (aman dari salah ketik), kecuali `force`.
 * @returns {Promise<{created:boolean, updated:boolean, admin:object|null, revoked:number}>}
 */
export const createAdmin = async ({ email, password, fullName, force = false }) => {
  const mail = assertEmail(email);
  assertPassword(password);
  const name = assertFullName(fullName);

  const existing = await findAdmin(mail);
  if (existing && !force) {
    return { created: false, updated: false, admin: existing, revoked: 0 };
  }

  const passwordHash = await hashPassword(password);

  return withTransaction(async (client) => {
    if (existing) {
      const { rows } = await client.query(
        `UPDATE platform_admins
            SET password_hash = $1, full_name = $2
          WHERE id = $3
        RETURNING id, email, full_name, status`,
        [passwordHash, name, existing.id]
      );
      const revoked = await revokeSessions(client, existing.id);
      await writeAudit({
        client,
        actorRole: 'platform_admin',
        actorId: existing.id,
        action: 'platform_admin.password_reset',
        entityType: 'platform_admin',
        entityId: existing.id,
        before: { full_name: existing.full_name, status: existing.status },
        after: { full_name: name, status: existing.status, source: 'cli' },
        ip: 'cli',
      });
      return { created: false, updated: true, admin: rows[0], revoked };
    }

    const { rows } = await client.query(
      `INSERT INTO platform_admins (email, password_hash, full_name, status)
       VALUES ($1, $2, $3, 'active')
       RETURNING id, email, full_name, status`,
      [mail, passwordHash, name]
    );
    await writeAudit({
      client,
      actorRole: 'platform_admin',
      actorId: rows[0].id,
      action: 'platform_admin.created',
      entityType: 'platform_admin',
      entityId: rows[0].id,
      after: { email: rows[0].email, full_name: rows[0].full_name, status: rows[0].status, source: 'cli' },
      ip: 'cli',
    });
    return { created: true, updated: false, admin: rows[0], revoked: 0 };
  });
};

/** Ganti sandi akun yang sudah ada + cabut sesi lamanya. */
export const setAdminPassword = async ({ email, password }) => {
  const mail = assertEmail(email);
  assertPassword(password);

  const existing = await findAdmin(mail);
  if (!existing) {
    throw new Error(`Akun admin tidak ditemukan: ${mail}`);
  }

  const passwordHash = await hashPassword(password);

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE platform_admins SET password_hash = $1 WHERE id = $2
       RETURNING id, email, full_name, status`,
      [passwordHash, existing.id]
    );
    const revoked = await revokeSessions(client, existing.id);
    await writeAudit({
      client,
      actorRole: 'platform_admin',
      actorId: existing.id,
      action: 'platform_admin.password_reset',
      entityType: 'platform_admin',
      entityId: existing.id,
      before: { full_name: existing.full_name, status: existing.status },
      after: { full_name: existing.full_name, status: existing.status, source: 'cli' },
      ip: 'cli',
    });
    return { admin: rows[0], revoked };
  });
};

/** Ubah status akun (`active`/`suspended`); suspend selalu mencabut sesi. */
export const setAdminStatus = async ({ email, status }) => {
  const mail = assertEmail(email);
  const value = String(status ?? '').trim().toLowerCase();
  if (!STATUSES.includes(value)) {
    throw new Error(`Status harus salah satu dari: ${STATUSES.join(', ')}`);
  }

  const existing = await findAdmin(mail);
  if (!existing) {
    throw new Error(`Akun admin tidak ditemukan: ${mail}`);
  }

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE platform_admins SET status = $1 WHERE id = $2
       RETURNING id, email, full_name, status`,
      [value, existing.id]
    );
    const revoked = value === 'suspended' ? await revokeSessions(client, existing.id) : 0;
    await writeAudit({
      client,
      actorRole: 'platform_admin',
      actorId: existing.id,
      action: value === 'suspended' ? 'platform_admin.suspended' : 'platform_admin.activated',
      entityType: 'platform_admin',
      entityId: existing.id,
      before: { status: existing.status },
      after: { status: value, source: 'cli' },
      ip: 'cli',
    });
    return { admin: rows[0], revoked };
  });
};

// ---------------------------------------------------------------------- CLI

const showAdmins = async () => {
  const rows = await listAdmins();
  console.log(`Akun Admin Platform: ${rows.length}`);
  for (const r of rows) {
    const when = r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at;
    console.log(`  - ${r.email} | ${r.full_name} | ${r.status} | sejak ${when}`);
  }
};

const usage = () => {
  console.log('Pakai: node scripts/admin-account.mjs <perintah> [--allow-production]');
  console.log(`  ${COMMANDS.join(' | ')}`);
  console.log('Env: NOVA_ADMIN_EMAIL, NOVA_ADMIN_PASSWORD | NOVA_ADMIN_PASSWORD_FILE,');
  console.log('     NOVA_ADMIN_NAME (opsional), NOVA_ADMIN_STATUS (untuk `status`)');
};

/**
 * Titik masuk CLI.
 * @param {{argv?:string[], env?:NodeJS.ProcessEnv}} [opts]
 */
export const runCli = async ({ argv = process.argv.slice(2), env = process.env } = {}) => {
  const allowProduction = argv.includes('--allow-production');
  const command = argv.find((a) => !a.startsWith('--'));

  if (!command || !COMMANDS.includes(command)) {
    usage();
    return 1;
  }

  const databaseUrl = env.DATABASE_URL ?? '';
  if (!databaseUrl) {
    throw new Error('DATABASE_URL kosong. Salin server/.env.example menjadi server/.env');
  }
  if (!isLocalDatabase(databaseUrl) && !allowProduction) {
    throw new Error(
      `DATABASE_URL menunjuk host NON-lokal (${databaseHost(
        databaseUrl
      )}). Bila ini memang disengaja, tambahkan --allow-production ` +
        '(perubahan produksi harus disetujui pemilik proyek).'
    );
  }

  console.log(`Basis data: ${databaseHost(databaseUrl)}${isLocalDatabase(databaseUrl) ? ' (lokal)' : ' (PRODUKSI/non-lokal)'}`);

  if (command === 'list') {
    await showAdmins();
    return 0;
  }

  const email = env.NOVA_ADMIN_EMAIL;

  if (command === 'create') {
    const result = await createAdmin({
      email,
      password: readPasswordFromEnv(env),
      fullName: env.NOVA_ADMIN_NAME,
      force: argv.includes('--force'),
    });
    if (result.created) {
      console.log(`[buat] akun dibuat: ${result.admin.email} | ${result.admin.full_name} | ${result.admin.status}`);
    } else if (result.updated) {
      console.log(`[perbarui] sandi+nama diperbarui: ${result.admin.email} | sesi dicabut: ${result.revoked}`);
    } else {
      console.log(`[lewati] akun sudah ada: ${result.admin.email} | ${result.admin.full_name} | ${result.admin.status}`);
      console.log('        (pakai --force untuk mengganti sandi + nama)');
    }
    return 0;
  }

  if (command === 'password') {
    const result = await setAdminPassword({ email, password: readPasswordFromEnv(env) });
    console.log(`[sandi] ${result.admin.email} diperbarui | sesi dicabut: ${result.revoked}`);
    return 0;
  }

  // status
  const result = await setAdminStatus({ email, status: env.NOVA_ADMIN_STATUS });
  console.log(`[status] ${result.admin.email} -> ${result.admin.status} | sesi dicabut: ${result.revoked}`);
  return 0;
};

const invokedDirectly =
  process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const { pool } = await import('../src/config/db.js');
  runCli()
    .then(async (code) => {
      await pool.end();
      process.exitCode = code;
    })
    .catch(async (err) => {
      console.error(`GAGAL: ${err.message}`);
      try {
        await pool.end();
      } catch {
        /* abaikan */
      }
      process.exitCode = 1;
    });
}

export default {
  COMMANDS,
  STATUSES,
  isLocalDatabase,
  databaseHost,
  normalizeEmail,
  assertEmail,
  assertPassword,
  assertFullName,
  readPasswordFromEnv,
  listAdmins,
  findAdmin,
  createAdmin,
  setAdminPassword,
  setAdminStatus,
  runCli,
};
