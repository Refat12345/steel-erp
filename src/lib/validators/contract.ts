import { z } from "zod";
import { ContractStatus } from "@prisma/client";

const contractStatusValues = Object.values(ContractStatus) as [string, ...string[]];

export const contractCreateSchema = z.object({
  customerId: z
    .number({ message: "customerMustBeSelected" })
    .int()
    .positive("customerMustBeSelected"),
  notes: z.string().max(2000).optional().or(z.literal("")),
});

export const contractCreateWithAttachmentSchema = contractCreateSchema.extend({
  attachmentPath: z.string().min(1, "signedContractScanRequired"),
  attachmentName: z.string().default(""),
  attachmentSize: z.number().int().min(0).default(0),
});

export const contractUpdateSchema = z.object({
  notes: z.string().max(2000).optional().or(z.literal("")),
  status: z.enum(contractStatusValues).optional(),
  statusReason: z.string().min(1, "statusChangeReasonRequired").optional(),
});

export const attachmentUploadSchema = z.object({
  filePath: z.string().min(1, "filePathRequired"),
  fileName: z.string().min(1, "fileNameRequired"),
  fileSize: z.number().int().min(0).default(0),
});

export type ContractCreateInput = z.infer<typeof contractCreateSchema>;
export type ContractCreateWithAttachmentInput = z.infer<typeof contractCreateWithAttachmentSchema>;
export type ContractUpdateInput = z.infer<typeof contractUpdateSchema>;
export type AttachmentUploadInput = z.infer<typeof attachmentUploadSchema>;
