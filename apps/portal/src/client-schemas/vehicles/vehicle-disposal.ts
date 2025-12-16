import { z } from "zod";

export const vehicleDisposalSchema = z.object({
  disposal_date: z.date({
    required_error: "Disposal date is required.",
  }),
  sale_proceeds: z.number().min(0, "Sale proceeds must be positive"),
  disposal_buyer: z.string().optional(),
  disposal_notes: z.string().optional(),
});

export type VehicleDisposalFormValues = z.infer<typeof vehicleDisposalSchema>;
