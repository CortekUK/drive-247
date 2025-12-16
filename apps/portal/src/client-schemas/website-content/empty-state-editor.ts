import { z } from "zod";

export const emptyStateEditorSchema = z.object({
  title_active: z.string().optional(),
  title_default: z.string().optional(),
  description: z.string().optional(),
  button_text: z.string().optional(),
});

export type EmptyStateEditorFormValues = z.infer<typeof emptyStateEditorSchema>;
