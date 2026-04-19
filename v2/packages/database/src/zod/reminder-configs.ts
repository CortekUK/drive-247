import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { reminderConfigs } from '../schema';

export const insertReminderConfigSchema = createInsertSchema(reminderConfigs);
export const selectReminderConfigSchema = createSelectSchema(reminderConfigs);
