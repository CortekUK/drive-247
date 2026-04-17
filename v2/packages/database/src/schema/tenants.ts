import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { tenantTypeEnum, tenantStatusEnum } from './enums';

export const tenants = pgTable('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: text('slug').notNull().unique(),
  companyName: text('company_name').notNull(),
  adminName: text('admin_name'),
  contactEmail: text('contact_email'),
  contactPhone: text('contact_phone'),
  tenantType: tenantTypeEnum('tenant_type').notNull().default('production'),
  status: tenantStatusEnum('status').notNull().default('active'),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});
