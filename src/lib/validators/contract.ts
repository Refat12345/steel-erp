import { z } from "zod";
import { ContractStatus } from "@prisma/client";

const contractStatusValues = Object.values(ContractStatus) as [string, ...string[]];

export const contractCreateSchema = z.object({
  customerId: z
    .number({ message: "يجب اختيار عميل" })
    .int()
    .positive("يجب اختيار عميل"),
  notes: z.string().max(2000).optional().or(z.literal("")),
});

export const contractCreateWithAttachmentSchema = contractCreateSchema.extend({
  attachmentPath: z.string().min(1, "يجب رفع نسخة ممسوحة من العقد الموقّع"),
  attachmentName: z.string().default(""),
  attachmentSize: z.number().int().min(0).default(0),
});

export const contractUpdateSchema = z.object({
  notes: z.string().max(2000).optional().or(z.literal("")),
  status: z.enum(contractStatusValues).optional(),
  statusReason: z.string().min(1, "سبب تغيير الحالة مطلوب").optional(),
});

export const attachmentUploadSchema = z.object({
  filePath: z.string().min(1, "مسار الملف مطلوب"),
  fileName: z.string().min(1, "اسم الملف مطلوب"),
  fileSize: z.number().int().min(0).default(0),
});

export type ContractCreateInput = z.infer<typeof contractCreateSchema>;
export type ContractCreateWithAttachmentInput = z.infer<typeof contractCreateWithAttachmentSchema>;
export type ContractUpdateInput = z.infer<typeof contractUpdateSchema>;
export type AttachmentUploadInput = z.infer<typeof attachmentUploadSchema>;
