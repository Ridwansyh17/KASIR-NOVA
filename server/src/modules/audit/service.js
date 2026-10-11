/**
 * Modul audit — pencatat aksi penting (append-only).
 *
 * `writeAudit` dipanggil di dalam transaksi yang sama dengan mutasi yang
 * dicatat, sehingga jejak audit tidak pernah "hilang" bila mutasi gagal, dan
 * tidak pernah ada mutasi tanpa jejak.
 *
 * Tabel `audit_logs` tidak memiliki endpoint hapus (sesuai matriks hak akses).
 */
import { query } from '../../config/db.js';

/**
 * Baca audit log (append-only; tidak ada hapus).
 *
 * Param filter dipakai untuk membangun WHERE. `businessId` wajib untuk scope
 * Owner (juga ditegakkan middleware tenant); Admin boleh tanpa filter bisnis.
 * Kolom `actor_name`/`actor_email` di-join dari tabel peran (LEFT JOIN karena
 * akun mungkin sudah dihapus/di-cascade).
 */
export const listAuditLogs = async ({
  businessId = null,
  actorRole = null,
  action = null,
  entityType = null,
  from = null,
  to = null,
  limit = 50,
  offset = 0,
}) => {
  const conds = [];
  const params = [];
  let i = 1;

  if (businessId) {
    conds.push(`a.business_id = $${i++}`);
    params.push(businessId);
  }
  if (actorRole) {
    conds.push(`a.actor_role = $${i++}`);
    params.push(actorRole);
  }
  if (action) {
    conds.push(`a.action = $${i++}`);
    params.push(action);
  }
  if (entityType) {
    conds.push(`a.entity_type = $${i++}`);
    params.push(entityType);
  }
  if (from) {
    conds.push(`a.created_at >= $${i++}`);
    params.push(from);
  }
  if (to) {
    conds.push(`a.created_at <= $${i++}`);
    params.push(to);
  }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  const { rows: countRows } = await query(
    `SELECT COUNT(*)::int AS total FROM audit_logs a ${where}`,
    params
  );
  const total = countRows[0].total;

  const { rows } = await query(
    `SELECT a.id, a.actor_role, a.actor_id, a.business_id, a.action,
            a.entity_type, a.entity_id, a.before, a.after, a.ip, a.created_at,
            COALESCE(pa.full_name, ow.full_name, ca.full_name) AS actor_name,
            COALESCE(pa.email, ow.email, ca.email) AS actor_email
       FROM audit_logs a
       LEFT JOIN platform_admins pa ON pa.id = a.actor_id AND a.actor_role = 'platform_admin'
       LEFT JOIN owners ow ON ow.id = a.actor_id AND a.actor_role = 'owner'
       LEFT JOIN cashiers ca ON ca.id = a.actor_id AND a.actor_role = 'cashier'
       ${where}
      ORDER BY a.created_at DESC
      LIMIT $${i} OFFSET $${i + 1}`,
    [...params, limit, offset]
  );

  return { items: rows, total };
};

/**
 * Tulis satu baris audit.
 * @param {object} p
 * @param {import('pg').PoolClient} [p.client] - ikut transaksi pemanggil bila ada
 * @param {'platform_admin'|'owner'|'cashier'} p.actorRole
 * @param {string} p.actorId
 * @param {string|null} [p.businessId]
 * @param {string} p.action        - mis. 'owner.create'
 * @param {string} p.entityType    - mis. 'owner'
 * @param {string|null} [p.entityId]
 * @param {object|null} [p.before]
 * @param {object|null} [p.after]
 * @param {string|null} [p.ip]
 */
export const writeAudit = async ({
  client,
  actorRole,
  actorId,
  businessId = null,
  action,
  entityType,
  entityId = null,
  before = null,
  after = null,
  ip = null,
}) => {
  const sql = `INSERT INTO audit_logs
      (actor_role, actor_id, business_id, action, entity_type, entity_id, before, after, ip)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`;
  const params = [actorRole, actorId, businessId, action, entityType, entityId, before, after, ip];

  if (client) await client.query(sql, params);
  else await query(sql, params);
};

export default { writeAudit, listAuditLogs };
