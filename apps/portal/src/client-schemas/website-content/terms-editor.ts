import { z } from "zod";

export const termsEditorSchema = z.object({
  title: z.string().min(1, "Section title is required"),
});

export type TermsEditorFormValues = z.infer<typeof termsEditorSchema>;
