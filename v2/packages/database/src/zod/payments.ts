import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { payments } from '../schema';

export const insertPaymentSchema = createInsertSchema(payments);
export const selectPaymentSchema = createSelectSchema(payments);
