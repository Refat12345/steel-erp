import { z } from "zod";

/** Declared (order) piece counter per length, entered at pre-registration. */
export const receiptExpectedLineSchema = z.object({
  billetLengthM: z
    .number({ message: "طول البيلت مطلوب" })
    .int("طول البيلت يجب أن يكون عدداً صحيحاً")
    .positive("طول البيلت يجب أن يكون أكبر من صفر"),
  expectedPieces: z
    .number({ message: "عدد القطع المعلن مطلوب" })
    .int("عدد القطع يجب أن يكون عدداً صحيحاً")
    .positive("عدد القطع يجب أن يكون أكبر من صفر"),
});

export const registerReceiptSchema = z
  .object({
    supplierContractNumber: z.string().min(1, "يجب اختيار عقد المورّد"),
    driverName: z
      .string()
      .trim()
      .min(1, "اسم السائق مطلوب")
      .max(120, "اسم السائق طويل جداً"),
    plateNumber: z
      .string()
      .trim()
      .min(1, "رقم اللوحة مطلوب")
      .max(40, "رقم اللوحة طويل جداً"),
    driverNationalId: z.string().max(40).optional().or(z.literal("")),
    declaredWeightKg: z
      .number({ message: "وزن الطلبية المعلن مطلوب" })
      .positive("وزن الطلبية يجب أن يكون أكبر من صفر"),
    bundleCount: z.number().int().positive().nullable().optional(),
    notes: z.string().max(2000).optional().or(z.literal("")),
    pieceLines: z
      .array(receiptExpectedLineSchema)
      .min(1, "أضف عدد القطع المعلن لطول واحد على الأقل"),
  })
  .superRefine((data, ctx) => {
    const lengths = data.pieceLines.map((l) => l.billetLengthM);
    if (new Set(lengths).size !== lengths.length) {
      ctx.addIssue({
        code: "custom",
        message: "لا يمكن تكرار نفس الطول في الطلبية",
        path: ["pieceLines"],
      });
    }
  });

export const updateReceiptRegistrationSchema = registerReceiptSchema;

/** External weighbridge: loaded (gross) weight on entry. */
export const loadedWeightSchema = z.object({
  weightKg: z
    .number({ message: "الوزن مطلوب" })
    .positive("الوزن يجب أن يكون أكبر من صفر"),
});

/** External weighbridge: empty (tare) weight on exit → closes the receipt. */
export const completeReceiptSchema = z.object({
  weightKg: z
    .number({ message: "الوزن مطلوب" })
    .positive("الوزن يجب أن يكون أكبر من صفر"),
});

/** Internal loader: counted + rejected pieces per registered length. */
export const unloadResultLineSchema = z.object({
  billetLengthM: z.number().int().positive(),
  countedPieces: z
    .number({ message: "عدد القطع المعدود مطلوب" })
    .int("عدد القطع يجب أن يكون عدداً صحيحاً")
    .min(0, "عدد القطع لا يمكن أن يكون سالباً"),
  rejectedPieces: z
    .number()
    .int("عدد المرتجع يجب أن يكون عدداً صحيحاً")
    .min(0, "عدد المرتجع لا يمكن أن يكون سالباً")
    .default(0),
});

export const unloadResultSchema = z
  .object({
    lines: z.array(unloadResultLineSchema).min(1, "أدخل عدد القطع المعدود"),
    mismatchReason: z.string().max(1000).optional().or(z.literal("")),
  })
  .superRefine((data, ctx) => {
    const lengths = data.lines.map((l) => l.billetLengthM);
    if (new Set(lengths).size !== lengths.length) {
      ctx.addIssue({
        code: "custom",
        message: "لا يمكن تكرار نفس الطول",
        path: ["lines"],
      });
    }
    for (const [i, line] of data.lines.entries()) {
      if (line.rejectedPieces > line.countedPieces) {
        ctx.addIssue({
          code: "custom",
          message: "المرتجع لا يمكن أن يتجاوز المعدود",
          path: ["lines", i, "rejectedPieces"],
        });
      }
    }
  });

export const cancelReceiptSchema = z.object({
  reason: z.string().trim().min(1, "يجب إدخال سبب الإلغاء").max(500),
});

export type RegisterReceiptInput = z.infer<typeof registerReceiptSchema>;
export type UpdateReceiptRegistrationInput = z.infer<
  typeof updateReceiptRegistrationSchema
>;
export type LoadedWeightInput = z.infer<typeof loadedWeightSchema>;
export type CompleteReceiptInput = z.infer<typeof completeReceiptSchema>;
export type UnloadResultInput = z.infer<typeof unloadResultSchema>;
export type UnloadResultLineInput = z.infer<typeof unloadResultLineSchema>;
export type CancelReceiptInput = z.infer<typeof cancelReceiptSchema>;
