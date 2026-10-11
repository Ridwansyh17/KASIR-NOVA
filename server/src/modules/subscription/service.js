/**
 * Layanan langganan — pusat aturan kuota per bisnis.
 *
 * Tanggung jawab:
 *   - `createDefaultSubscription`: dipanggil DALAM transaksi pembuatan bisnis,
 *     sehingga bisnis baru selalu punya langganan (keputusan pemilik OPSI A).
 *   - `enforceOutletQuota`: gerbang pembuatan outlet (batas `max_outlets` plan;
 *     bisnis nonaktif / langganan nonaktif / kedaluwarsa -> ditolak).
 *   - `getSubscriptionView`: lihat langganan aktif + paketnya (Owner/Admin).
 *   - `assignSubscription`: Admin memasang paket baru (yang aktif diganti).
 *   - `setSubscriptionStatus`: Admin mengubah status langganan manual.
 *
 * Aturan model: maksimal SATU langganan `active` per bisnis (index parsial
 * unik). Status langganan satu bisnis TIDAK menular ke bisnis lain.
 */
import { query, withTransaction } from '../../config/db.js';
import { NotFoundError, ConflictError } from '../../middleware/error.js';
import { writeAudit } from '../audit/service.js';

const SUBSCRIPTION_COLUMNS = `id, business_id, plan_id, status, started_at, expires_at, auto_renew, created_at, updated_at`;

/** Buat langganan default untuk bisnis baru (dalam transaksi bisnis). */
export const createDefaultSubscription = async (client, businessId) => {
  const { rows } = await client.query(
    `SELECT id, duration_days FROM subscription_plans
      WHERE is_default = true AND is_active = true LIMIT 1`
  );
  const plan = rows[0];
  if (!plan) {
    throw new ConflictError('Paket langganan default belum tersedia');
  }

  const { rows: subRows } = await client.query(
    `INSERT INTO subscriptions (business_id, plan_id, status, started_at, expires_at, auto_renew)
     VALUES ($1, $2, 'active', now(), now() + make_interval(days => $3), false)
     RETURNING ${SUBSCRIPTION_COLUMNS}`,
    [businessId, plan.id, plan.duration_days]
  );
  return subRows[0];
};

/**
 * Gerbang kuota outlet. WAJIB dipanggil di dalam transaksi yang sudah mengunci
 * baris `businesses` (FOR UPDATE) agar dua pembuatan outlet bersamaan tidak
 * melampaui batas. Memakai langganan TERBARU (bukan hanya yang aktif) agar
 * pesan penolakan akurat (belum ada / nonaktif / kedaluwarsa).
 */
export const enforceOutletQuota = async (client, businessId) => {
  const { rows } = await client.query(
    `SELECT s.id AS sub_id, s.status AS sub_status, s.expires_at,
            p.max_outlets
       FROM subscriptions s
       JOIN subscription_plans p ON p.id = s.plan_id
      WHERE s.business_id = $1
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT 1`,
    [businessId]
  );
  const sub = rows[0];
  if (!sub) {
    throw new ConflictError('Bisnis belum memiliki langganan');
  }
  if (sub.sub_status !== 'active') {
    throw new ConflictError('Langganan bisnis sedang tidak aktif');
  }
  if (sub.expires_at && sub.expires_at <= new Date()) {
    throw new ConflictError('Langganan bisnis sudah kedaluwarsa');
  }

  const { rows: countRows } = await client.query(
    `SELECT count(*)::int AS n FROM outlets
      WHERE business_id = $1 AND deleted_at IS NULL`,
    [businessId]
  );
  if (countRows[0].n >= sub.max_outlets) {
    throw new ConflictError(
      `Batas jumlah outlet untuk paket ini (${sub.max_outlets}) telah tercapai`
    );
  }
};

