import { z } from 'zod';
import { RentalPeriodType } from '@drive247/shared-types';

export const updateRentalSchema = z
  .object({
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    periodType: z.nativeEnum(RentalPeriodType).optional(),
    totalAmount: z.coerce.number().min(0).max(99999999).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'At least one field must be provided',
  })
  .refine(
    (d) => !d.startDate || !d.endDate || d.endDate >= d.startDate,
    {
      message: 'End date must be on or after start date',
      path: ['endDate'],
    },
  );

export type UpdateRentalDto = z.infer<typeof updateRentalSchema>;
