import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  customers,
  idVerificationEvents,
  idVerifications,
  tenants,
} from '@drive247/database';
import {
  BlockedIdentityType,
  ID_VERIFICATION_EVENT_TYPES,
  ID_VERIFICATION_SIGNED_URL_TTL_SECS,
  IdVerificationDecisionSource,
  IdVerificationStatus,
  REMINDER_RULE_CODES,
  ReminderSeverity,
  type RequiredDocumentType,
} from '@drive247/shared-types';
import { DATABASE } from '../../database/database.module';
import type { Database } from '../../database/db';
import { StorageService } from '../../common/storage/storage.service';
import { VisionClient } from '../../integrations/openai/vision.client';
import { RekognitionClient } from '../../integrations/aws/rekognition.client';
import { RekognitionNoFaceDetectedError } from '../../integrations/aws/errors';
import { RemindersService } from '../reminders/reminders.service';
import { IdVerificationBlocksService } from './id-verification-blocks.service';
import { IdVerificationEventsService } from './id-verification-events.service';
import {
  decide,
  resolveThresholds,
  type DecisionOutput,
  type DecisionThresholds,
} from './utils/decision.util';

type VerificationRow = typeof idVerifications.$inferSelect;

/**
 * Orchestrates OCR → face match → block check → decision.
 *
 * Called by the public submit endpoint. Runs asynchronously (fire-and-forget
 * in Phase 1 — ProcessingService.process is invoked without await from the
 * controller; Phase 2 moves this to a BullMQ queue for retries).
 *
 * DB writes are atomic per phase — OCR and face-match persist their raw
 * results immediately so a crash mid-flight doesn't lose work, but the
 * final decision + customer-side denormalization commits in a single
 * transaction (rule #22).
 */
@Injectable()
export class IdVerificationProcessingService {
  private readonly logger = new Logger(IdVerificationProcessingService.name);

  constructor(
    @Inject(DATABASE) private db: Database,
    private readonly storage: StorageService,
    private readonly vision: VisionClient,
    private readonly rekognition: RekognitionClient,
    private readonly blocks: IdVerificationBlocksService,
    private readonly events: IdVerificationEventsService,
    private readonly reminders: RemindersService,
  ) {}

  /**
   * Process a verification. Safe to invoke without await — errors are
   * caught and persisted on the row as a rejection reason.
   */
  async process(verificationId: string): Promise<void> {
    try {
      await this.runPipeline(verificationId);
    } catch (err) {
      // Catch-all — never crash the caller. Persist a rejection + event.
      const message = (err as Error).message ?? 'unknown error';
      this.logger.error(
        `Processing failed for verification ${verificationId}: ${message}`,
      );
      await this.markCatastrophicFailure(verificationId, message);
    }
  }

  // ------------------------------------------------------------------

  private async runPipeline(verificationId: string): Promise<void> {
    const row = await this.loadVerification(verificationId);
    if (!row) return; // already cancelled or deleted mid-flight

    // Guard: only `processing` rows proceed. If a human already resolved
    // it (review_required → approved manually before processor ran), bail.
    if (row.status !== IdVerificationStatus.PROCESSING) {
      this.logger.warn(
        `Skipping processing for ${verificationId} — status=${row.status}`,
      );
      return;
    }

    await this.events.append({
      tenantId: row.tenantId,
      verificationId: row.id,
      eventType: ID_VERIFICATION_EVENT_TYPES.PROCESSING_STARTED,
      actorType: 'system',
      metadata: {},
    });

    // ----- Phase 1: OCR -----
    const ocr = await this.runOcr(row);

    // ----- Phase 2: Face match -----
    const faceMatch = await this.runFaceMatch(row);

    // ----- Phase 3: Block lookup -----
    const blockMatch = await this.runBlockLookup(row, ocr);

    // ----- Phase 4: Decision -----
    const thresholds = await this.loadThresholds(row.tenantId);
    const decision = decide({
      faceMatchScore: faceMatch.score,
      ocrConfidence: ocr.confidence,
      blockMatch: Boolean(blockMatch),
      thresholds,
    });

    await this.commitDecision(row, decision, blockMatch?.id ?? null);

    // Reminder side-effects (rule #25)
    await this.emitOrResolveReminder(row.tenantId, row.id, decision);
  }

