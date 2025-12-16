import { z } from "zod";

export const enhancedAssignPlateSchema = z.object({
  vehicle_id: z.string().min(1, "Please select a vehicle"),
  assignment_note: z.string().optional(),
});

export type EnhancedAssignPlateFormValues = z.infer<typeof enhancedAssignPlateSchema>;
