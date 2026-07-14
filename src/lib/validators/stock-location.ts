import { z } from "zod";
import { StockLocationSegment, StockUnit, SalesOrderGrade } from "@prisma/client";

const segmentValues = Object.values(StockLocationSegment) as [string, ...string[]];

/**
 * A location's counting unit and commercial grade are DERIVED from its
 * segment so an inconsistent combination (e.g. a short-bar site counted in
 * bundles) can never be persisted. The setup UI only picks the segment.
 *
 * - GENERAL / GOVERNORATES → first-grade rebar, counted in bundles
 * - ISOLATION              → second-grade rebar, counted in bundles
 * - SHORTBAR               → no grade, counted in tons
 */
export function deriveUnitAndGrade(segment: StockLocationSegment): {
  unit: StockUnit;
  allowedGrade: SalesOrderGrade | null;
} {
  switch (segment) {
    case StockLocationSegment.SHORTBAR:
      return { unit: StockUnit.TON, allowedGrade: null };
    case StockLocationSegment.ISOLATION:
      return { unit: StockUnit.BUNDLE, allowedGrade: SalesOrderGrade.SECOND };
    case StockLocationSegment.GENERAL:
    case StockLocationSegment.GOVERNORATES:
    default:
      return { unit: StockUnit.BUNDLE, allowedGrade: SalesOrderGrade.FIRST };
  }
}

/** Location code: letters/digits/dash only, uppercased, frozen after movements. */
const locationCodeSchema = z
  .string()
  .trim()
  .min(1, "كود الموقع مطلوب")
  .max(20, "كود الموقع طويل جداً")
  .regex(/^[A-Za-z0-9-]+$/, "الكود يقبل أحرفاً إنجليزية وأرقاماً وشرطة فقط");

const gridSchema = {
  gridRow: z
    .number({ message: "الصف مطلوب" })
    .int("الصف يجب أن يكون عدداً صحيحاً")
    .min(1, "الصف يجب أن يكون 1 أو أكثر")
    .max(50, "قيمة الصف كبيرة جداً"),
  gridCol: z
    .number({ message: "العمود مطلوب" })
    .int("العمود يجب أن يكون عدداً صحيحاً")
    .min(1, "العمود يجب أن يكون 1 أو أكثر")
    .max(50, "قيمة العمود كبيرة جداً"),
  gridSpan: z
    .number()
    .int("الامتداد يجب أن يكون عدداً صحيحاً")
    .min(1, "الامتداد يجب أن يكون 1 أو أكثر")
    .max(20, "قيمة الامتداد كبيرة جداً")
    .optional(),
};

export const stockLocationCreateSchema = z.object({
  yardId: z.number({ message: "الساحة مطلوبة" }).int().positive("الساحة مطلوبة"),
  code: locationCodeSchema,
  nameAr: z
    .string()
    .trim()
    .min(1, "اسم الموقع مطلوب")
    .max(100, "اسم الموقع طويل جداً"),
  segment: z.enum(segmentValues),
  expectedSizeId: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional(),
  notes: z.string().max(1000).optional().or(z.literal("")),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  ...gridSchema,
});

export const stockLocationUpdateSchema = z.object({
  // Code is editable ONLY while the location has no movements; the service
  // enforces that. It is optional here so the client can omit it.
  code: locationCodeSchema.optional(),
  nameAr: z
    .string()
    .trim()
    .min(1, "اسم الموقع مطلوب")
    .max(100, "اسم الموقع طويل جداً")
    .optional(),
  segment: z.enum(segmentValues).optional(),
  expectedSizeId: z.number().int().positive().nullable().optional(),
  notes: z.string().max(1000).optional().or(z.literal("")),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
  gridRow: gridSchema.gridRow.optional(),
  gridCol: gridSchema.gridCol.optional(),
  gridSpan: gridSchema.gridSpan,
});

export type StockLocationCreateInput = z.infer<typeof stockLocationCreateSchema>;
export type StockLocationUpdateInput = z.infer<typeof stockLocationUpdateSchema>;
