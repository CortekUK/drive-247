import { z } from "zod";

export const inclusionsEditorSchema = z.object({
  section_title: z.string().min(1, "Section title is required"),
  section_subtitle: z.string().optional(),
  standard_title: z.string().min(1, "Standard section title is required"),
  premium_title: z.string().min(1, "Premium section title is required"),
});

export type InclusionsEditorFormValues = z.infer<typeof inclusionsEditorSchema>;
