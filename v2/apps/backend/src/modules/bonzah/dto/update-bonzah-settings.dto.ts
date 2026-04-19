import { z } from 'zod';
import { BonzahMode } from '@drive247/shared-types';

/**
 * Mode change + credential update for the current tenant.
 *
 * If `mode` is supplied or changes to `live`, the service will verify the
 * submitted credentials against the live URL BEFORE persisting. No
 * "saved but broken" state is allowed (rule #13).
 */
export const updateBonzahSettingsSchema = z
  .object({
    mode: z.nativeEnum(BonzahMode).optional(),
    username: z.string().trim().email().optional(),
    password: z.string().min(1).optional(),
    brochureUrl: z.string().url().nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateBonzahSettingsDto = z.infer<
  typeof updateBonzahSettingsSchema
>;
