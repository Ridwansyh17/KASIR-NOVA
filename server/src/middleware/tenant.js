/**
 * Middleware tenant: memastikan bisnis yang diminta boleh diakses pengguna.
 *
 * Aturan (docs/04-matriks-hak-akses.md):
 *   - owner          : hanya bisnis miliknya
 *   - platform_admin : semua bisnis
 *   - cashier        : (Fase 5) hanya bisnis dari outlet yang ditetapkan
 *
 * Bila bisnis tidak ada ATAU bukan milik pemanggil, dikembalikan 404 —
 * bukan 403 — agar keberadaan data tenant lain tidak bocor (anti-enumerasi).
 *
 * Menempelkan `req.business` = baris bisnis yang sudah diverifikasi.
 */
import { query } from '../config/db.js';
import { NotFoundError, ForbiddenError } from './error.js';

/**
 * @param {{ source?: 'params'|'body'|'query', key?: string }} [opts]
 */
export const requireBusinessAccess =
  ({ source = 'params', key = 'businessId' } = {}) =>
  async (req, _res, next) => {
    try {
      const businessId =
        req[source]?.[key] ?? req.body?.[key] ?? req.query?.[key];

      if (!businessId) throw new NotFoundError('Bisnis tidak ditemukan');

      const { rows } = await query(
        `SELECT id, owner_id, name, business_type, currency, timezone, status
           FROM businesses
          WHERE id = $1 AND deleted_at IS NULL`,
        [businessId]
      );
      const business = rows[0];
      if (!business) throw new NotFoundError('Bisnis tidak ditemukan');

      const { role, id } = req.user;

      if (role === 'owner' && business.owner_id !== id) {
        // Milik tenant lain -> 404 (jangan bocorkan keberadaannya)
        throw new NotFoundError('Bisnis tidak ditemukan');
      }

      if (!['owner', 'platform_admin'].includes(role)) {
        throw new ForbiddenError('Peran tidak diizinkan mengakses bisnis');
      }

      req.business = business;
      next();
    } catch (err) {
      next(err);
    }
  };

export default { requireBusinessAccess };
