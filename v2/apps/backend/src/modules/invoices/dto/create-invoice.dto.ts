import { z } from 'zod';
import { DiscountType } from '@drive247/shared-types';
import { createInvoiceItemSchema } from './create-invoice-item.dto';

export const createInvoiceSchema = z.object({
  customerId: z.string().uuid(),
  rentalId: z.string().uuid().nullable().optional(),
  dueDate: z.coerce.date(),
  notes: z.string().max(2000).nullable().optional(),
  discountType: z.nativeEnum(DiscountType).nullable().optional(),
  discountValue: z.coerce.number().int().min(0).nullable().optional(),
  items: z.array(createInvoiceItemSchema).min(1, 'At least one line item is required'),
});

export type CreateInvoiceDto = z.infer<typeof createInvoiceSchema>;
