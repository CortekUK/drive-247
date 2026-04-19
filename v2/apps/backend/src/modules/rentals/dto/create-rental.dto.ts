import { z } from 'zod';
import { RentalPeriodType, RentalStatus } from '@drive247/shared-types';

export const createRentalSchema = z
  .object({
    customerId: z.string().uuid('Invalid customer id'),
    vehicleId: z.string().uuid('Invalid vehicle id'),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    periodType: z.nativeEnum(RentalPeriodType),
    totalAmount: z.coerce.number().min(0).max(99999999),
    status: z.nativeEnum(RentalStatus).default(RentalStatus.PENDING),
  })
  .refine((d) => d.endDate >= d.startDate, {
    message: 'End date must be on or after start date',
    path: ['endDate'],
  });

export type CreateRentalDto = z.infer<typeof createRentalSchema>;
