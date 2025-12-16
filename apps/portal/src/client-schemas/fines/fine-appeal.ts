import { z } from "zod";

export const fineAppealSchema = z.object({
  action: z.enum(['appeal_successful', 'waive']),
});

export type FineAppealFormValues = z.infer<typeof fineAppealSchema>;
