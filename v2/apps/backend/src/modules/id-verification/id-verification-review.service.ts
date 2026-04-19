import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  customers,
  idVerificationEvents,
  idVerifications,
} from '@drive247/database';
import {
  ID_VERIFICATION_EVENT_TYPES,
  IdVerificationDecisionSource,
  IdVerificationStatus,
  REMINDER_RULE_CODES,
} from '@drive247/shared-types';
import { DATABASE } from '../../database/database.module';
import type { Database } from '../../database/db';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { RemindersService } from '../reminders/reminders.service';
import { IdVerificationEventsService } from './id-verification-events.service';
import { IdVerificationSessionService } from './id-verification-session.service';
import type { ManualReviewDto } from './dto/manual-review.dto';
import type { CreateSessionResponse } from '@drive247/shared-types';

/**
 * Staff manual-review actions.
 *
 * Rules enforced:
 *   #15 — manual review requires a reason (DTO already validates)
 *   #16 — approve/reject only valid on `review_required`. Overriding
 *         terminal states (already-approved → rejected, etc.) is a
 *         Phase-2 feature requiring elevated permission.
 *   #17 — staff cannot edit OCR data (not exposed here at all)
 *   #18 — transitions append events
 *   #22 — denormalized customer pointer updated atomically
 *   #25 — reminder resolved on any terminal transition
 */
@Injectable()
export class IdVerificationReviewService {
  constructor(
    @Inject(DATABASE) private db: Database,
    private readonly ctx: TenantContextService,
    private readonly events: IdVerificationEventsService,
    private readonly reminders: RemindersService,
    private readonly sessionService: IdVerificationSessionService,
  ) {}

  async review(id: string, input: ManualReviewDto): Promise<void> {
    const tenantId = this.ctx.requireTenantId();
    const userId = this.ctx.requireUserId();

    const [row] = await this.db
      .select()
      .from(idVerifications)
      .where(
        and(eq(idVerifications.id, id), eq(idVerifications.tenantId, tenantId)),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Verification not found');

    if (row.status !== IdVerificationStatus.REVIEW_REQUIRED) {
      throw new ConflictException(
        `Only verifications in review_required state can be manually reviewed. ` +
          `This one is ${row.status}.`,
      );
    }

    const nextStatus =
      input.decision === 'approve'
        ? IdVerificationStatus.APPROVED
        : IdVerificationStatus.REJECTED;
    const eventType =
      input.decision === 'approve'
        ? ID_VERIFICATION_EVENT_TYPES.DECISION_MANUAL_APPROVED
        : ID_VERIFICATION_EVENT_TYPES.DECISION_MANUAL_REJECTED;

    const now = new Date();

    await this.db.transaction(async (tx) => {
      await tx
        .update(idVerifications)
        .set({
          status: nextStatus,
          decisionSource: IdVerificationDecisionSource.MANUAL,
          decidedAt: now,
          decidedByUserId: userId,
          manualReviewNotes: input.reason,
          rejectionReason:
            input.decision === 'reject' ? input.reason : null,
          updatedAt: now,
        })
        .where(
          and(
            eq(idVerifications.id, id),
            eq(idVerifications.tenantId, tenantId),
          ),
        );

      await tx
        .update(customers)
        .set({
          identityVerificationStatus: nextStatus,
          latestVerificationId: id,
          updatedAt: now,
        })
        .where(
          and(
            eq(customers.id, row.customerId),
            eq(customers.tenantId, tenantId),
          ),
        );

      await tx
        .insert(idVerificationEvents)
        .values(
          this.events.buildValues({
            tenantId,
            verificationId: id,
            eventType,
            actorType: 'staff',
            actorUserId: userId,
            metadata: { reason: input.reason },
          }),
        );
    });

    // Resolve the review-required reminder (rule #25). The reminder is
    // tenant-scoped by rule_code, so once any one review gets resolved we
    // clear it — acceptable since staff land in the full list anyway.
    await this.reminders.resolveByRule(
      tenantId,
      REMINDER_RULE_CODES.ID_VERIFICATION_REVIEW_REQUIRED,
    );
  }

  /**
   * Retry on the same verification row. Delegates to SessionService which
   * handles S3 cleanup + token regeneration. Only exposed here so the
   * staff controller has a single service surface to talk to.
   *
   * Also resolves the reminder since review is no longer needed.
   */
  async retry(
    id: string,
    reason: string,
  ): Promise<CreateSessionResponse> {
    const result = await this.sessionService.retry(id, reason);
    const tenantId = this.ctx.requireTenantId();
    await this.reminders.resolveByRule(
      tenantId,
      REMINDER_RULE_CODES.ID_VERIFICATION_REVIEW_REQUIRED,
    );
    return result;
  }
}
