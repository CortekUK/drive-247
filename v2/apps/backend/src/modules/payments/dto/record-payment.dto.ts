import { z } from 'zod';
import { PaymentMethod } from '@drive247/shared-types';

export const recordPaymentSchema = z.object({
  amount: z.coerce.number().int().min(1),
  paymentMethod: z.nativeEnum(PaymentMethod),
  paidAt: z.coerce.date().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

export type RecordPaymentDto = z.infer<typeof recordPaymentSchema>;
