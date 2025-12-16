import { z } from "zod";

export const bookingHeaderEditorSchema = z.object({
  title: z.string().min(1, "Title is required"),
  subtitle: z.string().optional(),
});

export type BookingHeaderEditorFormValues = z.infer<typeof bookingHeaderEditorSchema>;
