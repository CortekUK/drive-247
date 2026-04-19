import { z } from 'zod';
import { createVehicleSchema } from './create-vehicle.dto';

export const updateVehicleSchema = createVehicleSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateVehicleDto = z.infer<typeof updateVehicleSchema>;
