import {
  pgTable,
  uuid,
  date,
  numeric,
  timestamp,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  rentalStatusEnum,
  rentalPeriodTypeEnum,
  insuranceStatusEnum,
} from './enums';
import { tenants } from './tenants';
import { customers } from './customers';
import { vehicles } from './vehicles';

export const rentals = pgTable(
  'rentals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    customerId: uuid('customer_id')
      .references(() => customers.id, { onDelete: 'restrict' })
      .notNull(),
    vehicleId: uuid('vehicle_id')
      .references(() => vehicles.id, { onDelete: 'restrict' })
      .notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    periodType: rentalPeriodTypeEnum('period_type').notNull(),
    totalAmount: numeric('total_amount', { precision: 12, scale: 2 }).notNull(),
    status: rentalStatusEnum('status').notNull().default('pending'),
    // Insurance summary — premium is the sum of all bonzah policy chunks for this rental.
    // The actual policies live in bonzah_insurance_policies with rental_id pointing here.
    // Kept denormalized for fast list/detail renders. The primary policy is derived by
    // querying bonzah_insurance_policies WHERE rental_id = this.id AND chain_sequence = 0.
    insurancePremium: numeric('insurance_premium', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    insuranceStatus: insuranceStatusEnum('insurance_status')
      .notNull()
      .default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      'rentals_date_order',
      sql`${table.endDate} >= ${table.startDate}`,
    ),
  ],
);
