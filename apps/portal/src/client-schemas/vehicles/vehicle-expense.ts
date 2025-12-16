import { z } from "zod";

export const vehicleExpenseSchema = z.object({
  expense_date: z.string().min(1, "Expense date is required"),
  category: z.enum(['Repair', 'Service', 'Tyres', 'Valet', 'Accessory', 'Other'], {
    required_error: "Category is required",
  }),
  amount: z.number().min(0, "Amount must be 0 or greater"),
  notes: z.string().optional(),
  reference: z.string().optional(),
});

export type VehicleExpenseFormValues = z.infer<typeof vehicleExpenseSchema>;
