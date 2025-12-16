import { z } from "zod";

export const assignPlateSchema = z.object({
  vehicle_id: z.string().min(1, "Please select a vehicle"),
});

export type AssignPlateFormValues = z.infer<typeof assignPlateSchema>;
