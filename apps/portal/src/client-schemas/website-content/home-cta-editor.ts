import { z } from "zod";

export const homeCTAEditorSchema = z.object({
  title: z.string().min(1, "Section title is required"),
  description: z.string().optional(),
  primary_cta_text: z.string().optional(),
  secondary_cta_text: z.string().optional(),
});

export type HomeCTAEditorFormValues = z.infer<typeof homeCTAEditorSchema>;
