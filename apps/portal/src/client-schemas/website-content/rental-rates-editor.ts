import { z } from "zod";

export const rentalRatesEditorSchema = z.object({
  section_title: z.string().min(1, "Section title is required"),
  daily_title: z.string().min(1, "Daily title is required"),
  daily_description: z.string().optional(),
  weekly_title: z.string().min(1, "Weekly title is required"),
  weekly_description: z.string().optional(),
  monthly_title: z.string().min(1, "Monthly title is required"),
  monthly_description: z.string().optional(),
});

export type RentalRatesEditorFormValues = z.infer<typeof rentalRatesEditorSchema>;
