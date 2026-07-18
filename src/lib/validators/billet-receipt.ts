import { z } from "zod";

/** Declared (order) piece counter per length, entered at pre-registration. */
export const receiptExpectedLineSchema = z.object({
  billetLengthM: z
    .number({ message: "billetLengthRequired" })
    .int("billetLengthMustBeInteger")
    .positive("billetLengthMustBePositive"),
  expectedPieces: z
    .number({ message: "expectedPiecesRequired" })
    .int("pieceCountMustBeInteger")
    .positive("pieceCountMustBePositive"),
});

export const registerReceiptSchema = z
  .object({
    supplierContractNumber: z.string().min(1, "supplierContractRequired"),
    driverName: z
      .string()
      .trim()
      .min(1, "driverNameRequired")
      .max(120, "driverNameTooLong"),
    plateNumber: z
      .string()
      .trim()
      .min(1, "plateNumberRequired")
      .max(40, "plateNumberTooLong"),
    driverNationalId: z.string().max(40).optional().or(z.literal("")),
    declaredWeightKg: z
      .number({ message: "declaredWeightRequired" })
      .positive("declaredWeightMustBePositive"),
    bundleCount: z.number().int().positive().nullable().optional(),
    notes: z.string().max(2000).optional().or(z.literal("")),
    pieceLines: z
      .array(receiptExpectedLineSchema)
      .min(1, "atLeastOnePieceLineRequired"),
  })
  .superRefine((data, ctx) => {
    const lengths = data.pieceLines.map((l) => l.billetLengthM);
    if (new Set(lengths).size !== lengths.length) {
      ctx.addIssue({
        code: "custom",
        message: "duplicateLengthInReceipt",
        path: ["pieceLines"],
      });
    }
  });

export const updateReceiptRegistrationSchema = registerReceiptSchema;

/** External weighbridge: loaded (gross) weight on entry. */
export const loadedWeightSchema = z.object({
  weightKg: z
    .number({ message: "weightRequired" })
    .positive("weightMustBePositive"),
});

/** External weighbridge: empty (tare) weight on exit → closes the receipt. */
export const completeReceiptSchema = z.object({
  weightKg: z
    .number({ message: "weightRequired" })
    .positive("weightMustBePositive"),
});

/** Internal loader: counted + rejected pieces per registered length. */
export const unloadResultLineSchema = z.object({
  billetLengthM: z.number().int().positive(),
  countedPieces: z
    .number({ message: "countedPiecesRequired" })
    .int("pieceCountMustBeInteger")
    .min(0, "pieceCountCannotBeNegative"),
  rejectedPieces: z
    .number()
    .int("rejectedPiecesMustBeInteger")
    .min(0, "rejectedPiecesCannotBeNegative")
    .default(0),
});

export const unloadResultSchema = z
  .object({
    lines: z.array(unloadResultLineSchema).min(1, "enterCountedPieces"),
    mismatchReason: z.string().max(1000).optional().or(z.literal("")),
  })
  .superRefine((data, ctx) => {
    const lengths = data.lines.map((l) => l.billetLengthM);
    if (new Set(lengths).size !== lengths.length) {
      ctx.addIssue({
        code: "custom",
        message: "duplicateLength",
        path: ["lines"],
      });
    }
    for (const [i, line] of data.lines.entries()) {
      if (line.rejectedPieces > line.countedPieces) {
        ctx.addIssue({
          code: "custom",
          message: "rejectedCannotExceedCounted",
          path: ["lines", i, "rejectedPieces"],
        });
      }
    }
  });

export const cancelReceiptSchema = z.object({
  reason: z.string().trim().min(1, "cancelReasonMustBeEntered").max(500),
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
