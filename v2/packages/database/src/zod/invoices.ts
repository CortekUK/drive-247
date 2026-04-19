import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { invoices } from '../schema';

export const insertInvoiceSchema = createInsertSchema(invoices);
export const selectInvoiceSchema = createSelectSchema(invoices);
