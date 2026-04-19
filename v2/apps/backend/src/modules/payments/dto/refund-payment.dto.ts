import { z } from 'zod';

export const refundPaymentSchema = z.object({
  amount: z.coerce.number().int().min(1),
  notes: z.string().max(1000).nullable().optional(),
});

export type RefundPaymentDto = z.infer<typeof refundPaymentSchema>;
