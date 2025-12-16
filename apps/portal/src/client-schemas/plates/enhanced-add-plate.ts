import { z } from "zod";

export const enhancedAddPlateSchema = z.object({
  plate_number: z.string()
    .min(1, "Plate number is required")
    .transform(val => val.toUpperCase().replace(/\s+/g, '')),
  vehicle_id: z.string().optional(),
  supplier: z.string().optional(),
  order_date: z.date().optional(),
  cost: z.string().transform(val => val === '' ? 0 : parseFloat(val)).pipe(
    z.number().min(0, "Cost must be 0 or greater")
  ),
  status: z.enum(['ordered', 'received', 'assigned', 'expired']),
  retention_doc_reference: z.string().optional(),
  notes: z.string().optional(),
});

export type EnhancedAddPlateFormValues = z.infer<typeof enhancedAddPlateSchema>;
