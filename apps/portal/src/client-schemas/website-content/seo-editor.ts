import { z } from "zod";

export const seoEditorSchema = z.object({
  title: z.string().min(1, "Title is required").max(70, "Title should be under 70 characters for SEO"),
  description: z.string().min(1, "Description is required").max(160, "Description should be under 160 characters for SEO"),
  keywords: z.string().max(200, "Keywords should be under 200 characters"),
});

export type SEOEditorFormValues = z.infer<typeof seoEditorSchema>;
