import { z } from "zod";

export const paymentCreateSchema = z.object({
  customerId: z.number().int().positive("clientRequired"),
  amount: z
    .number()
    .positive("amountMustBePositive")
    .max(999_999_999_999, "amountTooLarge"),
  method: z.enum(["CASH", "BANK_TRANSFER", "CHECK"], {
    message: "paymentMethodRequired",
  }),
  paymentDate: z.string().min(1, "paymentDateRequired"),
  referenceNumber: z.string().max(100).optional().or(z.literal("")),
  notes: z.string().max(2000).optional().or(z.literal("")),
});

export type PaymentCreateInput = z.infer<typeof paymentCreateSchema>;
