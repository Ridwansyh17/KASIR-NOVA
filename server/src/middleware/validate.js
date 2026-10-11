/**
 * Middleware validasi input berbasis skema Zod.
 *
 * - Memvalidasi `req.body` / `req.params` / `req.query` lalu MENGGANTI nilainya
 *   dengan hasil parse yang sudah bersih (default Zod membuang field asing,
 *   sehingga mencegah mass-assignment).
 * - Error dikembalikan sebagai 422 dengan daftar field yang bermasalah.
 *
 * Pemakaian:
 *   router.post('/', ...validate({ body: skema }), handler)
 * `validate()` mengembalikan array middleware agar bisa di-spread.
 */
import { AppError } from './error.js';

const runSchema = (schema, source) => (req, _res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    return next(
      new AppError('Validasi input gagal', 422, {
        source,
        fields: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      })
    );
  }

  // req.query di Express bersifat getter saja; gunakan defineProperty agar
  // tetap bisa ditimpa (aman untuk mode ES module yang strict).
  if (source === 'query') {
    Object.defineProperty(req, 'query', {
      value: result.data,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  } else {
    req[source] = result.data;
  }

  next();
};

/**
 * Gabungkan skema validasi untuk satu route.
 * @param {{ body?: import('zod').ZodTypeAny, params?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny }} schemas
 * @returns {Array<Function>} daftar middleware
 */
export const validate = ({ body, params, query } = {}) => {
  const chain = [];
  if (body) chain.push(runSchema(body, 'body'));
  if (params) chain.push(runSchema(params, 'params'));
  if (query) chain.push(runSchema(query, 'query'));
  return chain;
};

export default validate;
