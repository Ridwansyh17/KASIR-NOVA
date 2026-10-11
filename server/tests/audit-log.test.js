/**
 * Tes integrasi Fase 11 — Viewer Audit Log.
 *
 * Hak akses (matriks §9):
 *   - Admin Platform : membaca SEMUA audit log lintas bisnis.
 *   - Owner          : hanya audit log bisnisnya (404 utk bisnis lain).
 *   - Kasir          : 403.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import request from './helpers/request.js';
import { query } from '../src/config/db.js';
import { hashPassword } from '../src/utils/hash.js';
import { signAccessToken } from '../src/utils/token.js';

const PASSWORD = 'AuditUji123!';
const ADMIN_EMAIL = 'uji-audit-admin@nova.test';
const OWNER_A_EMAIL = 'uji-audit-a@nova.test';
const OWNER_B_EMAIL = 'uji-audit-b@nova.test';

const auth = (token) => ({ headers: { Authorization: `Bearer ${token}` } });
const ownerPost = (token, path, body) => request.post(`/api/owner${path}`, body, auth(token));

let adminId, ownerAId, ownerBId;
let adminToken, tokenA, tokenB;
let businessA, businessB, cashierA;

const cleanup = async () => {
  const emails = [ADMIN_EMAIL, OWNER_A_EMAIL, OWNER_B_EMAIL];
  for (const email of emails) {
    const rows = (await query(`SELECT id FROM owners WHERE email = $1`, [email])).rows;
    if (rows.length) {
      const ids = rows.map((r) => r.id);
      await query('DELETE FROM refresh_tokens WHERE user_role = $1 AND user_id = ANY($2::uuid[])', ['owner', ids]);
      await query('DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])', [ids]);
      await query('DELETE FROM owners WHERE id = ANY($1::uuid[])', [ids]);
    }
  }
  const adm = (await query(`SELECT id FROM platform_admins WHERE email = $1`, [ADMIN_EMAIL])).rows;
  if (adm.length) {
    await query('DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])', [adm.map((r) => r.id)]);
    await query('DELETE FROM platform_admins WHERE id = ANY($1::uuid[])', [adm.map((r) => r.id)]);
  }
};

before(async () => {
  await cleanup();

  const admin = await query(
    `INSERT INTO platform_admins (email, password_hash, full_name, status)
     VALUES ($1, $2, 'Admin Audit', 'active') RETURNING id`,
    [ADMIN_EMAIL, await hashPassword(PASSWORD)]
  );
  adminId = admin.rows[0].id;
  adminToken = signAccessToken({ userId: adminId, role: 'platform_admin' });

  const a = await query(
    `INSERT INTO owners (email, password_hash, full_name, status)
     VALUES ($1, $2, 'Owner Audit A', 'active') RETURNING id`,
    [OWNER_A_EMAIL, await hashPassword(PASSWORD)]
  );
  ownerAId = a.rows[0].id;
  tokenA = signAccessToken({ userId: ownerAId, role: 'owner' });

  const b = await query(
    `INSERT INTO owners (email, password_hash, full_name, status)
     VALUES ($1, $2, 'Owner Audit B', 'active') RETURNING id`,
    [OWNER_B_EMAIL, await hashPassword(PASSWORD)]
  );
  ownerBId = b.rows[0].id;
  tokenB = signAccessToken({ userId: ownerBId, role: 'owner' });

  // Entri audit alami:
  businessA = (await ownerPost(tokenA, '/businesses', { name: 'Bisnis Audit A' })).body.business.id;
  const outletA = (await ownerPost(tokenA, `/businesses/${businessA}/outlets`, { name: 'Outlet Audit 1' }))
    .body.outlet.id;
  cashierA = (
    await ownerPost(tokenA, `/businesses/${businessA}/cashiers`, {
      fullName: 'Kasir Audit',
      email: 'k-audit@nova.test',
      password: PASSWORD,
      outletId: outletA,
    })
  ).body.cashier.id;

  businessB = (await ownerPost(tokenB, '/businesses', { name: 'Bisnis Audit B' })).body.business.id;
});

after(async () => {
  if (cashierA) {
    await query('DELETE FROM refresh_tokens WHERE user_role = $1 AND user_id = ANY($2::uuid[])', ['cashier', [cashierA]]);
  }
  await cleanup();
});

test('Admin membaca seluruh audit log lintas bisnis dengan nama aktor', async () => {
  const res = await request.get('/api/platform/audit-logs', auth(adminToken));
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.total >= 4, `total minimal 4, dapat ${res.body.total}`);
  assert.ok(
    res.body.items.some((i) => i.business_id === businessA && i.action === 'business.create'),
    'tercatat business.create bisnis A'
  );
  assert.ok(
    res.body.items.some((i) => i.business_id === businessB && i.action === 'business.create'),
    'tercatat business.create bisnis B (lintas bisnis terlihat admin)'
  );
  const ownerEntry = res.body.items.find((i) => i.action === 'business.create' && i.business_id === businessA);
  assert.strictEqual(ownerEntry.actor_role, 'owner');
  assert.strictEqual(ownerEntry.actor_name, 'Owner Audit A');
  assert.strictEqual(ownerEntry.actor_email, OWNER_A_EMAIL);
});

test('Owner hanya melihat audit log bisnisnya sendiri', async () => {
  const res = await request.get(`/api/owner/businesses/${businessA}/audit-logs`, auth(tokenA));
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.total >= 3, `total >= 3, dapat ${res.body.total}`);
  assert.ok(res.body.items.every((i) => i.business_id === businessA), 'semua milik bisnis A');
  assert.ok(
    ![businessB].some((bid) => res.body.items.some((i) => i.business_id === bid)),
    'tidak ada entri bisnis B'
  );
});

test('Owner tidak bisa membaca audit bisnis lain (404, anti-enumerasi)', async () => {
  const res = await request.get(`/api/owner/businesses/${businessB}/audit-logs`, auth(tokenA));
  assert.strictEqual(res.status, 404);
});

test('Kasir tidak bisa membaca audit log (403)', async () => {
  const cashierToken = signAccessToken({ userId: cashierA, role: 'cashier' });
  const res = await request.get('/api/platform/audit-logs', auth(cashierToken));
  assert.strictEqual(res.status, 403);
});

test('Filter action & actorRole', async () => {
  const byAction = await request.get(
    `/api/platform/audit-logs?action=${encodeURIComponent('cashier.create')}`,
    auth(adminToken)
  );
  assert.strictEqual(byAction.status, 200);
  assert.ok(byAction.body.items.length > 0);
  assert.ok(byAction.body.items.every((i) => i.action === 'cashier.create'));
  // Setidaknya satu dari baris ini milik kasir file ini (DB dibagi tes paralel).
  assert.ok(
    byAction.body.items.some((i) => i.entity_id === cashierA),
    'baris cashier.create kasir ini tercatat'
  );

  const byRole = await request.get('/api/platform/audit-logs?actorRole=owner', auth(adminToken));
  assert.strictEqual(byRole.status, 200);
  assert.ok(byRole.body.items.length > 0);
  assert.ok(byRole.body.items.every((i) => i.actor_role === 'owner'));
});

test('Filter rentang waktu + pagination (limit/offset)', async () => {
  const from = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const to = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const ranged = await request.get(
    `/api/platform/audit-logs?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    auth(adminToken)
  );
  assert.strictEqual(ranged.status, 200);
  assert.ok(ranged.body.total >= 4);

  const page1 = await request.get('/api/platform/audit-logs?limit=2&offset=0', auth(adminToken));
  const page2 = await request.get('/api/platform/audit-logs?limit=2&offset=2', auth(adminToken));
  assert.strictEqual(page1.status, 200);
  assert.strictEqual(page1.body.items.length, 2);
  assert.strictEqual(page2.body.items.length, 2);
  const ids1 = page1.body.items.map((i) => i.id);
  const ids2 = page2.body.items.map((i) => i.id);
  assert.ok(ids1.some((id) => !ids2.includes(id)), 'halaman berbeda isinya');
});