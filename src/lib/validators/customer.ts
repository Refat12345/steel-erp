import { z } from "zod";

export const customerCreateSchema = z.object({
  fullName: z
    .string()
    .min(3, "fullNameMinLength")
    .max(200),
  fatherName: z
    .string()
    .min(1, "fatherNameRequired")
    .max(200),
  nationalId: z
    .string()
    .min(1, "nationalIdRequired")
    .max(50),
  phonePrimary: z
    .string()
    .min(1, "primaryPhoneRequired")
    .max(30),
  phoneSecondary: z.string().max(30).optional().or(z.literal("")),
  companyAddress: z
    .string()
    .min(1, "companyAddressRequired")
    .max(500),
  commercialRegistration: z.string().max(100).optional().or(z.literal("")),
  notes: z.string().max(2000).optional().or(z.literal("")),
});

export const customerUpdateSchema = customerCreateSchema.partial();

export type CustomerCreateInput = z.infer<typeof customerCreateSchema>;
export type CustomerUpdateInput = z.infer<typeof customerUpdateSchema>;
