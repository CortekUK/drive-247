import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { vehicleStatusEnum } from './enums';
import { tenants } from './tenants';

export const vehicles = pgTable(
  'vehicles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    reg: text('reg').notNull(),
    make: text('make').notNull(),
    model: text('model').notNull(),
    year: integer('year').notNull(),
    dailyRent: numeric('daily_rent', { precision: 10, scale: 2 }).notNull(),
    weeklyRent: numeric('weekly_rent', { precision: 10, scale: 2 }).notNull(),
    monthlyRent: numeric('monthly_rent', { precision: 10, scale: 2 }).notNull(),
    status: vehicleStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('vehicles_reg_tenant_idx').on(table.tenantId, table.reg),
  ],
);
