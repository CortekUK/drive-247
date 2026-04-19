import { z } from 'zod';
import { CustomerStatus } from '@drive247/shared-types';

export const listCustomersSchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.nativeEnum(CustomerStatus).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListCustomersDto = z.infer<typeof listCustomersSchema>;
