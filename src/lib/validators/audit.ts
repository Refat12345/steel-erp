import { z } from "zod";
import { AuditAction } from "@prisma/client";

const auditActionValues = Object.values(AuditAction) as [string, ...string[]];
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function parseDateParam(value: string | undefined, endOfDay: boolean) {
  if (value == null || value.trim() === "") return undefined;
  if (!datePattern.test(value)) return null;

  const suffix = endOfDay ? "T23:59:59.999" : "T00:00:00.000";
  const date = new Date(`${value}${suffix}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Query-string filters for GET /api/admin/audit-logs */
export const auditLogListFiltersSchema = z.object({
  userId: z
    .union([z.string(), z.undefined()])
    .transform((s) => {
      if (s == null || s === "") return undefined;
      const n = parseInt(s, 10);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    }),
  action: z
    .union([z.enum(auditActionValues), z.literal(""), z.undefined()])
    .transform((v) => (v === "" || v === undefined ? undefined : v)),
  from: z
    .union([z.string(), z.undefined()])
    .transform((v, ctx) => {
      const parsed = parseDateParam(v, false);
      if (parsed === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "startDateInvalid",
        });
        return z.NEVER;
      }
      return parsed;
    }),
  to: z
    .union([z.string(), z.undefined()])
    .transform((v, ctx) => {
      const parsed = parseDateParam(v, true);
      if (parsed === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "endDateInvalid",
        });
        return z.NEVER;
      }
      return parsed;
    }),
}).superRefine((data, ctx) => {
  if (data.from && data.to && data.from > data.to) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "startDateBeforeEndDate",
      path: ["from"],
    });
  }
});

export type AuditLogListFiltersInput = z.infer<typeof auditLogListFiltersSchema>;
