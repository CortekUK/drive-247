import { z } from "zod";

export const testimonialsHeaderEditorSchema = z.object({
  title: z.string().min(1, "Section title is required"),
});

export type TestimonialsHeaderEditorFormValues = z.infer<typeof testimonialsHeaderEditorSchema>;
