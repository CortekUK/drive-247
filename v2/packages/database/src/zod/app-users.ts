import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { appUsers } from '../schema';

export const insertAppUserSchema = createInsertSchema(appUsers);
export const selectAppUserSchema = createSelectSchema(appUsers);
