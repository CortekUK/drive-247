import { z } from 'zod';
import {
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  IdVerificationStatus,
  MAX_LIMIT,
} from '@drive247/shared-types';

export const listVerificationsSchema = z.object({
  customerId: z.string().uuid().optional(),
  status: z.nativeEnum(IdVerificationStatus).optional(),
  page: z.coerce.number().int().min(1).default(DEFAULT_PAGE),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

export type ListVerificationsDto = z.infer<typeof listVerificationsSchema>;
