import { z } from 'zod';
import { RentalStatus } from '@drive247/shared-types';

export const transitionRentalSchema = z.object({
  status: z.enum([
    RentalStatus.ACTIVE,
    RentalStatus.COMPLETED,
    RentalStatus.CANCELLED,
  ]),
});

export type TransitionRentalDto = z.infer<typeof transitionRentalSchema>;
