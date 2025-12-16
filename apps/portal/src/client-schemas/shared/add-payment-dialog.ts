import { z } from "zod";

export const addPaymentDialogSchema = z.object({
  customer_id: z.string().min(1, "Customer is required"),
  vehicle_id: z.string().optional(),
  amount: z.number().min(0.01, "Amount must be greater than 0"),
  payment_date: z.date({
    required_error: "Payment date is required",
  }),
  method: z.string().optional(),
  notes: z.string().optional(),
});

export type AddPaymentDialogFormValues = z.infer<typeof addPaymentDialogSchema>;
