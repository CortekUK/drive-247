import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  date,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  invoiceStatusEnum,
  discountTypeEnum,
} from './enums';
import { tenants } from './tenants';
import { rentals } from './rentals';
import { customers } from './customers';

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    rentalId: uuid('rental_id').references(() => rentals.id, {
      onDelete: 'set null',
    }),
    customerId: uuid('customer_id')
      .references(() => customers.id, { onDelete: 'restrict' })
      .notNull(),
    invoiceNumber: text('invoice_number').notNull(),
    status: invoiceStatusEnum('status').notNull().default('draft'),
    subtotal: integer('subtotal').notNull().default(0),
    discountType: discountTypeEnum('discount_type'),
    discountValue: integer('discount_value'),
    discountAmount: integer('discount_amount').notNull().default(0),
    taxRate: numeric('tax_rate', { precision: 5, scale: 2 })
      .notNull()
      .default('0'),
    taxLabel: text('tax_label').notNull().default('Tax'),
    taxInclusive: boolean('tax_inclusive').notNull().default(false),
    taxAmount: integer('tax_amount').notNull().default(0),
    totalAmount: integer('total_amount').notNull().default(0),
    amountPaid: integer('amount_paid').notNull().default(0),
    amountDue: integer('amount_due').notNull().default(0),
    dueDate: date('due_date').notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('invoices_tenant_number_idx').on(
      table.tenantId,
      table.invoiceNumber,
    ),
  ],
);
