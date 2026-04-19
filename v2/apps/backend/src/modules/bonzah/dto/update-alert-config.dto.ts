import { z } from 'zod';

export const updateAlertConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    threshold: z.coerce.number().min(0).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateAlertConfigDto = z.infer<typeof updateAlertConfigSchema>;
