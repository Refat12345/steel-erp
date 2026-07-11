import { z } from "zod";

const productFilterValues = ["FIRST", "SECOND", "SHORTBAR", "SCRAP", "BILLET_WIRE", "REBAR_UNDER_70CM", "BILLET_SCRAP_10M", "SCRAP_50CM_1M"] as const;

const baseReportQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "صيغة التاريخ غير صالحة (YYYY-MM-DD)"),
  customerId: z
    .preprocess(
      (v) => (v === "" || v === null || v === undefined ? undefined : v),
      z.coerce.number().int().positive().optional(),
    ),
  /** Preferred query param — rebar grade, combined shortbar, or scrap. */
  product: z
    .preprocess(
      (v) => (v === "" || v === null || v === undefined ? undefined : v),
      z.enum(productFilterValues).optional(),
    ),
  /** @deprecated Use `product` — kept for existing report links. */
  grade: z
    .preprocess(
      (v) => (v === "" || v === null || v === undefined ? undefined : v),
      z.enum(["FIRST", "SECOND"]).optional(),
    ),
});

export const dailyTrucksReportQuerySchema = baseReportQuerySchema.transform(
  (data) => ({
    date: data.date,
    customerId: data.customerId,
    productFilter: data.product ?? data.grade,
  }),
);

export type DailyTrucksReportQuery = z.infer<typeof dailyTrucksReportQuerySchema>;

export const loadingSummaryQuerySchema = baseReportQuerySchema
  .extend({
    period: z.preprocess(
      (v) => (v === "" || v === null || v === undefined ? undefined : v),
      z.enum(["daily", "weekly", "monthly"]).optional(),
    ),
  })
  .transform((data) => ({
    date: data.date,
    customerId: data.customerId,
    productFilter: data.product ?? data.grade,
    period: data.period,
  }));

export type LoadingSummaryQuery = z.infer<typeof loadingSummaryQuerySchema>;

const dateInputSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)");

export const customerWithdrawalsQuerySchema = z.object({
  from: dateInputSchema,
  to: dateInputSchema,
  customerId: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : v),
    z.coerce.number().int().positive().optional(),
  ),
  sizeId: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : v),
    z.coerce.number().int().positive().optional(),
  ),
});

export type CustomerWithdrawalsQuery = z.infer<
  typeof customerWithdrawalsQuerySchema
>;

export const billetBalanceQuerySchema = z.object({
  supplierName: z.string().trim().min(1, "Supplier is required"),
  contractNumber: z
    .preprocess(
      (v) => (v === "" || v === null || v === undefined ? undefined : v),
      z.string().trim().min(1).optional(),
    ),
});

export type BilletBalanceQuery = z.infer<typeof billetBalanceQuerySchema>;
