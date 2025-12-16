import { z } from "zod";

export const promotionsHeroEditorSchema = z.object({
  headline: z.string().min(1, "Headline is required"),
  subheading: z.string().optional(),
  primary_cta_text: z.string().optional(),
  primary_cta_href: z.string().optional(),
  secondary_cta_text: z.string().optional(),
});

export type PromotionsHeroEditorFormValues = z.infer<typeof promotionsHeroEditorSchema>;
