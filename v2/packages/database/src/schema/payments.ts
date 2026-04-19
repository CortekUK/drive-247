import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  check,
  AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  paymentTypeEnum,
  paymentMethodEnum,
  paymentGatewayEnum,
  paymentStatusEnum,
} from './enums';
import { tenants } from './tenants';
import { invoices } from './invoices';

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    invoiceId: uuid('invoice_id')
      .references(() => invoices.id, { onDelete: 'restrict' })
      .notNull(),
    type: paymentTypeEnum('type').notNull(),
    amount: integer('amount').notNull(),
    paymentMethod: paymentMethodEnum('payment_method').notNull(),
    paymentGateway: paymentGatewayEnum('payment_gateway').notNull(),
    gatewayTransactionId: text('gateway_transaction_id'),
    linkedPaymentId: uuid('linked_payment_id').references(
      (): AnyPgColumn => payments.id,
      { onDelete: 'set null' },
    ),
    status: paymentStatusEnum('status').notNull(),
    notes: text('notes'),
    paidAt: timestamp('paid_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      'payments_sign_matches_type',
      sql`(${table.type} = 'payment' AND ${table.amount} > 0) OR (${table.type} = 'refund' AND ${table.amount} < 0)`,
    ),
  ],
);
