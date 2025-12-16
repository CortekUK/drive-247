import { z } from "zod";

export const promoBadgeEditorSchema = z.object({
  enabled: z.boolean(),
  discount_amount: z.string().optional(),
  discount_label: z.string().optional(),
  line1: z.string().optional(),
  line2: z.string().optional(),
});

export type PromoBadgeEditorFormValues = z.infer<typeof promoBadgeEditorSchema>;
