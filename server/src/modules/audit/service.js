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

export default { writeAudit };
