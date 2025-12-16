import { z } from "zod";

export const addPlateSchema = z.object({
  plate_number: z.string().min(1, "Plate number is required").max(10, "Plate number too long"),
  vehicle_id: z.string().optional(),
  supplier: z.string().optional(),
  order_date: z.string().optional(),
  cost: z.string().optional(),
  status: z.enum(["ordered", "received", "fitted"]).default("ordered"),
  retention_doc_reference: z.string().optional(),
  notes: z.string().optional(),
});

export type AddPlateFormValues = z.infer<typeof addPlateSchema>;
