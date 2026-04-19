import { z } from 'zod';
import { VehicleStatus } from '@drive247/shared-types';

export const listVehiclesSchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.nativeEnum(VehicleStatus).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListVehiclesDto = z.infer<typeof listVehiclesSchema>;
