import { z } from 'zod';
import { BlockedIdentityType } from '@drive247/shared-types';

export const listBlocksSchema = z.object({
  identityType: z.nativeEnum(BlockedIdentityType).optional(),
  isActive: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true'))
    .optional(),
});

export type ListBlocksDto = z.infer<typeof listBlocksSchema>;
