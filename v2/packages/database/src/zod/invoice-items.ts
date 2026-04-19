import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { invoiceItems } from '../schema';

export const insertInvoiceItemSchema = createInsertSchema(invoiceItems);
export const selectInvoiceItemSchema = createSelectSchema(invoiceItems);
