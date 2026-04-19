import { z } from 'zod';
import { DiscountType } from '@drive247/shared-types';

export const createInvoiceItemSchema = z.object({
  description: z.string().trim().min(1, 'Description is required').max(200),
  quantity: z.coerce.number().int().min(1),
  unitPrice: z.coerce.number().int().min(0),
  discountType: z.nativeEnum(DiscountType).nullable().optional(),
  discountValue: z.coerce.number().int().min(0).nullable().optional(),
});

export type CreateInvoiceItemDto = z.infer<typeof createInvoiceItemSchema>;
