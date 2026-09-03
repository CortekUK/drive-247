import { z } from "zod";

/**
 * A literal 0 is a valid reading — brand-new vehicles genuinely read 0, and the
 * legacy handover writer drops it because it guards with `if (mileage)`. `min(0)`
 * here (not `positive()`) is deliberate.
 */
export const recordOdometerSchema = z.object({
  reading: z
    .number({ invalid_type_error: "Enter the odometer reading" })
    .int("Enter a whole number")
    .min(0, "A reading cannot be negative")
    .max(2_000_000, "That reading looks too high to be real"),
  note: z.string().max(500, "Keep the note under 500 characters").optional(),
});

export type RecordOdometerFormValues = z.infer<typeof recordOdometerSchema>;
