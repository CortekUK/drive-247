import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { rentals } from '../schema';

export const insertRentalSchema = createInsertSchema(rentals);
export const selectRentalSchema = createSelectSchema(rentals);
