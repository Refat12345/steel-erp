import { z } from "zod";
import { SupplierContractStatus } from "@prisma/client";

const supplierContractStatusValues = Object.values(
  SupplierContractStatus,
) as [string, ...string[]];

/** One per-length piece counter on a supplier contract. */
export const contractPieceLineSchema = z.object({
  billetLengthM: z
    .number({ message: "billetLengthRequired" })
    .int("billetLengthMustBeInteger")
    .positive("billetLengthMustBePositive"),
  contractedPieces: z
    .number({ message: "pieceCountRequired" })
    .int("pieceCountMustBeInteger")
    .positive("pieceCountMustBePositive"),
});

export const billetContractCreateSchema = z
  .object({
    supplierName: z
      .string()
      .trim()
      .min(1, "supplierNameRequired")
      .max(200, "supplierNameTooLong"),
    contractedWeightKg: z
      .number({ message: "totalWeightRequired" })
      .positive("totalWeightMustBePositive"),
    // ISO date string (yyyy-mm-dd); defaults to today server-side when empty.
    contractDate: z.string().optional().or(z.literal("")),
    notes: z.string().max(2000).optional().or(z.literal("")),
    pieceLines: z
      .array(contractPieceLineSchema)
      .min(1, "atLeastOnePieceCountLineRequired"),
  })
  .superRefine((data, ctx) => {
    const lengths = data.pieceLines.map((l) => l.billetLengthM);
    if (new Set(lengths).size !== lengths.length) {
      ctx.addIssue({
        code: "custom",
        message: "duplicateLengthInContract",
        path: ["pieceLines"],
      });
    }
  });

export const billetContractUpdateSchema = z
  .object({
    supplierName: z
      .string()
      .trim()
      .min(1, "supplierNameRequired")
      .max(200, "supplierNameTooLong")
      .optional(),
    contractedWeightKg: z
      .number({ message: "totalWeightRequired" })
      .positive("totalWeightMustBePositive")
      .optional(),
    notes: z.string().max(2000).optional().or(z.literal("")),
    pieceLines: z
      .array(contractPieceLineSchema)
      .min(1, "atLeastOnePieceCountLineRequired")
      .optional(),
    status: z.enum(supplierContractStatusValues).optional(),
    statusReason: z.string().min(1, "statusChangeReasonRequired").optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.pieceLines) return;
    const lengths = data.pieceLines.map((l) => l.billetLengthM);
    if (new Set(lengths).size !== lengths.length) {
      ctx.addIssue({
        code: "custom",
        message: "duplicateLengthInContract",
        path: ["pieceLines"],
      });
    }
  });

export const priorWithdrawalLineSchema = z.object({
  billetLengthM: z
    .number({ message: "billetLengthRequired" })
    .int("billetLengthMustBeInteger")
    .positive("billetLengthMustBePositive"),
  acceptedPieces: z
    .number({ message: "pieceCountRequired" })
    .int("pieceCountMustBeInteger")
    .positive("pieceCountMustBePositive"),
});

export const priorWithdrawalSchema = z
  .object({
    netWeightKg: z
      .number({ message: "netWeightRequired" })
      .positive("netWeightMustBePositive"),
    withdrawalDate: z.string().optional().or(z.literal("")),
    notes: z
      .string()
      .trim()
      .min(1, "priorWithdrawalNoteRequired")
      .max(2000, "noteTooLong"),
    /// Piece counts are optional — a prior withdrawal may be weight-only.
    pieceLines: z.array(priorWithdrawalLineSchema).default([]),
  })
  .superRefine((data, ctx) => {
    const lengths = data.pieceLines.map((l) => l.billetLengthM);
    if (new Set(lengths).size !== lengths.length) {
      ctx.addIssue({
        code: "custom",
        message: "duplicateLength",
        path: ["pieceLines"],
      });
    }
  });

export const contractAdjustmentLineSchema = z.object({
  billetLengthM: z
    .number({ message: "billetLengthRequired" })
    .int("billetLengthMustBeInteger")
    .positive("billetLengthMustBePositive"),
  /// Signed delta: positive adds to received pieces, negative removes.
  pieces: z
    .number({ message: "pieceCountRequired" })
    .int("pieceCountMustBeInteger")
    .refine((v) => v !== 0, "pieceCountCannotBeZero"),
});

export const contractAdjustmentSchema = z
  .object({
    /// Signed delta in kg: positive adds to received weight, negative removes.
    netWeightKg: z
      .number({ message: "weightRequired" })
      .finite("weightInvalid")
      .default(0),
    notes: z
      .string()
      .trim()
      .min(1, "adjustmentReasonRequired")
      .max(2000, "noteTooLong"),
    pieceLines: z.array(contractAdjustmentLineSchema).default([]),
  })
  .superRefine((data, ctx) => {
    const lengths = data.pieceLines.map((l) => l.billetLengthM);
    if (new Set(lengths).size !== lengths.length) {
      ctx.addIssue({
        code: "custom",
        message: "duplicateLength",
        path: ["pieceLines"],
      });
    }
    if (data.netWeightKg === 0 && data.pieceLines.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "adjustmentWeightOrPiecesRequired",
        path: ["netWeightKg"],
      });
    }
  });

export type BilletContractCreateInput = z.infer<typeof billetContractCreateSchema>;
export type BilletContractUpdateInput = z.infer<typeof billetContractUpdateSchema>;
export type ContractPieceLineInput = z.infer<typeof contractPieceLineSchema>;
export type PriorWithdrawalInput = z.infer<typeof priorWithdrawalSchema>;
export type ContractAdjustmentInput = z.infer<typeof contractAdjustmentSchema>;
