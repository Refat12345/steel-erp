import { z } from "zod";

const permissionToggleSchema = z.object({
  code: z.string().min(1, "رمز الصلاحية مطلوب"),
  enabled: z.boolean(),
});

export const setUserPermissionsSchema = z.object({
  permissions: z
    .array(permissionToggleSchema)
    .min(1, "يجب تحديد صلاحية واحدة على الأقل")
    .max(200, "عدد الصلاحيات كبير جداً"),
});

export const copyUserPermissionsSchema = z.object({
  sourceUserId: z.number().int().positive("معرّف المستخدم المصدر غير صالح"),
});
