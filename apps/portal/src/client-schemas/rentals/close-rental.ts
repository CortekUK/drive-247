import { z } from "zod";

export const closeRentalSchema = z.object({
  end_date: z.date({
    required_error: "End date is required",
  }),
});

export type CloseRentalFormValues = z.infer<typeof closeRentalSchema>;
