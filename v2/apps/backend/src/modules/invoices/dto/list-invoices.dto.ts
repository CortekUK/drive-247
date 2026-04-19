import { z } from 'zod';
import { InvoiceStatus } from '@drive247/shared-types';

export const listInvoicesSchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.nativeEnum(InvoiceStatus).optional(),
  customerId: z.string().uuid().optional(),
  rentalId: z.string().uuid().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListInvoicesDto = z.infer<typeof listInvoicesSchema>;
