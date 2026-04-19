import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { blockedIdentities } from '../schema';

export const insertBlockedIdentitySchema =
  createInsertSchema(blockedIdentities);
export const selectBlockedIdentitySchema =
  createSelectSchema(blockedIdentities);
