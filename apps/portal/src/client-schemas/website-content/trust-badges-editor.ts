import { z } from "zod";

const badgeSchema = z.object({
  icon: z.string().min(1, "Icon is required"),
  label: z.string().min(1, "Label is required").max(20, "Label must be under 20 characters"),
  tooltip: z.string().min(1, "Tooltip is required").max(100, "Tooltip must be under 100 characters"),
});

export const trustBadgesEditorSchema = z.object({
  badges: z.array(badgeSchema).min(1, "At least one badge is required").max(6, "Maximum 6 badges allowed"),
});

export type TrustBadgesEditorFormValues = z.infer<typeof trustBadgesEditorSchema>;
