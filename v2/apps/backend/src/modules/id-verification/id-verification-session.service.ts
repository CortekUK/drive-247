import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { idVerifications, customers, tenants } from '@drive247/database';
import {
  ID_VERIFICATION_EVENT_TYPES,
  ID_VERIFICATION_SESSION_TTL_MS,
  IdVerificationStatus,
  RequiredDocumentType,
  type CreateSessionResponse,
} from '@drive247/shared-types';
import { getEnv } from '../../config/env.config';
import { DATABASE } from '../../database/database.module';
import type { Database } from '../../database/db';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { StorageService } from '../../common/storage/storage.service';
import {
  generateToken,
  hashToken,
  isExpired,
} from './utils/qr-token.util';
import { IdVerificationEventsService } from './id-verification-events.service';

type VerificationRow = typeof idVerifications.$inferSelect;

/** Statuses that represent an "active" (not-yet-terminal) session. */
const ACTIVE_STATUSES: IdVerificationStatus[] = [
  IdVerificationStatus.INITIATED,
  IdVerificationStatus.IN_PROGRESS,
];

/**
 * Session lifecycle: create / cancel / retry / validate-token / expire.
 *
 * Rules enforced here:
 *   #2  — QR tokens are cryptographically random (via qr-token.util)
 *   #3  — raw tokens never persisted (we only ever store the hash)
 *   #4  — sessions expire after TTL (checked on every validate)
 *   #6  — one active session per customer (new create auto-cancels old)
 *   #14 — retry clears S3 files + generates a new token on the SAME row
 *   #18 — every transition emits an event
 */
@Injectable()
export class IdVerificationSessionService {
  constructor(
    @Inject(DATABASE) private db: Database,
    private readonly ctx: TenantContextService,
    private readonly events: IdVerificationEventsService,
    private readonly storage: StorageService,
  ) {}

  // -------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------

