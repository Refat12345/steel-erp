import { z } from "zod";

export const createUserSchema = z.object({
  username: z
    .string()
    .min(3, "اسم المستخدم يجب أن يكون 3 أحرف على الأقل")
    .max(50)
    .regex(/^[a-zA-Z0-9_]+$/, "اسم المستخدم يجب أن يحتوي على أحرف إنجليزية وأرقام فقط"),
  fullName: z.string().min(2, "الاسم الكامل مطلوب").max(100),
  password: z.string().min(6, "كلمة المرور يجب أن تكون 6 أحرف على الأقل").max(100),
  roleCode: z.string().min(1, "الدور مطلوب"),
});

export const updateUserSchema = z.object({
  fullName: z.string().min(2, "الاسم الكامل مطلوب").max(100).optional(),
  roleCode: z.string().min(1, "الدور مطلوب").optional(),
  isActive: z.boolean().optional(),
});

export const resetPasswordSchema = z.object({
  newPassword: z.string().min(6, "كلمة المرور يجب أن تكون 6 أحرف على الأقل").max(100),
});
