import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { reminders } from '../schema';

export const insertReminderSchema = createInsertSchema(reminders);
export const selectReminderSchema = createSelectSchema(reminders);
