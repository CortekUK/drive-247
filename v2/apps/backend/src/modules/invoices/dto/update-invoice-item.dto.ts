import { z } from 'zod';
import { DiscountType } from '@drive247/shared-types';

export const updateInvoiceItemSchema = z
  .object({
    description: z.string().trim().min(1).max(200).optional(),
    quantity: z.coerce.number().int().min(1).optional(),
    unitPrice: z.coerce.number().int().min(0).optional(),
    discountType: z.nativeEnum(DiscountType).nullable().optional(),
    discountValue: z.coerce.number().int().min(0).nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateInvoiceItemDto = z.infer<typeof updateInvoiceItemSchema>;
