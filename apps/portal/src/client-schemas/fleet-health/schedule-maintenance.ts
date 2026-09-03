import { z } from "zod";

export const scheduleMaintenanceSchema = z
  .object({
    title: z.string().trim().min(1, "Give the job a name").max(200),
    start: z.string().min(1, "Pick a start date"),
    end: z.string().min(1, "Pick an end date"),
    priority: z.enum(["critical", "high", "medium", "low"]),
    category: z.string().optional(),
    service_type: z.string().optional(),
    vendor: z.string().max(120, "Keep the vendor name under 120 characters").optional(),
    notes: z.string().max(2000, "Keep notes under 2000 characters").optional(),
  })
  // Both values are yyyy-MM-dd, so a lexicographic compare is a date compare.
  .refine((v) => !v.start || !v.end || v.end >= v.start, {
    message: "The end date cannot be before the start date",
    path: ["end"],
  });

export type ScheduleMaintenanceFormValues = z.infer<typeof scheduleMaintenanceSchema>;
