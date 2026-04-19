import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { customers } from '../schema';

export const insertCustomerSchema = createInsertSchema(customers);
export const selectCustomerSchema = createSelectSchema(customers);
