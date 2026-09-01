import { z } from "zod";

/**
 * Simplified expense form: type (business/vehicle), optional vehicle, category,
 * a full date+time, and amount. Vehicle is required when type is "vehicle".
 */
export const expenseSchema = z
  .object({
    type: z.enum(["business", "vehicle"]),
    vehicle_id: z.string().uuid().nullable().optional(),
    category: z.string().min(1, "Category is required"),
    expense_at: z.string().min(1, "Date is required"),
    amount: z
      .number({ invalid_type_error: "Amount is required" })
      .min(0.01, "Amount must be greater than 0"),
  })
  .refine((v) => v.type !== "vehicle" || !!v.vehicle_id, {
    message: "Pick a vehicle",
    path: ["vehicle_id"],
  });

export type ExpenseFormValues = z.infer<typeof expenseSchema>;
