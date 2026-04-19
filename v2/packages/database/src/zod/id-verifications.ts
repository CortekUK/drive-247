import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { idVerifications } from '../schema';

export const insertIdVerificationSchema = createInsertSchema(idVerifications);
export const selectIdVerificationSchema = createSelectSchema(idVerifications);
