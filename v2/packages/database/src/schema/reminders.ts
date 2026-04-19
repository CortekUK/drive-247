import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { reminderSeverityEnum } from './enums';
import { tenants } from './tenants';

export const reminders = pgTable(
  'reminders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    ruleCode: text('rule_code').notNull(),
    objectType: text('object_type').notNull(),
    objectId: text('object_id'),
    title: text('title').notNull(),
    message: text('message').notNull(),
    severity: reminderSeverityEnum('severity').notNull().default('info'),
    context: jsonb('context'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('reminders_tenant_active_idx').on(
      table.tenantId,
      table.resolvedAt,
      table.createdAt,
    ),
    index('reminders_tenant_rule_idx').on(table.tenantId, table.ruleCode),
  ],
);
