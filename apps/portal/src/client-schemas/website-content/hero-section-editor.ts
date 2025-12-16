import { z } from "zod";

export const heroSectionEditorSchema = z.object({
  title: z.string().min(1, "Title is required").max(100, "Title must be under 100 characters"),
  subtitle: z.string().min(1, "Subtitle is required").max(300, "Subtitle must be under 300 characters"),
});

export type HeroSectionEditorFormValues = z.infer<typeof heroSectionEditorSchema>;
