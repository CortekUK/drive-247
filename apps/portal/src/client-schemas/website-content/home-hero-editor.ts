import { z } from "zod";

export const homeHeroEditorSchema = z.object({
  headline: z.string().min(1, "Headline is required"),
  subheading: z.string().optional(),
  trust_line: z.string().optional(),
  phone_number: z.string().optional(),
  phone_cta_text: z.string().optional(),
  book_cta_text: z.string().optional(),
});

export type HomeHeroEditorFormValues = z.infer<typeof homeHeroEditorSchema>;
