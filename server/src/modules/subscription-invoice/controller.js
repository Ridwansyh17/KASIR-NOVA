/**
 * Controller modul tagihan langganan (Owner) — tipis, tanpa logika bisnis.
 *
 * Kepemilikan bisnis sudah diverifikasi middleware tenant (`requireBusinessAccess`)
 * sebelum handler dijalankan.
 */
import * as service from './service.js';

/** Opsi checkout: daftar paket + status gateway + kanal aktif. */
export const getCheckoutOptions = async (req, res, next) => {
  try {
    res.json(await service.checkoutOptions());
  } catch (err) {
    next(err);
  }
};

/** Riwayat tagihan langganan bisnis. */
export const listInvoices = async (req, res, next) => {
  try {
    const { status, page, limit } = req.query;
    const result = await service.listInvoices({
      businessId: req.params.businessId,
      status: status ?? null,
      page,
      limit,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

/** Detail satu tagihan. */
export const getInvoice = async (req, res, next) => {
  try {
    const invoice = await service.getInvoice({
      businessId: req.params.businessId,
      invoiceId: req.params.invoiceId,
    });
    res.json({ invoice });
  } catch (err) {
    next(err);
  }
};

/** Buat (atau pakai ulang) tagihan paket lalu minta nomor pembayaran ke gateway. */
export const createInvoice = async (req, res, next) => {
  try {
    const result = await service.createInvoiceForPlan({
      businessId: req.params.businessId,
      planId: req.body.planId,
      billingPeriod: req.body.billingPeriod,
      paymentMethod: req.body.paymentMethod,
      actor: req.user,
      ip: req.ip,
    });
    res.status(result.reused ? 200 : 201).json(result);
  } catch (err) {
    next(err);
  }
};

/** Cek status tagihan ke gateway (manual, dibatasi rate limiter). */
export const syncInvoice = async (req, res, next) => {
  try {
    const result = await service.syncInvoiceStatus({
      businessId: req.params.businessId,
      invoiceId: req.params.invoiceId,
      ip: req.ip,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export default { getCheckoutOptions, listInvoices, getInvoice, createInvoice, syncInvoice };
