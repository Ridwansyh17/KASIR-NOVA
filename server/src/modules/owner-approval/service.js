/**
 * Pendaftaran Owner & Approval Center.
 *
 * Alur:
 *   registerOwner (auth) -> createDraftRegistration
 *   tombol "Minta Approve Admin" -> requestApproval (idempoten per Owner)
 *   Admin -> approveRegistration (bisnis + paket pilihan + trial 30 hari)
 *          -> rejectRegistration (alasan wajib)
 *
 * Semua operasi Admin berjalan di dalam transaksi dan menulis audit log.
 * Tidak ada biaya/tagihan pendaftaran di modul ini.
 */
import { randomBytes } from 'node:crypto';
import env from '../../config/env.js';
import { query, withTransaction } from '../../config/db.js';
import { AppError, ConflictError, NotFoundError } from '../../middleware/error.js';
import { writeAudit } from '../audit/service.js';
import { createBusinessInTransaction } from '../owner/service.js';

export const TRIAL_DAYS = 30;

const REGISTRATION_COLUMNS = `
  r.id, r.owner_id, r.registration_number, r.business_name, r.plan_id,
  r.status, r.requested_at, r.request_count, r.whatsapp_requested_at,
  r.approved_at, r.approved_by, r.rejected_at, r.rejected_by,
  r.rejection_reason, r.business_id, r.trial_started_at, r.trial_ends_at,
  r.created_at, r.updated_at`;

const registrationSelect = (where = '') => `
  SELECT ${REGISTRATION_COLUMNS},
         o.full_name AS owner_name, o.email AS owner_email, o.phone AS owner_phone,
         p.name AS plan_name, p.max_outlets, p.max_cashiers, p.price,
         p.duration_days, p.features,
         b.name AS created_business_name,
         admin.full_name AS approved_by_name
    FROM owner_registrations r
    JOIN owners o ON o.id = r.owner_id
    JOIN subscription_plans p ON p.id = r.plan_id
    LEFT JOIN businesses b ON b.id = r.business_id
    LEFT JOIN platform_admins admin ON admin.id = r.approved_by
    ${where}`;

export const shapeRegistration = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    owner_id: row.owner_id,
    registration_number: row.registration_number,
    business_name: row.business_name,
    status: row.status,
    requested_at: row.requested_at,
    request_count: row.request_count,
    whatsapp_requested_at: row.whatsapp_requested_at,
    approved_at: row.approved_at,
    approved_by: row.approved_by,
    rejected_at: row.rejected_at,
    rejected_by: row.rejected_by,
    rejection_reason: row.rejection_reason,
    business_id: row.business_id,
    trial_started_at: row.trial_started_at,
    trial_ends_at: row.trial_ends_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    owner: row.owner_name
      ? {
          full_name: row.owner_name,
          email: row.owner_email,
          phone: row.owner_phone,
        }
      : undefined,
    plan: row.plan_name
      ? {
          id: row.plan_id,
          name: row.plan_name,
          max_outlets: row.max_outlets,
          max_cashiers: row.max_cashiers,
          price: row.price,
          duration_days: row.duration_days,
          features: row.features,
        }
      : undefined,
    business: row.created_business_name ? { name: row.created_business_name } : undefined,
    approved_by_name: row.approved_by_name ?? undefined,
  };
};

const newRegistrationNumber = () => {
  const now = new Date();
  const date = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
  ].join('');
  return `REG-${date}-${randomBytes(4).toString('hex').toUpperCase()}`;
};

/**
 * Buat baris pendaftaran (status draft) di dalam transaksi pendaftaran Owner.
 * Nomor registrasi unik; bentrok sangat jarang tetapi tetap dicoba ulang.
 */
export const createDraftRegistration = async (
  client,
  { ownerId, businessName, planId }
) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const registrationNumber = newRegistrationNumber();
    try {
      const { rows } = await client.query(
        `INSERT INTO owner_registrations
           (owner_id, registration_number, business_name, plan_id, status)
         VALUES ($1, $2, $3, $4, 'draft')
         RETURNING ${REGISTRATION_COLUMNS.replaceAll('r.', '')}`,
        [ownerId, registrationNumber, businessName, planId]
      );
      return rows[0];
    } catch (err) {
      if (err?.code === '23505' && String(err.constraint ?? '').includes('registration_number')) {
        continue;
      }
      throw err;
    }
  }
  throw new AppError('Nomor registrasi gagal dibuat. Coba lagi.', 503);
};

export const getRegistrationByOwnerId = async (ownerId, client = null) => {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(
    `${registrationSelect('WHERE r.owner_id = $1')} LIMIT 1`,
    [ownerId]
  );
  return rows[0] ?? null;
};

export const getRegistrationStatus = async (ownerId) => {
  const row = await getRegistrationByOwnerId(ownerId);
  return shapeRegistration(row);
};

