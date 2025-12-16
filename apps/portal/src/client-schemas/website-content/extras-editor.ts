import { z } from "zod";

export const extrasEditorSchema = z.object({
  footer_text: z.string().optional(),
});

export type ExtrasEditorFormValues = z.infer<typeof extrasEditorSchema>;
