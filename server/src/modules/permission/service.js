/**
 * Modul izin bersama (V0.3).
 *
 * Aturan bisnis: **HPP / data keuntungan hanya boleh dilihat pengguna yang
 * berizin**. Owner & Platform Admin SELALU berizin; Kasir bersifat opt-in
 * (`cashiers.can_view_profit` diatur Owner). Izin ini ditegakkan di SERVER,
 * bukan hanya disembunyikan di UI.
 */
import { query } from '../../config/db.js';

/** @param {{ id: string, role: string }} user */
export const canViewProfit = async (user) => {
  if (!user) return false;
  if (user.role === 'owner' || user.role === 'platform_admin') return true;
  if (user.role !== 'cashier') return false;
  const { rows } = await query(
    `SELECT can_view_profit FROM cashiers WHERE id = $1`,
    [user.id]
  );
  return Boolean(rows[0]?.can_view_profit);
};

/** Izin untuk kasir (dipakai area kasir agar UI tahu apa yang boleh tampil). */
export const getCashierPermissions = async (cashierId) => {
  const { rows } = await query(
    `SELECT can_view_profit FROM cashiers WHERE id = $1`,
    [cashierId]
  );
  return { can_view_profit: Boolean(rows[0]?.can_view_profit) };
};

export default { canViewProfit, getCashierPermissions };
