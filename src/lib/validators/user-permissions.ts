import { z } from "zod";

const permissionToggleSchema = z.object({
  code: z.string().min(1, "permissionCodeRequired"),
  enabled: z.boolean(),
});

export const setUserPermissionsSchema = z.object({
  permissions: z
    .array(permissionToggleSchema)
    .min(1, "atLeastOnePermissionRequired")
    .max(200, "permissionsCountTooLarge"),
});

export const copyUserPermissionsSchema = z.object({
  sourceUserId: z.number().int().positive("sourceUserIdInvalid"),
});
