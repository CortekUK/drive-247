import { z } from 'zod';
import { RentalStatus } from '@drive247/shared-types';

export const listRentalsSchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.nativeEnum(RentalStatus).optional(),
  customerId: z.string().uuid().optional(),
  vehicleId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListRentalsDto = z.infer<typeof listRentalsSchema>;
