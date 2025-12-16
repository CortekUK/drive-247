import { z } from "zod";

export const serviceHighlightsEditorSchema = z.object({
  title: z.string().min(1, "Section title is required"),
  subtitle: z.string().optional(),
});

export type ServiceHighlightsEditorFormValues = z.infer<typeof serviceHighlightsEditorSchema>;
