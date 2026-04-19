import { z } from 'zod';

export const manualReviewSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().trim().min(3, 'Reason must be at least 3 characters'),
});

export type ManualReviewDto = z.infer<typeof manualReviewSchema>;
