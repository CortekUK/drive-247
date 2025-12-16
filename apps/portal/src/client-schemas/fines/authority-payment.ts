import { z } from "zod";

export const authorityPaymentSchema = z.object({
  amount: z.number().min(0.01, "Amount must be greater than 0"),
  paymentDate: z.date({
    required_error: "Payment date is required",
  }),
  paymentMethod: z.string().optional(),
  notes: z.string().optional(),
});

export type AuthorityPaymentFormValues = z.infer<typeof authorityPaymentSchema>;
