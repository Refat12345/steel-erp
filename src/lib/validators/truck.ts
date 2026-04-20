import { z } from "zod";

const requestItemSchema = z.object({
  sizeId: z.number().int().positive("القياس مطلوب"),
  bundleCount: z.number().int().min(1, "عدد الربطات يجب أن يكون 1 على الأقل").optional().nullable(),
  requestedTons: z.number().positive("الوزن يجب أن يكون أكبر من صفر").optional().nullable(),
});

export const truckRegisterSchema = z.object({
  customerId: z.number().int().positive("الزبون مطلوب").optional().nullable(),
  plateNumber: z
    .string()
    .min(1, "رقم اللوحة مطلوب")
    .max(20, "رقم اللوحة طويل جداً"),
  driverName: z
    .string()
    .min(1, "اسم السائق مطلوب")
    .max(100, "اسم السائق طويل جداً"),
  salesOrderNumber: z.string().max(20).optional().or(z.literal("")),
  notes: z.string().max(2000).optional().or(z.literal("")),
  requestItems: z.array(requestItemSchema).optional(),
});

export const tareSchema = z.object({
  weightKg: z
    .number()
    .positive("الوزن يجب أن يكون أكبر من صفر")
    .max(200_000, "الوزن كبير جداً"),
});

export const grossSchema = z.object({
  weightKg: z
    .number()
    .positive("الوزن يجب أن يكون أكبر من صفر")
    .max(200_000, "الوزن كبير جداً"),
});

// Corrections carry the version the client read, so concurrent edits are
// detected via optimistic locking. See correctTare/correctGross in
// truck.service.ts.
export const correctTareSchema = tareSchema.extend({
  expectedVersion: z.number().int().nonnegative("الإصدار المتوقّع غير صالح"),
});

export const correctGrossSchema = grossSchema.extend({
  expectedVersion: z.number().int().nonnegative("الإصدار المتوقّع غير صالح"),
});

export const weighSessionSchema = z.object({
  sizeId: z.number().int().positive().optional().nullable(),
  bundleCount: z.number().int().min(1).optional().nullable(),
  weightTons: z
    .number()
    .positive("الوزن يجب أن يكون أكبر من صفر")
    .max(200, "الوزن كبير جداً"),
});

export const weighSessionEditSchema = z.object({
  sizeId: z.number().int().positive().optional().nullable(),
  bundleCount: z.number().int().min(1).optional().nullable(),
  weightTons: z
    .number()
    .positive("الوزن يجب أن يكون أكبر من صفر")
    .max(200, "الوزن كبير جداً")
    .optional(),
  expectedVersion: z.number().int().nonnegative("الإصدار المتوقّع غير صالح"),
});

export const cancelSchema = z.object({
  reason: z.string().min(1, "سبب الإلغاء مطلوب").max(2000, "السبب طويل جداً"),
});
