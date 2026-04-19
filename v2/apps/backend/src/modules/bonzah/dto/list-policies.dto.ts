import { z } from 'zod';
import { BonzahPolicyStatus } from '@drive247/shared-types';

export const listPoliciesSchema = z.object({
  rentalId: z.string().uuid().optional(),
  chainId: z.string().uuid().optional(),
  status: z.nativeEnum(BonzahPolicyStatus).optional(),
});

export type ListPoliciesDto = z.infer<typeof listPoliciesSchema>;
