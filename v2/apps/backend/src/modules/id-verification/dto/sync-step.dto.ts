import { z } from 'zod';
import { ID_VERIFICATION_CAPTURE_STEPS } from '@drive247/shared-types';

export const syncStepSchema = z.object({
  step: z.enum(ID_VERIFICATION_CAPTURE_STEPS),
});

export type SyncStepDto = z.infer<typeof syncStepSchema>;
