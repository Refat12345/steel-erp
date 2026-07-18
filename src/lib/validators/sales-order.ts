import { z } from "zod";

const KIND_VALUES = ["REBAR", "SHORTBAR_1_4M", "SHORTBAR_4_12M", "SCRAP", "BILLET_WIRE", "REBAR_UNDER_70CM", "BILLET_SCRAP_10M", "SCRAP_50CM_1M"] as const;
const GRADE_VALUES = ["FIRST", "SECOND"] as const;
const SETTLEMENT_VALUES = ["CREDIT", "PAYMENT_PLAN"] as const;
const TOLERANCE_VALUES = ["percentage", "weight"] as const;
const STATUS_VALUES = ["draft", "approved", "in_progress", "completed", "cancelled"] as const;

export const salesOrderCreateSchema = z
  .object({
    contractNumber: z.string().min(1, "contractNumberRequired"),
    kind: z.enum(KIND_VALUES, { message: "orderKindRequired" }),
    grade: z.enum(GRADE_VALUES).optional().nullable(),
    settlementMode: z.enum(SETTLEMENT_VALUES, { message: "settlementModeRequired" }),
    paymentDeadlineDays: z.number().int().positive().optional().nullable(),
    totalQtyTons: z
      .number({ message: "totalQuantityRequired" })
      .positive("quantityMustBePositive"),
    toleranceType: z.enum(TOLERANCE_VALUES, { message: "toleranceTypeRequired" }),
    toleranceValue: z
      .number({ message: "toleranceValueRequired" })
      .min(0, "toleranceCannotBeNegative"),
    specialRatioPct: z
      .number()
      .min(0)
      .max(100, "specialRatioRange")
      .optional()
      .nullable(),
    orderDate: z.string().min(1, "orderDateRequired"),
    deliveryDate: z.string().min(1, "deliveryDateRequired"),
    notes: z.string().max(2000).optional().or(z.literal("")),
  })
  .superRefine((data, ctx) => {
    if (data.kind === "REBAR" && !data.grade) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "gradeRequiredForRebar",
        path: ["grade"],
      });
    }
    if (data.kind !== "REBAR" && data.grade) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "gradeOnlyForRebar",
        path: ["grade"],
      });
    }
    if (data.settlementMode === "CREDIT" && !data.paymentDeadlineDays) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "paymentDeadlineRequiredForCredit",
        path: ["paymentDeadlineDays"],
      });
    }
    if (data.settlementMode === "PAYMENT_PLAN" && data.paymentDeadlineDays) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "paymentDeadlineOnlyForCredit",
        path: ["paymentDeadlineDays"],
      });
    }
    if (data.kind !== "REBAR" && data.specialRatioPct != null && data.specialRatioPct > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "specialRatioOnlyForRebar",
        path: ["specialRatioPct"],
      });
    }
  });

export const salesOrderUpdateSchema = z.object({
  status: z.enum(STATUS_VALUES).optional(),
  statusReason: z.string().min(1, "statusChangeReasonRequired").optional(),
  notes: z.string().max(2000).optional().or(z.literal("")),
  totalQtyTons: z.number().positive("quantityMustBePositive").optional(),
  toleranceType: z.enum(TOLERANCE_VALUES).optional(),
  toleranceValue: z.number().min(0).optional(),
  specialRatioPct: z.number().min(0).max(100).optional().nullable(),
  deliveryDate: z.string().optional(),
});

export const orderItemSchema = z.object({
  sizeId: z.number().int().positive("sizeRequired"),
  pricePerTon: z.number().positive("priceMustBePositive"),
});

export const orderItemsSetSchema = z.object({
  items: z.array(orderItemSchema).min(1, "atLeastOnePriceItemRequired"),
});

export type SalesOrderCreateInput = z.infer<typeof salesOrderCreateSchema>;
export type SalesOrderUpdateInput = z.infer<typeof salesOrderUpdateSchema>;
export type OrderItemInput = z.infer<typeof orderItemSchema>;
export type OrderItemsSetInput = z.infer<typeof orderItemsSetSchema>;
