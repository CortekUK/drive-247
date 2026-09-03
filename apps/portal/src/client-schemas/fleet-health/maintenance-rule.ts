import { z } from "zod";

/**
 * Mirrors the guard inside useMaintenanceRuleActions: a rule with neither a
 * mileage nor a time interval can never fire, so it is rejected here too rather
 * than only at write time.
 */
export const maintenanceRuleSchema = z
  .object({
    name: z.string().trim().min(1, "Give the schedule a name").max(120),
    service_type: z.string().optional(),
    interval_miles: z
      .number({ invalid_type_error: "Enter a whole number" })
      .int("Enter a whole number")
      .positive("Must be greater than 0")
      .max(500_000, "That interval looks too high to be real")
      .optional(),
    interval_months: z
      .number({ invalid_type_error: "Enter a whole number" })
      .int("Enter a whole number")
      .positive("Must be greater than 0")
      .max(120, "Use 120 months or fewer")
      .optional(),
    lead_miles: z
      .number({ invalid_type_error: "Enter a whole number" })
      .int("Enter a whole number")
      .min(0, "Cannot be negative")
      .max(50_000, "That warning window looks too high to be real"),
    lead_days: z
      .number({ invalid_type_error: "Enter a whole number" })
      .int("Enter a whole number")
      .min(0, "Cannot be negative")
      .max(365, "Use 365 days or fewer"),
    is_active: z.boolean(),
    is_excluded: z.boolean().optional(),
  })
  .refine((v) => !!v.interval_miles || !!v.interval_months, {
    message: "Set a mileage interval, a time interval, or both",
    path: ["interval_miles"],
  });

export type MaintenanceRuleFormValues = z.infer<typeof maintenanceRuleSchema>;
