/**
 * Skema validasi modul produk, kategori & stok.
 *
 * Harga dalam SATUAN SEN (integer non-negatif) — konsisten dengan
 * subscription_plans.price. Klien/UI mengonversi Rp -> sen.
 *
 * V0.3 (Fase 1) menambahkan: HPP (`costPrice`), satuan (`unit`), foto
 * (`photoUrl`), status habis manual (`manualOutOfStock`), stok awal
 * (`initialStock` + `outletId`).
 */
import { z } from 'zod';

const money = (label) =>
  z
    .number(`${label} harus angka`)
    .int(`${label} harus bilangan bulat (sen)`)
    .min(0, `${label} tidak boleh negatif`);

/**
 * Foto produk: URL http(s) ATAU data URL gambar hasil pengecilan di klien
 * (dibatasi agar body request tetap di bawah 1 MB). String kosong = tanpa foto.
 */
const PHOTO_PREFIXES = [
  'data:image/png;base64,',
  'data:image/jpeg;base64,',
  'data:image/jpg;base64,',
  'data:image/webp;base64,',
];

const isPhotoValue = (v) =>
  v === '' || PHOTO_PREFIXES.some((p) => v.startsWith(p)) || /^https?:\/\//i.test(v);

const photoUrl = z
  .string()
  .trim()
  .max(400_000, 'Foto terlalu besar (maksimal ~300 KB setelah dikecilkan)')
  .refine(isPhotoValue, 'Foto harus URL http(s) atau data URL gambar (png/jpeg/webp)');

const unit = z.string().trim().max(20, 'Satuan maksimal 20 karakter');
const note = z.string().trim().max(200, 'Catatan maksimal 200 karakter');

export const categorySchema = z.object({
  name: z.string().trim().min(2, 'Nama kategori minimal 2 karakter').max(60, 'Nama kategori maksimal 60 karakter'),
});

export const categoryPatchSchema = z.object({
  name: z.string().trim().min(2, 'Nama kategori minimal 2 karakter').max(60, 'Nama kategori maksimal 60 karakter'),
});

export const createProductSchema = z.object({
  name: z.string().trim().min(2, 'Nama produk minimal 2 karakter').max(120, 'Nama produk maksimal 120 karakter'),
  sku: z.string().trim().max(64, 'SKU maksimal 64 karakter').optional().nullable(),
  barcode: z.string().trim().max(64, 'Barcode maksimal 64 karakter').optional().nullable(),
  price: money('Harga jual'),
  costPrice: money('Harga modal/HPP').optional().default(0),
  unit: unit.optional().nullable(),
  photoUrl: photoUrl.optional().nullable(),
  categoryId: z.string().uuid('ID kategori tidak valid').optional().nullable(),
  trackStock: z.boolean().default(true),
  manualOutOfStock: z.boolean().optional().default(false),
  initialStock: z
    .number('Stok awal harus angka')
    .int('Stok awal harus bilangan bulat')
    .min(0, 'Stok awal tidak boleh negatif')
    .max(1_000_000, 'Stok awal terlalu besar')
    .optional(),
  outletId: z.string().uuid('ID outlet tidak valid').optional(),
});

export const updateProductSchema = z
  .object({
    name: z.string().trim().min(2, 'Nama produk minimal 2 karakter').max(120, 'Nama produk maksimal 120 karakter').optional(),
    sku: z.string().trim().max(64).optional().nullable(),
    barcode: z.string().trim().max(64).optional().nullable(),
    price: money('Harga jual').optional(),
    costPrice: money('Harga modal/HPP').optional(),
    unit: unit.optional().nullable(),
    photoUrl: photoUrl.optional().nullable(),
    categoryId: z.string().uuid('ID kategori tidak valid').optional().nullable(),
    trackStock: z.boolean().optional(),
    status: z.enum(['active', 'suspended'], {
      errorMap: () => ({ message: "Status harus 'active' atau 'suspended'" }),
    }).optional(),
    manualOutOfStock: z.boolean().optional(),
    stockNote: note.optional().nullable(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Tidak ada field yang diubah',
  });

export const productParamSchema = z.object({
  businessId: z.string().uuid('ID bisnis tidak valid'),
  productId: z.string().uuid('ID produk tidak valid'),
});

export const cashierProductParamSchema = z.object({
  productId: z.string().uuid('ID produk tidak valid'),
});

export const categoryParamSchema = z.object({
  businessId: z.string().uuid('ID bisnis tidak valid'),
  categoryId: z.string().uuid('ID kategori tidak valid'),
});

export const stockSchema = z.object({
  quantity: z.number().int('Stok harus bilangan bulat').min(0, 'Stok tidak boleh negatif'),
  reason: note.optional().nullable(),
});

export const stockParamSchema = z.object({
  businessId: z.string().uuid('ID bisnis tidak valid'),
  productId: z.string().uuid('ID produk tidak valid'),
  outletId: z.string().uuid('ID outlet tidak valid'),
});

export const cashierStockParamSchema = z.object({
  productId: z.string().uuid('ID produk tidak valid'),
  outletId: z.string().uuid('ID outlet tidak valid'),
});

/** Tandai habis / aktifkan kembali (Fase 2). */
export const stockStatusSchema = z.object({
  outOfStock: z.boolean({
    errorMap: () => ({ message: 'outOfStock harus true/false' }),
  }),
  note: note.optional().nullable(),
});

export const productListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  categoryId: z.string().uuid('ID kategori tidak valid').optional(),
  status: z.enum(['active', 'suspended']).optional(),
  availability: z
    .enum(['all', 'available', 'out_of_stock'], {
      errorMap: () => ({ message: "Filter ketersediaan harus 'all', 'available', atau 'out_of_stock'" }),
    })
    .optional(),
  sort: z.enum(['name', 'stock_asc', 'stock_desc', 'recent']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export default {
  categorySchema,
  categoryPatchSchema,
  createProductSchema,
  updateProductSchema,
  productParamSchema,
  cashierProductParamSchema,
  categoryParamSchema,
  stockSchema,
  stockParamSchema,
  cashierStockParamSchema,
  stockStatusSchema,
  productListQuerySchema,
};
