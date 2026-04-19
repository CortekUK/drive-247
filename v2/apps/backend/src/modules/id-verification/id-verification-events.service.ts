import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { idVerificationEvents } from '@drive247/database';
import type {
  IdVerificationEventResponse,
  IdVerificationEventType,
} from '@drive247/shared-types';
import { DATABASE } from '../../database/database.module';
import type { Database } from '../../database/db';

type EventRow = typeof idVerificationEvents.$inferSelect;

export interface AppendEventInput {
  tenantId: string;
  verificationId: string;
  eventType: IdVerificationEventType;
  actorType: 'system' | 'staff' | 'customer';
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Append-only audit log for id_verifications state transitions.
 *
 * Every state change MUST emit an event via this service (rule #18).
 *
 * Two call patterns:
 *   - `.append(input)` — single-statement commit for calls outside a
 *     transaction (e.g. events emitted by the public capture controller
 *     on file upload).
 *   - `.buildValues(input)` — returns a plain values object the caller
 *     can pass to `tx.insert(idVerificationEvents).values(...)` inside
 *     a DB transaction, so the event commits atomically with the state
 *     change that produced it.
 *
 * Accepts explicit tenantId (no TenantContextService usage) because some
 * callers run outside a request context (e.g. background jobs).
 */
@Injectable()
export class IdVerificationEventsService {
  constructor(@Inject(DATABASE) private db: Database) {}

  async append(input: AppendEventInput): Promise<void> {
    await this.db.insert(idVerificationEvents).values(buildValues(input));
  }

  buildValues(input: AppendEventInput) {
    return buildValues(input);
  }

  async listForVerification(
    tenantId: string,
    verificationId: string,
  ): Promise<IdVerificationEventResponse[]> {
    const rows = await this.db
      .select()
      .from(idVerificationEvents)
      .where(
        and(
          eq(idVerificationEvents.tenantId, tenantId),
          eq(idVerificationEvents.verificationId, verificationId),
        ),
      )
      .orderBy(asc(idVerificationEvents.createdAt));
    return rows.map(shape);
  }
}

function buildValues(input: AppendEventInput) {
  return {
    tenantId: input.tenantId,
    verificationId: input.verificationId,
    eventType: input.eventType,
    actorType: input.actorType,
    actorUserId: input.actorUserId ?? null,
    metadata: input.metadata ?? {},
  };
}

function shape(row: EventRow): IdVerificationEventResponse {
  return {
    id: row.id,
    verificationId: row.verificationId,
    eventType: row.eventType,
    actorType: row.actorType as IdVerificationEventResponse['actorType'],
    actorUserId: row.actorUserId,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.createdAt.toISOString(),
  };
}