/** Template WhatsApp persis sesuai revisi final pendaftaran. */
export const buildApprovalWhatsappUrl = (registration) => {
  const lines = [
    'Halo Admin KASIR NOVA.',
    '',
    'Saya telah melakukan pendaftaran akun Owner baru dan ingin meminta persetujuan aktivasi.',
    '',
    `Nama Owner: ${registration.owner?.full_name ?? registration.owner_name ?? ''}`,
    `Nama Bisnis: ${registration.business_name}`,
    `Nomor Registrasi: ${registration.registration_number}`,
    `Paket Pilihan: ${registration.plan?.name ?? registration.plan_name ?? ''}`,
    '',
    'Mohon dilakukan pengecekan dan persetujuan akun saya.',
    '',
    'Terima kasih.',
  ];
  return `https://wa.me/${env.app.supportWhatsapp}?text=${encodeURIComponent(lines.join('\n'))}`;
};

/**
 * Simpan permintaan approval (idempoten). Permintaan berulang TIDAK membuat
 * baris baru karena satu Owner hanya punya satu baris pendaftaran.
 */
export const requestApproval = async ({ ownerId, ip }) => {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT ${REGISTRATION_COLUMNS.replaceAll('r.', '')}
         FROM owner_registrations WHERE owner_id = $1 FOR UPDATE`,
      [ownerId]
    );
    const current = rows[0];
    if (!current) throw new NotFoundError('Pendaftaran Owner tidak ditemukan');
    if (current.status === 'approved') {
      throw new ConflictError('Pendaftaran sudah disetujui Admin.');
    }
    if (current.status === 'rejected') {
      throw new ConflictError(
        'Pendaftaran sudah ditolak Admin. Hubungi Admin KASIR NOVA untuk tindak lanjut.'
      );
    }

    const alreadyRequested = current.status === 'pending';
    await client.query(
      `UPDATE owner_registrations
          SET status = 'pending',
              requested_at = COALESCE(requested_at, now()),
              whatsapp_requested_at = now(),
              request_count = request_count + 1
        WHERE id = $1`,
      [current.id]
    );

    const registration = shapeRegistration(await getRegistrationByOwnerId(ownerId, client));

    await writeAudit({
      client,
      actorRole: 'owner',
      actorId: ownerId,
      action: 'owner.approval_requested',
      entityType: 'owner_registration',
      entityId: current.id,
      after: {
        status: 'pending',
        registration_number: current.registration_number,
        request_count: current.request_count + 1,
        already_requested: alreadyRequested,
      },
      ip,
    });

    return {
      registration,
      alreadyRequested,
      whatsappUrl: buildApprovalWhatsappUrl(registration),
      message: alreadyRequested
        ? 'Permintaan approval sudah tercatat. WhatsApp Admin dibuka kembali.'
        : 'Permintaan approval berhasil disimpan. Silakan lanjutkan ke WhatsApp Admin.',
    };
  });
};

/** Daftar pendaftaran untuk Approval Center (pending / riwayat). */
export const listRegistrations = async ({
  status = 'pending',
  search = null,
  page = 1,
  limit = 20,
}) => {
  const offset = (page - 1) * limit;
  const whereParams = [search];
  let statusClause = '';
  if (status === 'pending') {
    statusClause = `r.status = 'pending'`;
  } else if (status === 'history' || status === 'all') {
    statusClause = `r.status IN ('pending', 'approved', 'rejected')`;
  } else {
    whereParams.push(status);
    statusClause = `r.status = $${whereParams.length}`;
  }

  const where = `
    WHERE ${statusClause}
      AND ($1::text IS NULL
           OR lower(o.full_name) LIKE '%' || lower($1) || '%'
           OR lower(o.email) LIKE '%' || lower($1) || '%'
           OR lower(r.business_name) LIKE '%' || lower($1) || '%'
           OR lower(r.registration_number) LIKE '%' || lower($1) || '%')`;

  const { rows } = await query(
    `${registrationSelect(where)}
      ORDER BY COALESCE(r.requested_at, r.created_at) DESC
      LIMIT $${whereParams.length + 1} OFFSET $${whereParams.length + 2}`,
    [...whereParams, limit, offset]
  );

  const { rows: countRows } = await query(
    `SELECT count(*)::int AS total
       FROM owner_registrations r
       JOIN owners o ON o.id = r.owner_id
      ${where}`,
    whereParams
  );

  const { rows: pendingRows } = await query(
    `SELECT count(*)::int AS n FROM owner_registrations WHERE status = 'pending'`
  );

  return {
    items: rows.map(shapeRegistration),
    total: countRows[0].total,
    pending: pendingRows[0].n,
    page,
    limit,
    status,
  };
};

/**
 * Setujui pendaftaran: aktifkan Owner, buat bisnis, pasang paket pilihan
 * sebagai booked package, dan mulai trial 30 hari dari waktu server.
 */
export const approveRegistration = async (id, actor, ip) => {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT ${REGISTRATION_COLUMNS.replaceAll('r.', '')}
         FROM owner_registrations WHERE id = $1 FOR UPDATE`,
      [id]
    );
    const registration = rows[0];
    if (!registration) throw new NotFoundError('Pendaftaran tidak ditemukan');
    if (registration.status === 'approved') {
      const existing = shapeRegistration(await getRegistrationByOwnerId(registration.owner_id, client));
      return { registration: existing, alreadyApproved: true };
    }
    if (registration.status === 'rejected') {
      throw new ConflictError('Pendaftaran sudah ditolak dan tidak dapat disetujui.');
    }
    if (registration.status !== 'pending') {
      throw new ConflictError('Owner belum mengirim permintaan approval.');
    }

    const ownerRows = await client.query(
      `SELECT id, email, full_name, status FROM owners
        WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [registration.owner_id]
    );
    const owner = ownerRows.rows[0];
    if (!owner) throw new NotFoundError('Owner tidak ditemukan');

    const business = await createBusinessInTransaction(client, {
      ownerId: owner.id,
      name: registration.business_name,
      actor,
      ip,
      initialSubscription: { planId: registration.plan_id, trialDays: TRIAL_DAYS },
    });

    const subRows = await client.query(
      `SELECT started_at, expires_at FROM subscriptions
        WHERE business_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [business.id]
    );
    const trial = subRows.rows[0];

    await client.query(
      `UPDATE owner_registrations
          SET status = 'approved', approved_at = now(), approved_by = $2,
              business_id = $3, trial_started_at = $4, trial_ends_at = $5
        WHERE id = $1`,
      [id, actor.id, business.id, trial.started_at, trial.expires_at]
    );

    // Penanda aktivasi yang dipakai gerbang login/sesi. Nilainya berasal dari
    // waktu persetujuan Admin di server, bukan dari klien.
    await client.query(
      `UPDATE owners SET email_verified_at = now() WHERE id = $1`,
      [owner.id]
    );

    const approved = shapeRegistration(await getRegistrationByOwnerId(owner.id, client));

    await writeAudit({
      client,
      actorRole: actor.role,
      actorId: actor.id,
      businessId: business.id,
      action: 'owner.registration_approved',
      entityType: 'owner_registration',
      entityId: id,
      before: { status: 'pending' },
      after: {
        status: 'approved',
        owner_id: owner.id,
        business_id: business.id,
        plan_id: registration.plan_id,
        trial_started_at: trial.started_at,
        trial_ends_at: trial.expires_at,
      },
      ip,
    });

    return { registration: approved, business, alreadyApproved: false };
  });
};

