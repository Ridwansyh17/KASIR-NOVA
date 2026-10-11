/**
 * Skema validasi paket langganan (subscription_plans) — dikelola Admin.
 */
import { z } from 'zod';

const name = z.string().trim().min(2, 'Nama paket minimal 2 karakter').max(80);

const maxOutlets = z.coerce
  .number('maxOutlets harus angka')
  .int('maxOutlets harus bilangan bulat')
  .min(0, 'maxOutlets minimal 0');

const maxCashiers = z.coerce
  .number('maxCashiers harus angka')
  .int('maxCashiers harus bilangan bulat')
  .min(0, 'maxCashiers minimal 0');

const price = z.coerce
  .number('price harus angka')
  .int('price harus bilangan bulat (sen)')
  .min(0, 'price minimal 0');

const durationDays = z.coerce
  .number('durationDays harus angka')
  .int('durationDays harus bilangan bulat')
  .min(1, 'durationDays minimal 1');

const features = z.record(z.string(), z.unknown()).optional();

export const createPlanSchema = z.object({
  name,
  maxOutlets: maxOutlets.default(1),
  maxCashiers: maxCashiers.default(1),
  price: price.default(0),
  durationDays: durationDays.default(30),
  features,
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const updatePlanSchema = z
  .object({
    name: name.optional(),
    maxOutlets: maxOutlets.optional(),
    maxCashiers: maxCashiers.optional(),
    price: price.optional(),
    durationDays: durationDays.optional(),
    features,
    isDefault: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Tidak ada field yang diubah',
  });

export const planParamSchema = z.object({
  id: z.string().uuid('ID paket tidak valid'),
});