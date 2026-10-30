import * as service from './service.js';

export const list = async (req, res, next) => {
  try {
    const result = await service.listRegistrations(req.query);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const approve = async (req, res, next) => {
  try {
    const result = await service.approveRegistration(req.params.id, req.user, req.ip);
    res.status(200).json({
      ...result,
      message: result.alreadyApproved
        ? 'Pendaftaran ini sudah disetujui sebelumnya.'
        : 'Pendaftaran disetujui. Bisnis aktif dan masa gratis 30 hari dimulai.',
    });
  } catch (err) {
    next(err);
  }
};

export const reject = async (req, res, next) => {
  try {
    const result = await service.rejectRegistration(
      req.params.id,
      req.body.reason,
      req.user,
      req.ip
    );
    res.status(200).json({
      ...result,
      message: result.alreadyRejected
        ? 'Pendaftaran ini sudah ditolak sebelumnya.'
        : 'Pendaftaran ditolak.',
    });
  } catch (err) {
    next(err);
  }
};
