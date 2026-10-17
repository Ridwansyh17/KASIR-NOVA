/**
 * Tes skrip `scripts/admin-account.mjs` (pengelolaan akun Admin Platform dari CLI).
 *
 * Menguji: penjagaan lingkungan (lokal vs produksi), validasi masukan,
 * pembacaan sandi dari berkas/env (tanpa mencetak sandi), pembuatan akun
 * idempoten, ganti sandi + pencabutan sesi, ubah status, dan audit log yang
 * TIDAK pernah memuat sandi.
 *
 * Dijalankan: npm run test
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { query } from '../src/config/db.js';
import { verifyPassword } from '../src/utils/hash.js';
import {
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
} from '../scripts/admin-account.mjs';

const EMAIL = 'uji-skrip-admin@nova.test';
const PASSWORD = 'RahasiaUji123!';
const NEW_PASSWORD = 'SandiBaru456!';

/** Hapus semua jejak fixture (cascade manual: audit & sesi tidak ikut cascade). */
const cleanup = async () => {
  const ids = (
    await query('SELECT id FROM platform_admins WHERE lower(email) = lower($1)', [EMAIL])
  ).rows.map((r) => r.id);
  if (!ids.length) return;
  await query('DELETE FROM refresh_tokens WHERE user_role = $1 AND user_id = ANY($2::uuid[])', [
    'platform_admin',
    ids,
  ]);
  await query('DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])', [ids]);
  await query('DELETE FROM platform_admins WHERE id = ANY($1::uuid[])', [ids]);
};

before(cleanup);
after(cleanup);

// --- Penjagaan lingkungan -------------------------------------------------

test('isLocalDatabase: hanya host lokal yang dianggap aman', () => {
  assert.strictEqual(isLocalDatabase('postgresql://u:p@localhost:5433/nova_kasir_dev'), true);
  assert.strictEqual(isLocalDatabase('postgresql://u:p@127.0.0.1:5432/db'), true);
  assert.strictEqual(isLocalDatabase('postgresql://u:p@ep-tajam-123.ap-southeast-1.aws.neon.tech/db'), false);
  assert.strictEqual(isLocalDatabase(''), false);
});

test('databaseHost tidak membocorkan kredensial', () => {
  const shown = databaseHost('postgresql://user:SandiRahasia@localhost:5433/nova_kasir_dev');
  assert.strictEqual(shown, 'localhost:5433');
  assert.strictEqual(shown.includes('SandiRahasia'), false);
  assert.strictEqual(databaseHost('bukan-url').includes('SandiRahasia'), false);
});

test('runCli menolak DATABASE_URL kosong & host non-lokal tanpa --allow-production', async () => {
  await assert.rejects(() => runCli({ argv: ['list'], env: {} }), /DATABASE_URL kosong/);
  await assert.rejects(
    () =>
      runCli({
        argv: ['list'],
        env: { DATABASE_URL: 'postgresql://u:p@db.produksi.example.com:5432/nova' },
      }),
    /--allow-production/
  );
  assert.strictEqual(await runCli({ argv: ['perintah-ngawur'], env: {} }), 1);
});

// --- Validasi masukan -----------------------------------------------------

test('normalizeEmail & validasi email/nama/sandi', () => {
  assert.strictEqual(normalizeEmail('  Admin.Ridwan@NOVA.test '), 'admin.ridwan@nova.test');
  assert.strictEqual(assertEmail(' A@b.co '), 'a@b.co');
  assert.throws(() => assertEmail('bukan-email'), /Email tidak valid/);
  assert.throws(() => assertEmail(''), /Email tidak valid/);
  assert.throws(() => assertPassword('pendek'), /minimal 8/);
  assert.throws(() => assertPassword('x'.repeat(201)), /maksimal 200/);
  assert.strictEqual(assertPassword(PASSWORD), PASSWORD);
  assert.strictEqual(assertFullName('   '), 'Platform Admin');
  assert.throws(() => assertFullName('A'), /minimal 2/);
});

