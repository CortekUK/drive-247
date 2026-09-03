import { z } from "zod";

export const reportIssueSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Describe the problem in a few words")
    .max(200, "Keep the summary under 200 characters"),
  priority: z.enum(["critical", "high", "medium", "low"]),
  category: z.string().optional(),
  notes: z.string().max(2000, "Keep notes under 2000 characters").optional(),
});

export type ReportIssueFormValues = z.infer<typeof reportIssueSchema>;
