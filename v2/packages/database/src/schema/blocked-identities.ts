import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { blockedIdentityTypeEnum } from './enums';
import { tenants } from './tenants';
import { appUsers } from './app-users';

export const blockedIdentities = pgTable(
  'blocked_identities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    identityType: blockedIdentityTypeEnum('identity_type').notNull(),
    // Normalized: lowercased email, trimmed doc number
    identityValue: text('identity_value').notNull(),
    reason: text('reason').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdByUserId: uuid('created_by_user_id').references(() => appUsers.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('blocked_identities_tenant_type_value_idx').on(
      table.tenantId,
      table.identityType,
      table.identityValue,
    ),
    index('blocked_identities_tenant_active_idx').on(
      table.tenantId,
      table.isActive,
    ),
  ],
);
