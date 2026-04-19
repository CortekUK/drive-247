import { z } from 'zod';

export const checkEligibilitySchema = z.object({
  vehicleId: z.string().uuid(),
});

export type CheckEligibilityDto = z.infer<typeof checkEligibilitySchema>;
