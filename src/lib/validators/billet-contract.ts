import { z } from "zod";
import { SupplierContractStatus } from "@prisma/client";

const supplierContractStatusValues = Object.values(
  SupplierContractStatus,
) as [string, ...string[]];

/** One per-length piece counter on a supplier contract. */
export const contractPieceLineSchema = z.object({
  billetLengthM: z
    .number({ message: "طول البيلت مطلوب" })
    .int("طول البيلت يجب أن يكون عدداً صحيحاً")
    .positive("طول البيلت يجب أن يكون أكبر من صفر"),
  contractedPieces: z
    .number({ message: "عدد القطع مطلوب" })
    .int("عدد القطع يجب أن يكون عدداً صحيحاً")
    .positive("عدد القطع يجب أن يكون أكبر من صفر"),
});

export const billetContractCreateSchema = z
  .object({
    supplierName: z
      .string()
      .trim()
      .min(1, "اسم المورّد مطلوب")
      .max(200, "اسم المورّد طويل جداً"),
    contractedWeightKg: z
      .number({ message: "الوزن الإجمالي مطلوب" })
      .positive("الوزن الإجمالي يجب أن يكون أكبر من صفر"),
    // ISO date string (yyyy-mm-dd); defaults to today server-side when empty.
    contractDate: z.string().optional().or(z.literal("")),
    notes: z.string().max(2000).optional().or(z.literal("")),
    pieceLines: z
      .array(contractPieceLineSchema)
      .min(1, "أضف عدد القطع لطول واحد على الأقل"),
  })
  .superRefine((data, ctx) => {
    const lengths = data.pieceLines.map((l) => l.billetLengthM);
    if (new Set(lengths).size !== lengths.length) {
      ctx.addIssue({
        code: "custom",
        message: "لا يمكن تكرار نفس الطول في العقد",
        path: ["pieceLines"],
      });
    }
  });

export const billetContractUpdateSchema = z
  .object({
    supplierName: z
      .string()
      .trim()
      .min(1, "اسم المورّد مطلوب")
      .max(200, "اسم المورّد طويل جداً")
      .optional(),
    contractedWeightKg: z
      .number({ message: "الوزن الإجمالي مطلوب" })
      .positive("الوزن الإجمالي يجب أن يكون أكبر من صفر")
      .optional(),
    notes: z.string().max(2000).optional().or(z.literal("")),
    pieceLines: z
      .array(contractPieceLineSchema)
      .min(1, "أضف عدد القطع لطول واحد على الأقل")
      .optional(),
    status: z.enum(supplierContractStatusValues).optional(),
    statusReason: z.string().min(1, "سبب تغيير الحالة مطلوب").optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.pieceLines) return;
    const lengths = data.pieceLines.map((l) => l.billetLengthM);
    if (new Set(lengths).size !== lengths.length) {
      ctx.addIssue({
        code: "custom",
        message: "لا يمكن تكرار نفس الطول في العقد",
        path: ["pieceLines"],
      });
    }
  });

export type BilletContractCreateInput = z.infer<typeof billetContractCreateSchema>;
export type BilletContractUpdateInput = z.infer<typeof billetContractUpdateSchema>;
export type ContractPieceLineInput = z.infer<typeof contractPieceLineSchema>;