  // ------------------------------------------------------------------
  // OCR
  // ------------------------------------------------------------------

  private async runOcr(row: VerificationRow): Promise<{
    confidence: number | null;
  }> {
    if (!row.documentFrontS3Key) {
      return { confidence: null };
    }

    let frontUrl: string;
    let backUrl: string | null = null;
    try {
      frontUrl = await this.storage.getSignedUrl(
        row.documentFrontS3Key,
        ID_VERIFICATION_SIGNED_URL_TTL_SECS,
      );
      if (row.documentBackS3Key) {
        backUrl = await this.storage.getSignedUrl(
          row.documentBackS3Key,
          ID_VERIFICATION_SIGNED_URL_TTL_SECS,
        );
      }
    } catch (err) {
      this.logger.warn(`Signed URL generation failed: ${(err as Error).message}`);
      return { confidence: null };
    }

    const result = await this.vision.extractDocumentData({
      frontImageUrl: frontUrl,
      backImageUrl: backUrl,
      requiredDocumentType: row.requiredDocumentType,
    });

    if (!result) {
      // Vision unavailable — persist nothing new, caller treats as review_required
      await this.events.append({
        tenantId: row.tenantId,
        verificationId: row.id,
        eventType: ID_VERIFICATION_EVENT_TYPES.PROCESSING_OCR_COMPLETED,
        actorType: 'system',
        metadata: { success: false },
      });
      return { confidence: null };
    }

    await this.db
      .update(idVerifications)
      .set({
        firstName: result.firstName,
        lastName: result.lastName,
        dateOfBirth: result.dateOfBirth,
        documentNumber: result.documentNumber,
        documentCountry: result.documentCountry,
        documentExpiryDate: result.documentExpiryDate,
        documentDetectedType: result.documentDetectedType,
        ocrConfidence:
          result.confidence !== null ? String(result.confidence) : null,
        ocrRaw: result.raw as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(idVerifications.id, row.id));

    await this.events.append({
      tenantId: row.tenantId,
      verificationId: row.id,
      eventType: ID_VERIFICATION_EVENT_TYPES.PROCESSING_OCR_COMPLETED,
      actorType: 'system',
      metadata: { success: true, confidence: result.confidence },
    });

    return { confidence: result.confidence };
  }

  // ------------------------------------------------------------------
  // Face match
  // ------------------------------------------------------------------

  private async runFaceMatch(row: VerificationRow): Promise<{
    score: number | null;
  }> {
    if (!row.documentFrontS3Key || !row.selfieS3Key) {
      return { score: null };
    }

    try {
      const result = await this.rekognition.compareFaces(
        row.documentFrontS3Key,
        row.selfieS3Key,
      );
      await this.db
        .update(idVerifications)
        .set({
          faceMatchScore: result.similarity.toFixed(2),
          faceMatchRaw: result.raw as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .where(eq(idVerifications.id, row.id));
      await this.events.append({
        tenantId: row.tenantId,
        verificationId: row.id,
        eventType: ID_VERIFICATION_EVENT_TYPES.PROCESSING_FACE_MATCH_COMPLETED,
        actorType: 'system',
        metadata: { similarity: result.similarity, faceCount: result.faceCount },
      });
      return { score: result.similarity };
    } catch (err) {
      if (err instanceof RekognitionNoFaceDetectedError) {
        // Persist nothing — score stays null, decision becomes review_required
        await this.events.append({
          tenantId: row.tenantId,
          verificationId: row.id,
          eventType: ID_VERIFICATION_EVENT_TYPES.PROCESSING_FACE_MATCH_COMPLETED,
          actorType: 'system',
          metadata: { success: false, reason: 'no_face_detected' },
        });
        return { score: null };
      }
      this.logger.warn(
        `Face match failed for ${row.id}: ${(err as Error).message}`,
      );
      await this.events.append({
        tenantId: row.tenantId,
        verificationId: row.id,
        eventType: ID_VERIFICATION_EVENT_TYPES.PROCESSING_FACE_MATCH_COMPLETED,
        actorType: 'system',
        metadata: { success: false, error: (err as Error).message },
      });
      return { score: null };
    }
  }

  // ------------------------------------------------------------------
  // Block lookup
  // ------------------------------------------------------------------

  private async runBlockLookup(
    row: VerificationRow,
    _ocr: { confidence: number | null },
  ): Promise<{ id: string; identityType: string } | null> {
    // Re-read the row to get freshly-persisted OCR fields
    const [fresh] = await this.db
      .select({
        documentNumber: idVerifications.documentNumber,
        requiredDocumentType: idVerifications.requiredDocumentType,
        tenantId: idVerifications.tenantId,
        customerId: idVerifications.customerId,
      })
      .from(idVerifications)
      .where(eq(idVerifications.id, row.id))
      .limit(1);
    if (!fresh) return null;

    // Pull customer email for the email-type check
    const [customer] = await this.db
      .select({ email: customers.email })
      .from(customers)
      .where(eq(customers.id, fresh.customerId))
      .limit(1);

    const candidates: Array<{
      type: BlockedIdentityType;
      value: string | null | undefined;
    }> = [
      {
        type: docTypeToBlockType(fresh.requiredDocumentType),
        value: fresh.documentNumber,
      },
      { type: BlockedIdentityType.EMAIL, value: customer?.email ?? null },
    ];

    const match = await this.blocks.findMatch(fresh.tenantId, candidates);
    if (match) {
      await this.events.append({
        tenantId: row.tenantId,
        verificationId: row.id,
        eventType: ID_VERIFICATION_EVENT_TYPES.PROCESSING_BLOCK_MATCHED,
        actorType: 'system',
        metadata: {
          blockId: match.id,
          identityType: match.identityType,
        },
      });
      return { id: match.id, identityType: match.identityType };
    }
    return null;
  }

  // ------------------------------------------------------------------
  // Commit decision atomically + update denormalized customer pointers
  // ------------------------------------------------------------------

  private async commitDecision(
    row: VerificationRow,
    decision: DecisionOutput,
    matchedBlockId: string | null,
  ): Promise<void> {
    const now = new Date();

    await this.db.transaction(async (tx) => {
      await tx
        .update(idVerifications)
        .set({
          status: decision.status,
          decisionSource: IdVerificationDecisionSource.AUTO,
          decidedAt: now,
          rejectionReason:
            decision.status === IdVerificationStatus.REJECTED
              ? decision.reason
              : null,
          matchedBlockId,
          updatedAt: now,
        })
        .where(eq(idVerifications.id, row.id));

      // Rule #22 — denormalized pointer on customers
      await tx
        .update(customers)
        .set({
          identityVerificationStatus: decision.status,
          latestVerificationId: row.id,
          updatedAt: now,
        })
        .where(
          and(
            eq(customers.id, row.customerId),
            eq(customers.tenantId, row.tenantId),
          ),
        );

      const eventType =
        decision.status === IdVerificationStatus.APPROVED
          ? ID_VERIFICATION_EVENT_TYPES.DECISION_AUTO_APPROVED
          : decision.status === IdVerificationStatus.REJECTED
            ? ID_VERIFICATION_EVENT_TYPES.DECISION_AUTO_REJECTED
            : ID_VERIFICATION_EVENT_TYPES.DECISION_REVIEW_REQUIRED;

      await tx
        .insert(idVerificationEvents)
        .values(
          this.events.buildValues({
            tenantId: row.tenantId,
            verificationId: row.id,
            eventType,
            actorType: 'system',
            metadata: { reason: decision.reason, matchedBlockId },
          }),
        );
    });
  }

  // ------------------------------------------------------------------
  // Reminder emission (rule #25)
  // ------------------------------------------------------------------

  private async emitOrResolveReminder(
    tenantId: string,
    verificationId: string,
    decision: DecisionOutput,
  ): Promise<void> {
    if (decision.status === IdVerificationStatus.REVIEW_REQUIRED) {
      await this.reminders.upsertByRule(
        tenantId,
        REMINDER_RULE_CODES.ID_VERIFICATION_REVIEW_REQUIRED,
        {
          objectType: 'id_verification',
          objectId: verificationId,
          title: 'ID verification needs review',
          message:
            'An ID verification landed in the review band. Open the verification to approve or reject.',
          severity: ReminderSeverity.WARNING,
          context: { verificationId, reason: decision.reason },
        },
      );
    } else {
      // Auto-approved / auto-rejected — nothing to review, but if a stale
      // reminder exists from a prior state, resolve it.
      await this.reminders.resolveByRule(
        tenantId,
        REMINDER_RULE_CODES.ID_VERIFICATION_REVIEW_REQUIRED,
      );
    }
  }

  // ------------------------------------------------------------------

  private async loadVerification(
    id: string,
  ): Promise<VerificationRow | null> {
    const [row] = await this.db
      .select()
      .from(idVerifications)
      .where(eq(idVerifications.id, id))
      .limit(1);
    return row ?? null;
  }

  private async loadThresholds(tenantId: string): Promise<DecisionThresholds> {
    const [t] = await this.db
      .select({
        autoApprovePct: tenants.faceMatchAutoApprovePct,
        reviewPct: tenants.faceMatchReviewPct,
        minOcrConfidence: tenants.minOcrConfidence,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    return resolveThresholds({
      autoApprovePct: t ? numOrNull(t.autoApprovePct) : null,
      reviewPct: t ? numOrNull(t.reviewPct) : null,
      minOcrConfidence: t ? numOrNull(t.minOcrConfidence) : null,
    });
  }

  private async markCatastrophicFailure(
    verificationId: string,
    message: string,
  ): Promise<void> {
    const [row] = await this.db
      .select({
        tenantId: idVerifications.tenantId,
        customerId: idVerifications.customerId,
        status: idVerifications.status,
      })
      .from(idVerifications)
      .where(eq(idVerifications.id, verificationId))
      .limit(1);
    if (!row) return;
    if (row.status !== IdVerificationStatus.PROCESSING) return;

    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx
        .update(idVerifications)
        .set({
          status: IdVerificationStatus.REVIEW_REQUIRED,
          decisionSource: IdVerificationDecisionSource.AUTO,
          decidedAt: now,
          rejectionReason: `Processing error — ${message}`,
          updatedAt: now,
        })
        .where(eq(idVerifications.id, verificationId));
      await tx
        .update(customers)
        .set({
          identityVerificationStatus: IdVerificationStatus.REVIEW_REQUIRED,
          latestVerificationId: verificationId,
          updatedAt: now,
        })
        .where(
          and(
            eq(customers.id, row.customerId),
            eq(customers.tenantId, row.tenantId),
          ),
        );
      await tx
        .insert(idVerificationEvents)
        .values(
          this.events.buildValues({
            tenantId: row.tenantId,
            verificationId,
            eventType:
              ID_VERIFICATION_EVENT_TYPES.DECISION_REVIEW_REQUIRED,
            actorType: 'system',
            metadata: { reason: 'processing_error', error: message },
          }),
        );
    });

    await this.reminders.upsertByRule(
      row.tenantId,
      REMINDER_RULE_CODES.ID_VERIFICATION_REVIEW_REQUIRED,
      {
        objectType: 'id_verification',
        objectId: verificationId,
        title: 'ID verification needs review',
        message:
          'Processing failed for an ID verification. Manual review required.',
        severity: ReminderSeverity.WARNING,
        context: { verificationId, reason: 'processing_error' },
      },
    );
  }
}

// ---------------------------------------------------------------------------

function docTypeToBlockType(docType: string): BlockedIdentityType {
  switch (docType as RequiredDocumentType) {
    case 'driving_license':
      return BlockedIdentityType.DRIVING_LICENSE;
    case 'passport':
      return BlockedIdentityType.PASSPORT;
    case 'id_card':
      return BlockedIdentityType.ID_CARD;
    default:
      return BlockedIdentityType.DRIVING_LICENSE;
  }
}

function numOrNull(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}
