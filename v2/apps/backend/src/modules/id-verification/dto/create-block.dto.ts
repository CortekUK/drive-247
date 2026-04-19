import { z } from 'zod';
import { insertBlockedIdentitySchema } from '@drive247/database';

/**
 * DTO pulled from drizzle-zod insert shape (rule #21 — single source of truth)
 * then narrowed to exactly the fields the API accepts.
 */
export const createBlockSchema = insertBlockedIdentitySchema
  .pick({
    identityType: true,
    identityValue: true,
    reason: true,
  })
  .extend({
    identityValue: z.string().trim().min(1, 'Identity value is required'),
    reason: z.string().trim().min(3, 'Reason must be at least 3 characters'),
  });

export type CreateBlockDto = z.infer<typeof createBlockSchema>;
