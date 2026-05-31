import { z } from "zod";
import { MIN_WEIGHT_KG, MAX_WEIGHT_KG } from "@/lib/weight-bounds";

const requestItemSchema = z.object({
  sizeId: z.number().int().positive("القياس مطلوب"),
  bundleCount: z.number().int().min(1, "عدد الربطات يجب أن يكون 1 على الأقل").optional().nullable(),
  requestedTons: z
    .number()
    .positive("الوزن يجب أن يكون أكبر من صفر")
    .max(999_999, "قيمة الطن كبيرة جداً")
    .optional()
    .nullable(),
});

export const truckRegisterSchema = z.object({
  customerId: z.number().int().positive("الزبون مطلوب").optional().nullable(),
  destinationId: z.number().int().positive("الوجهة غير صالحة").optional().nullable(),
  plateNumber: z
    .string()
    .min(1, "رقم اللوحة مطلوب")
    .max(20, "رقم اللوحة طويل جداً"),
  driverName: z
    .string()
    .min(1, "اسم السائق مطلوب")
    .max(100, "اسم السائق طويل جداً"),
  salesOrderNumber: z.string().max(20).optional().or(z.literal("")),
  // null = clear notes on PATCH; "" still accepted from registration forms
  notes: z.string().max(2000).optional().nullable(),
  requestItems: z.array(requestItemSchema).optional(),
  operationalGrade: z.enum(["FIRST", "SECOND"]).optional().nullable(),
});

export const truckUpdateSchema = truckRegisterSchema.partial().extend({
  expectedVersion: z.number().int().nonnegative("الإصدار المتوقّع غير صالح"),
});

// Hard rails on weights come from `weight-bounds.ts` so validator, service,
// and UI error messages stay in lockstep. `.finite()` rejects `Infinity`
// and `NaN` before the positive/min/max checks fire.
const weightKgSchema = z
  .number()
  .finite("قيمة الوزن غير صالحة")
  .positive("الوزن يجب أن يكون أكبر من صفر")
  .min(MIN_WEIGHT_KG, `الوزن يجب ألا يقل عن ${MIN_WEIGHT_KG} كغ`)
  .max(MAX_WEIGHT_KG, `الوزن يجب ألا يتجاوز ${MAX_WEIGHT_KG} كغ`);

export const tareSchema = z.object({ weightKg: weightKgSchema });

export const grossSchema = z.object({ weightKg: weightKgSchema });

// Corrections carry the version the client read, so concurrent edits are
// detected via optimistic locking. See correctTare/correctGross in
// truck.service.ts.
export const correctTareSchema = tareSchema.extend({
  expectedVersion: z.number().int().nonnegative("الإصدار المتوقّع غير صالح"),
});

export const correctGrossSchema = grossSchema.extend({
  expectedVersion: z.number().int().nonnegative("الإصدار المتوقّع غير صالح"),
});

// One internal weigh-session is a single batch inside the truck — cap at
// MAX_WEIGHT_KG / 1000 tons so the absolute hard rail applies here too.
const weightTonsSchema = z
  .number()
  .finite("قيمة الوزن غير صالحة")
  .positive("الوزن يجب أن يكون أكبر من صفر")
  .max(MAX_WEIGHT_KG / 1000, "الوزن كبير جداً");

export const weighSessionSchema = z.object({
  sizeId: z.number().int().positive().optional().nullable(),
  bundleCount: z.number().int().min(1).optional().nullable(),
  weightTons: weightTonsSchema,
});

export const weighSessionEditSchema = z.object({
  sizeId: z.number().int().positive().optional().nullable(),
  bundleCount: z.number().int().min(1).optional().nullable(),
  weightTons: weightTonsSchema.optional(),
  expectedVersion: z.number().int().nonnegative("الإصدار المتوقّع غير صالح"),
});

export const cancelSchema = z.object({
  reason: z.string().min(1, "سبب الإلغاء مطلوب").max(2000, "السبب طويل جداً"),
});