test('readPasswordFromEnv: dari berkas hanya memangkas akhir baris', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nova-admin-'));
  const file = join(dir, 'pw.txt');
  writeFileSync(file, ' Sandi Dengan Spasi \r\n');
  try {
    // Spasi dianggap bagian sandi — hanya \r?\n yang dipangkas.
    assert.strictEqual(readPasswordFromEnv({ NOVA_ADMIN_PASSWORD_FILE: file }), ' Sandi Dengan Spasi ');
    assert.strictEqual(readPasswordFromEnv({ NOVA_ADMIN_PASSWORD: 'langsung' }), 'langsung');
    assert.strictEqual(readPasswordFromEnv({}), null);
    assert.throws(
      () => readPasswordFromEnv({ NOVA_ADMIN_PASSWORD_FILE: join(dir, 'tidak-ada.txt') }),
      /Gagal membaca/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Operasi basis data ---------------------------------------------------

test('createAdmin membuat akun aktif, sandi terverifikasi, email dinormalkan', async () => {
  const result = await createAdmin({
    email: `  ${EMAIL.toUpperCase()} `,
    password: PASSWORD,
    fullName: 'Admin Skrip Uji',
  });

  assert.strictEqual(result.created, true);
  assert.strictEqual(result.updated, false);
  assert.strictEqual(result.admin.email, EMAIL);
  assert.strictEqual(result.admin.full_name, 'Admin Skrip Uji');
  assert.strictEqual(result.admin.status, 'active');

  const row = (
    await query('SELECT password_hash FROM platform_admins WHERE id = $1', [result.admin.id])
  ).rows[0];
  assert.strictEqual(await verifyPassword(PASSWORD, row.password_hash), true);

  // Audit tercatat, isinya tidak boleh memuat sandi/hash dalam bentuk apa pun.
  const audit = (
    await query('SELECT action, after::text AS after FROM audit_logs WHERE entity_id = $1', [
      result.admin.id,
    ])
  ).rows;
  assert.ok(audit.some((a) => a.action === 'platform_admin.created'));
  for (const a of audit) {
    assert.strictEqual(a.after.includes(PASSWORD), false);
    assert.strictEqual(a.after.includes('password_hash'), false);
  }
});

test('createAdmin idempoten: akun yang sudah ada tidak diubah tanpa --force', async () => {
  const again = await createAdmin({
    email: EMAIL,
    password: 'SandiLain789!',
    fullName: 'Nama Lain',
  });
  assert.strictEqual(again.created, false);
  assert.strictEqual(again.updated, false);

  const row = (
    await query('SELECT full_name, password_hash FROM platform_admins WHERE lower(email) = lower($1)', [
      EMAIL,
    ])
  ).rows[0];
  assert.strictEqual(row.full_name, 'Admin Skrip Uji');
  assert.strictEqual(await verifyPassword(PASSWORD, row.password_hash), true);
  assert.strictEqual(await verifyPassword('SandiLain789!', row.password_hash), false);
});

test('createAdmin dengan --force mengganti sandi+nama & mencabut sesi lama', async () => {
  const admin = await findAdmin(EMAIL);
  assert.ok(admin);

  await query(
    `INSERT INTO refresh_tokens (user_role, user_id, token_hash, expires_at)
     VALUES ('platform_admin', $1, $2, now() + interval '1 day')`,
    [admin.id, `uji-sesi-${Date.now()}`]
  );

  const result = await createAdmin({
    email: EMAIL,
    password: NEW_PASSWORD,
    fullName: 'Admin Skrip Baru',
    force: true,
  });
  assert.strictEqual(result.updated, true);
  assert.ok(result.revoked >= 1, 'sesi lama harus dicabut');

  const row = (
    await query('SELECT full_name, password_hash FROM platform_admins WHERE id = $1', [admin.id])
  ).rows[0];
  assert.strictEqual(row.full_name, 'Admin Skrip Baru');
  assert.strictEqual(await verifyPassword(NEW_PASSWORD, row.password_hash), true);
  assert.strictEqual(await verifyPassword(PASSWORD, row.password_hash), false);
});

test('setAdminPassword mengganti sandi & mencabut sesi', async () => {
  const admin = await findAdmin(EMAIL);
  await query(
    `INSERT INTO refresh_tokens (user_role, user_id, token_hash, expires_at)
     VALUES ('platform_admin', $1, $2, now() + interval '1 day')`,
    [admin.id, `uji-sesi-${Date.now()}-2`]
  );

  const result = await setAdminPassword({ email: EMAIL, password: PASSWORD });
  assert.ok(result.revoked >= 1);

  const row = (
    await query('SELECT password_hash FROM platform_admins WHERE id = $1', [admin.id])
  ).rows[0];
  assert.strictEqual(await verifyPassword(PASSWORD, row.password_hash), true);

  await assert.rejects(
    () => setAdminPassword({ email: 'tidak-ada@nova.test', password: PASSWORD }),
    /tidak ditemukan/
  );
});

test('setAdminStatus mengubah status (tidak peka huruf) & menolak nilai ngawur', async () => {
  const sus = await setAdminStatus({ email: EMAIL, status: 'SUSPENDED' });
  assert.strictEqual(sus.admin.status, 'suspended');

  const aktif = await setAdminStatus({ email: EMAIL, status: 'active' });
  assert.strictEqual(aktif.admin.status, 'active');

  await assert.rejects(() => setAdminStatus({ email: EMAIL, status: 'ngawur' }), /Status harus/);
  await assert.rejects(
    () => setAdminStatus({ email: 'tidak-ada@nova.test', status: 'active' }),
    /tidak ditemukan/
  );
});

test('listAdmins memuat akun uji', async () => {
  const rows = await listAdmins();
  assert.ok(Array.isArray(rows));
  assert.ok(rows.some((r) => r.email === EMAIL));
});
