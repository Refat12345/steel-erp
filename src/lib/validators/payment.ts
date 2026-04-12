import { z } from "zod";

export const paymentCreateSchema = z.object({
  customerId: z.number().int().positive("العميل مطلوب"),
  amount: z
    .number()
    .positive("المبلغ يجب أن يكون أكبر من صفر")
    .max(999_999_999_999, "المبلغ كبير جداً"),
  method: z.enum(["CASH", "BANK_TRANSFER", "CHECK"], {
    required_error: "طريقة الدفع مطلوبة",
  }),
  paymentDate: z.string().min(1, "تاريخ الدفع مطلوب"),
  referenceNumber: z.string().max(100).optional().or(z.literal("")),
  notes: z.string().max(2000).optional().or(z.literal("")),
});

export type PaymentCreateInput = z.infer<typeof paymentCreateSchema>;
