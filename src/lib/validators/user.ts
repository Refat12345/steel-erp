import { z } from "zod";

export const createUserSchema = z.object({
  username: z
    .string()
    .min(3, "usernameMinLength")
    .max(50)
    .regex(/^[a-zA-Z0-9_]+$/, "usernameAlphanumericOnly"),
  fullName: z.string().min(2, "fullNameRequired").max(100),
  password: z.string().min(6, "passwordMinLength").max(100),
  roleCode: z.string().min(1, "roleRequired"),
});

export const updateUserSchema = z.object({
  fullName: z.string().min(2, "fullNameRequired").max(100).optional(),
  roleCode: z.string().min(1, "roleRequired").optional(),
  isActive: z.boolean().optional(),
});

export const resetPasswordSchema = z.object({
  newPassword: z.string().min(6, "passwordMinLength").max(100),
});
