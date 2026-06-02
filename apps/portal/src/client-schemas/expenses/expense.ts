import { z } from "zod";

/**
 * Shared schema for the full expense form (vehicle + business-wide expenses).
 * `vehicle_id` is optional — null/empty means a company-wide / overhead expense.
 */
export const expenseSchema = z.object({
  expense_date: z.string().min(1, "Date is required"),
  category: z.string().min(1, "Category is required"),
  amount: z
    .number({ invalid_type_error: "Amount is required" })
    .min(0.01, "Amount must be greater than 0"),
  vehicle_id: z.string().uuid().nullable().optional(),
  vendor: z.string().max(120, "Too long").optional(),
  payment_method: z.string().optional(),
  reference: z.string().max(120, "Too long").optional(),
  notes: z.string().max(1000, "Too long").optional(),
  is_recurring: z.boolean().optional(),
  recurrence_interval: z.enum(["monthly", "yearly"]).nullable().optional(),
});

export type ExpenseFormValues = z.infer<typeof expenseSchema>;

export const PAYMENT_METHODS = [
  "Card",
  "Cash",
  "Bank Transfer",
  "Direct Debit",
  "Other",
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
