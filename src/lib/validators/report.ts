import { z } from "zod";

export const dailyTrucksReportQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "صيغة التاريخ غير صالحة (YYYY-MM-DD)"),
  customerId: z
    .preprocess(
      (v) => (v === "" || v === null || v === undefined ? undefined : v),
      z.coerce.number().int().positive().optional(),
    ),
  grade: z
    .preprocess(
      (v) => (v === "" || v === null || v === undefined ? undefined : v),
      z.enum(["FIRST", "SECOND"]).optional(),
    ),
});

export type DailyTrucksReportQuery = z.infer<typeof dailyTrucksReportQuerySchema>;
