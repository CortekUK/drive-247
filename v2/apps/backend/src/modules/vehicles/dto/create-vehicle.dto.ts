import { z } from 'zod';
import { insertVehicleSchema } from '@drive247/database';
import { VehicleStatus } from '@drive247/shared-types';

const MIN_YEAR = 1900;
const MAX_YEAR = new Date().getFullYear() + 1;

export const createVehicleSchema = z.object({
  reg: insertVehicleSchema.shape.reg.min(1, 'Registration is required').max(20),
  make: insertVehicleSchema.shape.make.min(1, 'Make is required').max(50),
  model: insertVehicleSchema.shape.model.min(1, 'Model is required').max(50),
  year: z.coerce.number().int().min(MIN_YEAR).max(MAX_YEAR),
  dailyRent: z.coerce.number().min(0).max(99999999),
  weeklyRent: z.coerce.number().min(0).max(99999999),
  monthlyRent: z.coerce.number().min(0).max(99999999),
  status: z.nativeEnum(VehicleStatus).default(VehicleStatus.ACTIVE),
});

export type CreateVehicleDto = z.infer<typeof createVehicleSchema>;
