import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { vehicles } from '../schema';

export const insertVehicleSchema = createInsertSchema(vehicles);
export const selectVehicleSchema = createSelectSchema(vehicles);
