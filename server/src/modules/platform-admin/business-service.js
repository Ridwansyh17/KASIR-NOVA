/**
 * Layanan admin: bisnis lintas platform + kelola langganan bisnis.
 *
 * Admin dapat melihat SEMUA bisnis (matriks: "Lihat semua bisnis di platform")
 * dan memasang/mengubah langganan suatu bisnis. Otorisasi peran dilakukan
 * gerbang router; kepemilikan data dikelola database (tanpa filter owner).
 */
import { query } from '../../config/db.js';
import { NotFoundError } from '../../middleware/error.js';
import {
  assignSubscription,
  setSubscriptionStatus,
  getSubscriptionView,
} from '../subscription/service.js';

const BUSINESS_COLUMNS = `
  b.id, b.owner_id, b.name, b.business_type, b.currency, b.timezone, b.status,
  b.created_at, b.updated_at,
  o.email AS owner_email, o.full_name AS owner_name,
  p.name AS plan_name, s.status AS subscription_status`;

const businessFilters = `
  FROM businesses b
  JOIN owners o ON o.id = b.owner_id
  LEFT JOIN subscriptions s ON s.business_id = b.id AND s.status = 'active'
  LEFT JOIN subscription_plans p ON p.id = s.plan_id
 WHERE b.deleted_at IS NULL
   AND ($1::text IS NULL
        OR lower(b.name) LIKE '%' || lower($1) || '%'
        OR lower(o.email) LIKE '%' || lower($1) || '%')
   AND ($2::account_status IS NULL OR b.status = $2::account_status)`;

/** Daftar semua bisnis (cari nama/email owner, filter status, paginasi). */
export const listBusinesses = async ({ search = null, status = null, page = 1, limit = 20 }) => {
  const offset = (page - 1) * limit;
  const { rows } = await query(
    `SELECT ${BUSINESS_COLUMNS} ${businessFilters}
      ORDER BY b.created_at DESC
      LIMIT $3 OFFSET $4`,
    [search, status, limit, offset]
  );

  const { rows: countRows } = await query(
    `SELECT count(*)::int AS total ${businessFilters}`,
    [search, status]
  );

  return { items: rows, total: countRows[0].total, page, limit };
};

/** Detail satu bisnis (akses admin). */
export const getBusiness = async (id) => {
  const { rows } = await query(
    `SELECT ${BUSINESS_COLUMNS}
       FROM businesses b
       JOIN owners o ON o.id = b.owner_id
       LEFT JOIN subscriptions s ON s.business_id = b.id AND s.status = 'active'
       LEFT JOIN subscription_plans p ON p.id = s.plan_id
      WHERE b.id = $1 AND b.deleted_at IS NULL`,
    [id]
  );
  if (!rows[0]) throw new NotFoundError('Bisnis tidak ditemukan');
  return rows[0];
};

/** Admin melihat langganan aktif suatu bisnis. */
export const viewSubscription = async (businessId) => getSubscriptionView(businessId);

/** Admin memasang paket langganan suatu bisnis. */
export const assignPlan = async (businessId, planId, actor, ip) =>
  assignSubscription(businessId, planId, actor, ip);

/** Admin mengubah status langganan aktif suatu bisnis. */
export const changeSubscriptionStatus = async (businessId, status, actor, ip) =>
  setSubscriptionStatus(businessId, status, actor, ip);

export default {
  listBusinesses,
  getBusiness,
  viewSubscription,
  assignPlan,
  changeSubscriptionStatus,
};