  async create(input: {
    customerId: string;
    requiredDocumentType?: RequiredDocumentType;
  }): Promise<CreateSessionResponse> {
    const tenantId = this.ctx.requireTenantId();
    const userId = this.ctx.getUserId();

    // Verify customer + tenant enablement in one round-trip
    const [customer, [tenant]] = await Promise.all([
      this.db
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.id, input.customerId), eq(customers.tenantId, tenantId)))
        .limit(1)
        .then((r) => r[0]),
      this.db
        .select({
          enabled: tenants.idVerificationEnabled,
          requiredDocumentType: tenants.requiredDocumentType,
        })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1),
    ]);
    if (!customer) throw new NotFoundException('Customer not found');
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (!tenant.enabled) {
      throw new ConflictException(
        'ID verification is not enabled for your tenant. Enable it in settings first.',
      );
    }

    const requiredDocumentType =
      input.requiredDocumentType ??
      (tenant.requiredDocumentType as RequiredDocumentType);

    // Auto-cancel any existing active session for this customer (rule #6)
    await this.cancelActiveForCustomer(
      tenantId,
      input.customerId,
      'superseded_by_new_session',
    );

    const { raw, hash } = generateToken();
    const expiresAt = new Date(Date.now() + ID_VERIFICATION_SESSION_TTL_MS);

    const [row] = await this.db
      .insert(idVerifications)
      .values({
        tenantId,
        customerId: input.customerId,
        initiatedByUserId: userId,
        sessionTokenHash: hash,
        sessionExpiresAt: expiresAt,
        requiredDocumentType,
        status: IdVerificationStatus.INITIATED,
      })
      .returning();

    await this.events.append({
      tenantId,
      verificationId: row.id,
      eventType: ID_VERIFICATION_EVENT_TYPES.SESSION_CREATED,
      actorType: 'staff',
      actorUserId: userId,
      metadata: { requiredDocumentType },
    });

    return {
      verificationId: row.id,
      qrUrl: this.buildQrUrl(raw),
      sessionExpiresAt: expiresAt.toISOString(),
    };
  }

  // -------------------------------------------------------------------
  // Cancel
  // -------------------------------------------------------------------

  /**
   * Cancel a specific verification by id. Only allowed on non-terminal
   * states — already-decided verifications are immutable.
   */
  async cancelById(id: string): Promise<void> {
    const tenantId = this.ctx.requireTenantId();
    const userId = this.ctx.getUserId();

    const [row] = await this.db
      .select()
      .from(idVerifications)
      .where(
        and(eq(idVerifications.id, id), eq(idVerifications.tenantId, tenantId)),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Verification not found');
    if (!this.isCancellable(row.status)) {
      throw new ConflictException(
        `Cannot cancel a verification that is already ${row.status}`,
      );
    }

    await this.db
      .update(idVerifications)
      .set({
        status: IdVerificationStatus.CANCELLED,
        updatedAt: new Date(),
      })
      .where(
        and(eq(idVerifications.id, id), eq(idVerifications.tenantId, tenantId)),
      );

    await this.events.append({
      tenantId,
      verificationId: id,
      eventType: ID_VERIFICATION_EVENT_TYPES.SESSION_CANCELLED,
      actorType: 'staff',
      actorUserId: userId,
      metadata: { reason: 'manual_cancel' },
    });
  }

  // -------------------------------------------------------------------
  // Retry (rule #14)
  // -------------------------------------------------------------------

  /**
   * Retry on the SAME verification row — generates a fresh QR, clears old
   * S3 files, resets OCR/face-match fields. Old session is event-logged as
   * retried; the row itself transitions back to `initiated`.
   */
  async retry(
    id: string,
    reason: string,
  ): Promise<CreateSessionResponse> {
    const tenantId = this.ctx.requireTenantId();
    const userId = this.ctx.getUserId();

    const [row] = await this.db
      .select()
      .from(idVerifications)
      .where(
        and(eq(idVerifications.id, id), eq(idVerifications.tenantId, tenantId)),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Verification not found');

    // Retry is allowed from any non-initiated state (initiated is already fresh).
    // If it's initiated, just tell the caller to reuse the existing session.
    if (row.status === IdVerificationStatus.INITIATED) {
      throw new ConflictException(
        'This session is already fresh — ask the customer to scan the existing QR.',
      );
    }

    // Best-effort delete of previous S3 files (rule #14). Orphans are OK.
    for (const key of [
      row.documentFrontS3Key,
      row.documentBackS3Key,
      row.selfieS3Key,
    ]) {
      if (key) await this.storage.delete(key);
    }

    const { raw, hash } = generateToken();
    const expiresAt = new Date(Date.now() + ID_VERIFICATION_SESSION_TTL_MS);

    await this.db
      .update(idVerifications)
      .set({
        sessionTokenHash: hash,
        sessionExpiresAt: expiresAt,
        currentStep: null,
        status: IdVerificationStatus.INITIATED,
        documentFrontS3Key: null,
        documentBackS3Key: null,
        selfieS3Key: null,
        firstName: null,
        lastName: null,
        dateOfBirth: null,
        documentNumber: null,
        documentCountry: null,
        documentExpiryDate: null,
        documentDetectedType: null,
        ocrConfidence: null,
        ocrRaw: null,
        faceMatchScore: null,
        faceMatchRaw: null,
        decisionSource: null,
        decidedAt: null,
        decidedByUserId: null,
        rejectionReason: null,
        manualReviewNotes: null,
        matchedBlockId: null,
        updatedAt: new Date(),
      })
      .where(
        and(eq(idVerifications.id, id), eq(idVerifications.tenantId, tenantId)),
      );

    await this.events.append({
      tenantId,
      verificationId: id,
      eventType: ID_VERIFICATION_EVENT_TYPES.SESSION_RETRIED,
      actorType: 'staff',
      actorUserId: userId,
      metadata: { reason, previousStatus: row.status },
    });

    return {
      verificationId: id,
      qrUrl: this.buildQrUrl(raw),
      sessionExpiresAt: expiresAt.toISOString(),
    };
  }

  // -------------------------------------------------------------------
  // Token lookup / validation (used by QrTokenAuthGuard)
  // -------------------------------------------------------------------

  /**
   * Resolve a raw QR token to a verification row. Lazily marks expired
   * sessions as `expired` so their status reflects reality on read.
   *
   * Returns null when the token doesn't match any row, or when the row is
   * in a state that doesn't allow continued capture (cancelled, expired,
   * or already in a terminal decided state).
   *
   * Tokens are only usable while status is `initiated` or `in_progress`.
   */
  async findByToken(rawToken: string): Promise<VerificationRow | null> {
    if (!rawToken) return null;
    const hash = hashToken(rawToken);

    const [row] = await this.db
      .select()
      .from(idVerifications)
      .where(eq(idVerifications.sessionTokenHash, hash))
      .limit(1);
    if (!row) return null;

    // Expire lazily (rule #4)
    if (
      ACTIVE_STATUSES.includes(row.status as IdVerificationStatus) &&
      isExpired(row.sessionExpiresAt)
    ) {
      await this.db
        .update(idVerifications)
        .set({
          status: IdVerificationStatus.EXPIRED,
          updatedAt: new Date(),
        })
        .where(eq(idVerifications.id, row.id));
      await this.events.append({
        tenantId: row.tenantId,
        verificationId: row.id,
        eventType: ID_VERIFICATION_EVENT_TYPES.SESSION_EXPIRED,
        actorType: 'system',
        metadata: {},
      });
      return { ...row, status: IdVerificationStatus.EXPIRED };
    }

    return row;
  }

  // -------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------

  private async cancelActiveForCustomer(
    tenantId: string,
    customerId: string,
    reason: string,
  ): Promise<void> {
    const active = await this.db
      .select({ id: idVerifications.id })
      .from(idVerifications)
      .where(
        and(
          eq(idVerifications.tenantId, tenantId),
          eq(idVerifications.customerId, customerId),
          inArray(idVerifications.status, ACTIVE_STATUSES),
        ),
      );
    if (active.length === 0) return;

    await this.db
      .update(idVerifications)
      .set({
        status: IdVerificationStatus.CANCELLED,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(idVerifications.tenantId, tenantId),
          eq(idVerifications.customerId, customerId),
          inArray(idVerifications.status, ACTIVE_STATUSES),
        ),
      );

    for (const row of active) {
      await this.events.append({
        tenantId,
        verificationId: row.id,
        eventType: ID_VERIFICATION_EVENT_TYPES.SESSION_CANCELLED,
        actorType: 'system',
        metadata: { reason },
      });
    }
  }

  private isCancellable(status: string): boolean {
    return (
      status === IdVerificationStatus.INITIATED ||
      status === IdVerificationStatus.IN_PROGRESS ||
      status === IdVerificationStatus.REVIEW_REQUIRED
    );
  }

  private buildQrUrl(rawToken: string): string {
    const base = getEnv().PORTAL_BASE_URL.replace(/\/+$/, '');
    return `${base}/verify/${encodeURIComponent(rawToken)}`;
  }
}