/** Pemetaan langganan TERBARU + paketnya untuk dilihat Owner/Admin. */
export const getSubscriptionView = async (businessId) => {
  const { rows } = await query(
    `SELECT s.id, s.business_id, s.status, s.started_at, s.expires_at, s.auto_renew,
            p.id AS plan_id, p.name AS plan_name, p.max_outlets, p.max_cashiers,
            p.price, p.duration_days, p.features, p.is_default
       FROM subscriptions s
       JOIN subscription_plans p ON p.id = s.plan_id
      WHERE s.business_id = $1
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT 1`,
    [businessId]
  );
  const row = rows[0];
  if (!row) throw new NotFoundError('Bisnis belum memiliki langganan');

  return {
    subscription: {
      id: row.id,
      business_id: row.business_id,
      status: row.status,
      started_at: row.started_at,
      expires_at: row.expires_at,
      auto_renew: row.auto_renew,
    },
    plan: {
      id: row.plan_id,
      name: row.plan_name,
      max_outlets: row.max_outlets,
      max_cashiers: row.max_cashiers,
      price: row.price,
      duration_days: row.duration_days,
      features: row.features,
      is_default: row.is_default,
    },
  };
};

/**
 * Admin memasang paket langganan untuk suatu bisnis.
 * Langganan aktif lama diganti statusnya menjadi 'expired' (riwayat tetap),
 * lalu dibuat baris aktif baru mulai hari ini.
 */
export const assignSubscription = async (businessId, planId, actor, ip) => {
  return withTransaction(async (client) => {
    const biz = await client.query(
      `SELECT id FROM businesses WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [businessId]
    );
    if (!biz.rows[0]) throw new NotFoundError('Bisnis tidak ditemukan');

    const plan = await client.query(
      `SELECT id, name, duration_days FROM subscription_plans
        WHERE id = $1 AND is_active = true`,
      [planId]
    );
    if (!plan.rows[0]) throw new NotFoundError('Paket tidak ditemukan atau nonaktif');

    const { rows: activeRows } = await client.query(
      `SELECT id, plan_id, status FROM subscriptions
        WHERE business_id = $1 AND status = 'active' FOR UPDATE`,
      [businessId]
    );
    const beforePlanId = activeRows[0]?.plan_id ?? null;
    const beforeStatus = activeRows[0]?.status ?? null;
    if (activeRows[0]) {
      await client.query(
        `UPDATE subscriptions SET status = 'expired' WHERE id = $1`,
        [activeRows[0].id]
      );
    }

    const { rows } = await client.query(
      `INSERT INTO subscriptions (business_id, plan_id, status, started_at, expires_at, auto_renew)
       VALUES ($1, $2, 'active', now(), now() + make_interval(days => $3), false)
       RETURNING ${SUBSCRIPTION_COLUMNS}`,
      [businessId, plan.rows[0].id, plan.rows[0].duration_days]
    );

    await writeAudit({
      client,
      actorRole: actor.role,
      actorId: actor.id,
      businessId,
      action: 'subscription.assign',
      entityType: 'subscription',
      entityId: rows[0].id,
      before: { plan_id: beforePlanId, status: beforeStatus },
      after: { plan_id: rows[0].plan_id, status: rows[0].status },
      ip,
    });

    return { subscription: rows[0], plan: plan.rows[0] };
  });
};

/** Admin mengubah status langganan TERBARU manual (active/past_due/expired). */
export const setSubscriptionStatus = async (businessId, status, actor, ip) => {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, plan_id, status FROM subscriptions
        WHERE business_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        FOR UPDATE`,
      [businessId]
    );
    const current = rows[0];
    if (!current) throw new NotFoundError('Bisnis belum memiliki langganan');

    if (current.status !== status) {
      await client.query(
        `UPDATE subscriptions SET status = $1 WHERE id = $2`,
        [status, current.id]
      );
    }

    await writeAudit({
      client,
      actorRole: actor.role,
      actorId: actor.id,
      businessId,
      action: 'subscription.status_change',
      entityType: 'subscription',
      entityId: current.id,
      before: { status: current.status },
      after: { status },
      ip,
    });

    return { id: current.id, business_id: businessId, status };
  });
};

export default {
  createDefaultSubscription,
  enforceOutletQuota,
  getSubscriptionView,
  assignSubscription,
  setSubscriptionStatus,
};