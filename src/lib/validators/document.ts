import { z } from "zod";

const folderName = z
  .string()
  .trim()
  .min(1, "documentFolderNameRequired")
  .max(120, "documentFolderNameTooLong");

const folderNameEn = z
  .string()
  .trim()
  .max(120, "documentFolderNameTooLong")
  .optional()
  .or(z.literal(""));

export const folderWriteSchema = z.object({
  name: folderName,
  nameEn: folderNameEn,
});

export const folderCreateSchema = folderWriteSchema.extend({
  parentId: z.number().int().positive().nullable().optional(),
});

export const setFolderMembersSchema = z.object({
  members: z
    .array(
      z.object({
        userId: z.number().int().positive(),
        canUpload: z.boolean(),
      }),
    )
    .max(200),
});

export const documentMetaSchema = z.object({
  title: z.string().trim().max(200, "documentTitleTooLong").optional().or(z.literal("")),
  notes: z.string().trim().max(2000, "documentNotesTooLong").optional().or(z.literal("")),
});

export function parsePositiveInt(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

export type FolderWriteInput = z.infer<typeof folderWriteSchema>;
export type FolderCreateInput = z.infer<typeof folderCreateSchema>;
export type SetFolderMembersInput = z.infer<typeof setFolderMembersSchema>;
export type DocumentMetaInput = z.infer<typeof documentMetaSchema>;
