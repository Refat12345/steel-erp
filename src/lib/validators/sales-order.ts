import { z } from "zod";

const KIND_VALUES = ["REBAR", "SHORTBAR_1_4M", "SHORTBAR_4_12M", "SCRAP", "BILLET_WIRE", "REBAR_UNDER_70CM", "BILLET_SCRAP_10M", "SCRAP_50CM_1M"] as const;
const GRADE_VALUES = ["FIRST", "SECOND"] as const;
const SETTLEMENT_VALUES = ["CREDIT", "PAYMENT_PLAN"] as const;
const TOLERANCE_VALUES = ["percentage", "weight"] as const;
const STATUS_VALUES = ["draft", "approved", "in_progress", "completed", "cancelled"] as const;

export const salesOrderCreateSchema = z
  .object({
    contractNumber: z.string().min(1, "رقم العقد مطلوب"),
    kind: z.enum(KIND_VALUES, { message: "نوع أمر البيع مطلوب" }),
    grade: z.enum(GRADE_VALUES).optional().nullable(),
    settlementMode: z.enum(SETTLEMENT_VALUES, { message: "نمط التسوية مطلوب" }),
    paymentDeadlineDays: z.number().int().positive().optional().nullable(),
    totalQtyTons: z
      .number({ message: "الكمية الإجمالية مطلوبة" })
      .positive("الكمية يجب أن تكون أكبر من صفر"),
    toleranceType: z.enum(TOLERANCE_VALUES, { message: "نوع السماحية مطلوب" }),
    toleranceValue: z
      .number({ message: "قيمة السماحية مطلوبة" })
      .min(0, "السماحية لا يمكن أن تكون سلبية"),
    specialRatioPct: z
      .number()
      .min(0)
      .max(100, "النسبة الخاصة يجب أن تكون بين 0 و100")
      .optional()
      .nullable(),
    orderDate: z.string().min(1, "تاريخ الأمر مطلوب"),
    deliveryDate: z.string().min(1, "تاريخ التسليم المتوقع مطلوب"),
    notes: z.string().max(2000).optional().or(z.literal("")),
  })
  .superRefine((data, ctx) => {
    if (data.kind === "REBAR" && !data.grade) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "النخب مطلوب لأوامر بيع المبروم",
        path: ["grade"],
      });
    }
    if (data.kind !== "REBAR" && data.grade) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "النخب يُحدد فقط لأوامر بيع المبروم",
        path: ["grade"],
      });
    }
    if (data.settlementMode === "CREDIT" && !data.paymentDeadlineDays) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "مهلة السداد مطلوبة لأوامر البيع الآجلة",
        path: ["paymentDeadlineDays"],
      });
    }
    if (data.settlementMode === "PAYMENT_PLAN" && data.paymentDeadlineDays) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "مهلة السداد تُحدد فقط لأوامر البيع الآجلة",
        path: ["paymentDeadlineDays"],
      });
    }
    if (data.kind !== "REBAR" && data.specialRatioPct != null && data.specialRatioPct > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "النسبة الخاصة تُستخدم فقط لأوامر بيع المبروم",
        path: ["specialRatioPct"],
      });
    }
  });

export const salesOrderUpdateSchema = z.object({
  status: z.enum(STATUS_VALUES).optional(),
  statusReason: z.string().min(1, "سبب تغيير الحالة مطلوب").optional(),
  notes: z.string().max(2000).optional().or(z.literal("")),
  totalQtyTons: z.number().positive("الكمية يجب أن تكون أكبر من صفر").optional(),
  toleranceType: z.enum(TOLERANCE_VALUES).optional(),
  toleranceValue: z.number().min(0).optional(),
  specialRatioPct: z.number().min(0).max(100).optional().nullable(),
  deliveryDate: z.string().optional(),
});

export const orderItemSchema = z.object({
  sizeId: z.number().int().positive("القياس مطلوب"),
  pricePerTon: z.number().positive("السعر يجب أن يكون أكبر من صفر"),
});

export const orderItemsSetSchema = z.object({
  items: z.array(orderItemSchema).min(1, "يجب إضافة بند سعر واحد على الأقل"),
});

export type SalesOrderCreateInput = z.infer<typeof salesOrderCreateSchema>;
export type SalesOrderUpdateInput = z.infer<typeof salesOrderUpdateSchema>;
export type OrderItemInput = z.infer<typeof orderItemSchema>;
export type OrderItemsSetInput = z.infer<typeof orderItemsSetSchema>;
