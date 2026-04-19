import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { idVerificationEvents } from '../schema';

export const insertIdVerificationEventSchema =
  createInsertSchema(idVerificationEvents);
export const selectIdVerificationEventSchema =
  createSelectSchema(idVerificationEvents);
