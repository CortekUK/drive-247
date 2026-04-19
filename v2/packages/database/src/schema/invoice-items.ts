import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { discountTypeEnum } from './enums';
import { tenants } from './tenants';
import { invoices } from './invoices';

export const invoiceItems = pgTable(
  'invoice_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    invoiceId: uuid('invoice_id')
      .references(() => invoices.id, { onDelete: 'cascade' })
      .notNull(),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull().default(1),
    unitPrice: integer('unit_price').notNull(),
    discountType: discountTypeEnum('discount_type'),
    discountValue: integer('discount_value'),
    discountAmount: integer('discount_amount').notNull().default(0),
    lineTotal: integer('line_total').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check('invoice_items_qty_positive', sql`${table.quantity} > 0`),
    check('invoice_items_unit_price_nonneg', sql`${table.unitPrice} >= 0`),
  ],
);
