import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { appUsers } from './app-users';
import { idVerifications } from './id-verifications';

/**
 * Append-only audit log for identity verification state transitions.
 * Services must use IdVerificationEventsService.append(...) — never raw inserts.
 * No updates, no deletes: every change is a new row.
 */
export const idVerificationEvents = pgTable(
  'id_verification_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    verificationId: uuid('verification_id')
      .references(() => idVerifications.id, { onDelete: 'cascade' })
      .notNull(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    // event_type codes: see plan §3.5
    eventType: text('event_type').notNull(),
    // 'system' | 'staff' | 'customer'
    actorType: text('actor_type').notNull(),
    actorUserId: uuid('actor_user_id').references(() => appUsers.id, {
      onDelete: 'set null',
    }),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('id_verification_events_verification_idx').on(
      table.verificationId,
      table.createdAt,
    ),
    index('id_verification_events_tenant_idx').on(
      table.tenantId,
      table.createdAt,
    ),
  ],
);
