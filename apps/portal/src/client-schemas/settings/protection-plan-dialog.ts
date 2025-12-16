import { z } from "zod";

export const protectionPlanDialogSchema = z.object({
  name: z.string().min(1, "Internal name is required"),
  display_name: z.string().min(1, "Display name is required"),
  description: z.string().optional(),
  price_per_day: z.number().min(0.01, "Daily price is required"),
  price_per_week: z.number().optional().nullable(),
  price_per_month: z.number().optional().nullable(),
  deductible_amount: z.number().default(0),
  max_coverage_amount: z.number().optional().nullable(),
  tier: z.enum(["basic", "standard", "premium", "ultimate"]).default("standard"),
  icon_name: z.string().default("Shield"),
  color_theme: z.string().default("#60A5FA"),
  display_order: z.number().default(0),
});

export type ProtectionPlanDialogFormValues = z.infer<typeof protectionPlanDialogSchema>;
