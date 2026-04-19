import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  date,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { bonzahPolicyStatusEnum, bonzahModeEnum } from './enums';
import { tenants } from './tenants';
import { rentals } from './rentals';
import { customers } from './customers';

export const bonzahInsurancePolicies = pgTable(
  'bonzah_insurance_policies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    rentalId: uuid('rental_id')
      .references(() => rentals.id, { onDelete: 'cascade' })
      .notNull(),
    customerId: uuid('customer_id')
      .references(() => customers.id, { onDelete: 'restrict' })
      .notNull(),

    // Multi-chunk policy linkage (rentals > 30 days)
    chainId: uuid('chain_id').notNull(),
    chainSequence: integer('chain_sequence').notNull().default(0),
    policyType: text('policy_type').notNull().default('original'),
    mode: bonzahModeEnum('mode').notNull(),

    // Bonzah identifiers
    quoteId: text('quote_id').notNull(),
    quoteNo: text('quote_no'),
    paymentId: text('payment_id'),
    policyNo: text('policy_no'),
    policyId: text('policy_id'),

    // Coverage selection + PDF ids
    coverage: jsonb('coverage').notNull(),

    // Trip + pricing
    tripStartDate: date('trip_start_date').notNull(),
    tripEndDate: date('trip_end_date').notNull(),
    pickupState: text('pickup_state').notNull(),
    premiumAmount: numeric('premium_amount', {
      precision: 12,
      scale: 2,
    }).notNull(),

    // Renter snapshot
    renterDetails: jsonb('renter_details').notNull(),

    // Lifecycle
    status: bonzahPolicyStatusEnum('status').notNull().default('quoted'),
    policyIssuedAt: timestamp('policy_issued_at', { withTimezone: true }),
    lastError: text('last_error'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      'bonzah_policies_date_order',
      sql`${table.tripEndDate} >= ${table.tripStartDate}`,
    ),
    uniqueIndex('bonzah_policies_tenant_quote_idx').on(
      table.tenantId,
      table.quoteId,
    ),
    index('bonzah_policies_rental_idx').on(table.tenantId, table.rentalId),
    index('bonzah_policies_chain_idx').on(table.tenantId, table.chainId),
    index('bonzah_policies_status_idx').on(table.tenantId, table.status),
  ],
);
