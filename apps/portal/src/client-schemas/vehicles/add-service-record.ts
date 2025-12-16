import { z } from "zod";

export const addServiceRecordSchema = z.object({
  service_date: z.string().min(1, "Service date is required"),
  mileage: z.number().optional(),
  description: z.string().optional(),
  cost: z.number().min(0, "Cost must be 0 or greater"),
});

export type AddServiceRecordFormValues = z.infer<typeof addServiceRecordSchema>;
