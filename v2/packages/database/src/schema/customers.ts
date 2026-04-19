import {
  pgTable,
  uuid,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { customerStatusEnum, idVerificationStatusEnum } from './enums';
import { tenants } from './tenants';

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),
    status: customerStatusEnum('status').notNull().default('active'),
    // Denormalized pointers to latest ID verification — kept in sync by
    // IdVerificationProcessingService / ReviewService on every terminal
    // state change. Plain UUID (no FK) to avoid circular FK between
    // customers <-> id_verifications in the Drizzle CJS output.
    identityVerificationStatus: idVerificationStatusEnum(
      'identity_verification_status',
    ),
    latestVerificationId: uuid('latest_verification_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('customers_email_tenant_idx')
      .on(table.tenantId, table.email)
      .where(sql`email IS NOT NULL`),
  ],
);
