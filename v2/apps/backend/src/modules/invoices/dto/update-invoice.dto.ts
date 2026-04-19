import { z } from 'zod';
import { DiscountType } from '@drive247/shared-types';

export const updateInvoiceSchema = z
  .object({
    dueDate: z.coerce.date().optional(),
    notes: z.string().max(2000).nullable().optional(),
    discountType: z.nativeEnum(DiscountType).nullable().optional(),
    discountValue: z.coerce.number().int().min(0).nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateInvoiceDto = z.infer<typeof updateInvoiceSchema>;
