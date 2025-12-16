import { z } from "zod";

export const howItWorksEditorSchema = z.object({
  title: z.string().min(1, "Section title is required"),
  subtitle: z.string().optional(),
});

export type HowItWorksEditorFormValues = z.infer<typeof howItWorksEditorSchema>;
