import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq } from 'drizzle-orm';
import { idVerifications, tenants } from '@drive247/database';
import {
  ID_VERIFICATION_SIGNED_URL_TTL_SECS,
  IdVerificationDecisionSource,
  IdVerificationStatus,
  RequiredDocumentType,
  type IdVerificationResponse,
  type ListVerificationsResponse,
} from '@drive247/shared-types';
import { DATABASE } from '../../database/database.module';
import type { Database } from '../../database/db';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { StorageService } from '../../common/storage/storage.service';
import { resolveThresholds } from './utils/decision.util';
import type { ListVerificationsDto } from './dto/list-verifications.dto';

type VerificationRow = typeof idVerifications.$inferSelect;
type TenantThresholdRow = {
  autoApprovePct: string | null;
  reviewPct: string | null;
  minOcrConfidence: string | null;
};

/**
 * Read-only operations on verification records: list + single-verification
 * detail. Detail always generates fresh signed URLs for image fields so
 * the browser can render them. Never returns raw S3 keys in the response.
 *
 * Mutations live in other services: SessionService (create / cancel /
 * retry), CaptureService (file uploads), ReviewService (manual review).
 */
@Injectable()
export class IdVerificationService {
  constructor(
    @Inject(DATABASE) private db: Database,
    private readonly ctx: TenantContextService,
    private readonly storage: StorageService,
  ) {}

  async list(query: ListVerificationsDto): Promise<ListVerificationsResponse> {
    const tenantId = this.ctx.requireTenantId();
    const { customerId, status, page, limit } = query;

    const conditions = [eq(idVerifications.tenantId, tenantId)];
    if (customerId)
      conditions.push(eq(idVerifications.customerId, customerId));
    if (status) conditions.push(eq(idVerifications.status, status));

    const where = and(...conditions);

    const [rows, [totalRow], thresholds] = await Promise.all([
      this.db
        .select()
        .from(idVerifications)
        .where(where)
        .orderBy(desc(idVerifications.createdAt))
        .limit(limit)
        .offset((page - 1) * limit),
      this.db.select({ count: count() }).from(idVerifications).where(where),
      this.loadTenantThresholds(tenantId),
    ]);

    const items = await Promise.all(
      rows.map((row) => this.shape(row, thresholds, { includeSignedUrls: false })),
    );

    return {
      items,
      total: totalRow?.count ?? 0,
      page,
      limit,
    };
  }

  async getById(id: string): Promise<IdVerificationResponse> {
    const tenantId = this.ctx.requireTenantId();
    const [row] = await this.db
      .select()
      .from(idVerifications)
      .where(
        and(eq(idVerifications.id, id), eq(idVerifications.tenantId, tenantId)),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Verification not found');

    const thresholds = await this.loadTenantThresholds(tenantId);
    return this.shape(row, thresholds, { includeSignedUrls: true });
  }

  // ------------------------------------------------------------------

  private async loadTenantThresholds(tenantId: string): Promise<TenantThresholdRow> {
    const [t] = await this.db
      .select({
        autoApprovePct: tenants.faceMatchAutoApprovePct,
        reviewPct: tenants.faceMatchReviewPct,
        minOcrConfidence: tenants.minOcrConfidence,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    return {
      autoApprovePct: t?.autoApprovePct ?? null,
      reviewPct: t?.reviewPct ?? null,
      minOcrConfidence: t?.minOcrConfidence ?? null,
    };
  }

  private async shape(
    row: VerificationRow,
    tenantThresholds: TenantThresholdRow,
    opts: { includeSignedUrls: boolean },
  ): Promise<IdVerificationResponse> {
    const thresholds = resolveThresholds({
      autoApprovePct: numOrNull(tenantThresholds.autoApprovePct),
      reviewPct: numOrNull(tenantThresholds.reviewPct),
      minOcrConfidence: numOrNull(tenantThresholds.minOcrConfidence),
    });

    const hasFaceMatchData =
      row.faceMatchScore !== null && row.faceMatchScore !== undefined;
    const hasOcrData =
      row.ocrConfidence !== null || row.firstName || row.documentNumber;

    const [documentFrontImageUrl, documentBackImageUrl, selfieImageUrl] =
      opts.includeSignedUrls
        ? await Promise.all([
            row.documentFrontS3Key
              ? this.storage.getSignedUrl(
                  row.documentFrontS3Key,
                  ID_VERIFICATION_SIGNED_URL_TTL_SECS,
                )
              : Promise.resolve(null),
            row.documentBackS3Key
              ? this.storage.getSignedUrl(
                  row.documentBackS3Key,
                  ID_VERIFICATION_SIGNED_URL_TTL_SECS,
                )
              : Promise.resolve(null),
            row.selfieS3Key
              ? this.storage.getSignedUrl(
                  row.selfieS3Key,
                  ID_VERIFICATION_SIGNED_URL_TTL_SECS,
                )
              : Promise.resolve(null),
          ])
        : [null, null, null];

    return {
      id: row.id,
      tenantId: row.tenantId,
      customerId: row.customerId,
      initiatedByUserId: row.initiatedByUserId,
      status: row.status as IdVerificationStatus,
      requiredDocumentType: row.requiredDocumentType as RequiredDocumentType,
      currentStep:
        (row.currentStep as IdVerificationResponse['currentStep']) ?? null,
      sessionExpiresAt: row.sessionExpiresAt.toISOString(),

      documentFrontImageUrl,
      documentBackImageUrl,
      selfieImageUrl,

      ocr: hasOcrData
        ? {
            firstName: row.firstName,
            lastName: row.lastName,
            dateOfBirth: row.dateOfBirth,
            documentNumber: row.documentNumber,
            documentCountry: row.documentCountry,
            documentExpiryDate: row.documentExpiryDate,
            documentDetectedType: row.documentDetectedType,
            confidence: numOrNull(row.ocrConfidence),
          }
        : null,

      faceMatch: hasFaceMatchData
        ? {
            score: numOrNull(row.faceMatchScore),
            autoApproveThreshold: thresholds.autoApprovePct,
            reviewThreshold: thresholds.reviewPct,
          }
        : null,

      decisionSource:
        (row.decisionSource as IdVerificationDecisionSource | null) ?? null,
      decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
      decidedByUserId: row.decidedByUserId,
      rejectionReason: row.rejectionReason,
      manualReviewNotes: row.manualReviewNotes,
      matchedBlockId: row.matchedBlockId,

      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

function numOrNull(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}
