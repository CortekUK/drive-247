import { z } from "zod";

export const insurancePolicySchema = z.object({
  policy_number: z.string().min(3, "Policy number must be at least 3 characters"),
  provider: z.string().optional(),
  start_date: z.date({
    required_error: "Start date is required",
  }),
  expiry_date: z.date({
    required_error: "Expiry date is required",
  }),
  vehicle_id: z.string().optional(),
  status: z.enum(["Active", "ExpiringSoon", "Expired", "Suspended", "Cancelled", "Inactive"]).default("Active"),
  notes: z.string().optional(),
}).refine(
  (data) => data.expiry_date > data.start_date,
  {
    message: "Expiry date must be after start date",
    path: ["expiry_date"],
  }
);

export type InsurancePolicyFormValues = z.infer<typeof insurancePolicySchema>;
