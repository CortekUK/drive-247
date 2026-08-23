import { z } from "zod";

export const completeJobSchema = z.object({
  service_date: z.string().min(1, "Pick the date the work was done"),
  /**
   * Optional, but it is the field with downstream consequences: it re-baselines
   * every mileage interval on the vehicle. Blank is stored as undefined, never NaN.
   */
  mileage: z
    .number({ invalid_type_error: "Enter a whole number" })
    .int("Enter a whole number")
    .min(0, "A reading cannot be negative")
    .max(2_000_000, "That reading looks too high to be real")
    .optional(),
  cost: z
    .number({ invalid_type_error: "Enter a cost, or 0" })
    .min(0, "Cost cannot be negative"),
  description: z.string().max(2000, "Keep notes under 2000 characters").optional(),
});

export type CompleteJobFormValues = z.infer<typeof completeJobSchema>;