/** Tolak pendaftaran dengan alasan wajib. Tidak membuat bisnis/langganan. */
export const rejectRegistration = async (id, reason, actor, ip) => {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT ${REGISTRATION_COLUMNS.replaceAll('r.', '')}
         FROM owner_registrations WHERE id = $1 FOR UPDATE`,
      [id]
    );
    const registration = rows[0];
    if (!registration) throw new NotFoundError('Pendaftaran tidak ditemukan');
    if (registration.status === 'approved') {
      throw new ConflictError('Pendaftaran sudah disetujui dan tidak dapat ditolak.');
    }
    if (registration.status === 'rejected') {
      const existing = shapeRegistration(await getRegistrationByOwnerId(registration.owner_id, client));
      return { registration: existing, alreadyRejected: true };
    }
    if (registration.status !== 'pending') {
      throw new ConflictError('Owner belum mengirim permintaan approval.');
    }

    await client.query(
      `UPDATE owner_registrations
          SET status = 'rejected', rejected_at = now(), rejected_by = $2,
              rejection_reason = $3
        WHERE id = $1`,
      [id, actor.id, reason]
    );

    const rejected = shapeRegistration(await getRegistrationByOwnerId(registration.owner_id, client));

    await writeAudit({
      client,
      actorRole: actor.role,
      actorId: actor.id,
      action: 'owner.registration_rejected',
      entityType: 'owner_registration',
      entityId: id,
      before: { status: 'pending' },
      after: {
        status: 'rejected',
        owner_id: registration.owner_id,
        reason,
      },
      ip,
    });

    return { registration: rejected, alreadyRejected: false };
  });
};

export default {
  TRIAL_DAYS,
  createDraftRegistration,
  getRegistrationByOwnerId,
  getRegistrationStatus,
  buildApprovalWhatsappUrl,
  requestApproval,
  listRegistrations,
  approveRegistration,
  rejectRegistration,
};
