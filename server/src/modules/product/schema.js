/**
 * Skema validasi modul produk, kategori & stok (dikelola Owner).
 *
 * Harga dalam SATUAN SEN (integer non-negatif) — konsisten dengan
 * subscription_plans.price. Klien/UI mengonversi Rp -> sen.
 */
import { z } from 'zod';

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
  price: z
    .number()
    .int('Harga harus bilangan bulat (dalam sen)')
    .min(0, 'Harga tidak boleh negatif'),
  categoryId: z.string().uuid('ID kategori tidak valid').optional().nullable(),
  trackStock: z.boolean().default(true),
});

export const updateProductSchema = z
  .object({
    name: z.string().trim().min(2, 'Nama produk minimal 2 karakter').max(120, 'Nama produk maksimal 120 karakter').optional(),
    sku: z.string().trim().max(64).optional().nullable(),
    barcode: z.string().trim().max(64).optional().nullable(),
    price: z.number().int().min(0).optional(),
    categoryId: z.string().uuid('ID kategori tidak valid').optional().nullable(),
    trackStock: z.boolean().optional(),
    status: z.enum(['active', 'suspended'], {
      errorMap: () => ({ message: "Status harus 'active' atau 'suspended'" }),
    }).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Tidak ada field yang diubah',
  });

export const productParamSchema = z.object({
  businessId: z.string().uuid('ID bisnis tidak valid'),
  productId: z.string().uuid('ID produk tidak valid'),
});

export const categoryParamSchema = z.object({
  businessId: z.string().uuid('ID bisnis tidak valid'),
  categoryId: z.string().uuid('ID kategori tidak valid'),
});

export const stockSchema = z.object({
  quantity: z.number().int('Stok harus bilangan bulat').min(0, 'Stok tidak boleh negatif'),
});

export const stockParamSchema = z.object({
  businessId: z.string().uuid('ID bisnis tidak valid'),
  productId: z.string().uuid('ID produk tidak valid'),
  outletId: z.string().uuid('ID outlet tidak valid'),
});

export const productListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  categoryId: z.string().uuid('ID kategori tidak valid').optional(),
  status: z.enum(['active', 'suspended']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});