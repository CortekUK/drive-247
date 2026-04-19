import { z } from 'zod';

export const retryVerificationSchema = z.object({
  reason: z.string().trim().min(3, 'Reason must be at least 3 characters'),
});

export type RetryVerificationDto = z.infer<typeof retryVerificationSchema>;
