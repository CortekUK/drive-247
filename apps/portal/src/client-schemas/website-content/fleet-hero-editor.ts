import { z } from "zod";

export const fleetHeroEditorSchema = z.object({
  headline: z.string().min(1, "Headline is required"),
  subheading: z.string().optional(),
  primary_cta_text: z.string().optional(),
  secondary_cta_text: z.string().optional(),
});

export type FleetHeroEditorFormValues = z.infer<typeof fleetHeroEditorSchema>;
