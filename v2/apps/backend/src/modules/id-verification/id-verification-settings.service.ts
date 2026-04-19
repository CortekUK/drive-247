import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { tenants } from '@drive247/database';
import {
  RequiredDocumentType,
  type IdVerificationSettingsResponse,
} from '@drive247/shared-types';
import { DATABASE } from '../../database/database.module';
import type { Database } from '../../database/db';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { resolveThresholds } from './utils/decision.util';
import type { UpdateSettingsDto } from './dto/update-settings.dto';

type TenantRow = typeof tenants.$inferSelect;

/**
 * Per-tenant ID-verification settings: enabled toggle, required doc type,
 * and optional threshold overrides. Response always exposes both the raw
 * tenant value AND the resolved effective value so the settings UI can
 * show "(default: 90)" hints next to empty inputs.
 */
@Injectable()
export class IdVerificationSettingsService {
  constructor(
    @Inject(DATABASE) private db: Database,
    private readonly ctx: TenantContextService,
  ) {}

  async get(): Promise<IdVerificationSettingsResponse> {
    const tenantId = this.ctx.requireTenantId();
    const [t] = await this.db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!t) throw new NotFoundException('Tenant not found');
    return this.shape(t);
  }

  async update(
    input: UpdateSettingsDto,
  ): Promise<IdVerificationSettingsResponse> {
    const tenantId = this.ctx.requireTenantId();

    const [current] = await this.db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!current) throw new NotFoundException('Tenant not found');

    // Cross-field check that accounts for partially-supplied updates:
    // if the caller supplied only one threshold, compare against the
    // other's existing value (or resolved default) so we don't let the
    // pair get into an invalid ordering via two separate PATCHes.
    const nextAutoApprove =
      input.faceMatchAutoApprovePct !== undefined
        ? input.faceMatchAutoApprovePct
        : numOrNull(current.faceMatchAutoApprovePct);
    const nextReview =
      input.faceMatchReviewPct !== undefined
        ? input.faceMatchReviewPct
        : numOrNull(current.faceMatchReviewPct);
    const resolved = resolveThresholds({
      autoApprovePct: nextAutoApprove,
      reviewPct: nextReview,
      minOcrConfidence: null,
    });
    if (resolved.autoApprovePct <= resolved.reviewPct) {
      throw new BadRequestException(
        'Auto-approve percentage must be strictly greater than review percentage',
      );
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.enabled !== undefined) patch.idVerificationEnabled = input.enabled;
    if (input.requiredDocumentType !== undefined)
      patch.requiredDocumentType = input.requiredDocumentType;
    if (input.faceMatchAutoApprovePct !== undefined)
      patch.faceMatchAutoApprovePct =
        input.faceMatchAutoApprovePct === null
          ? null
          : String(input.faceMatchAutoApprovePct);
    if (input.faceMatchReviewPct !== undefined)
      patch.faceMatchReviewPct =
        input.faceMatchReviewPct === null
          ? null
          : String(input.faceMatchReviewPct);
    if (input.minOcrConfidence !== undefined)
      patch.minOcrConfidence =
        input.minOcrConfidence === null
          ? null
          : String(input.minOcrConfidence);

    const [updated] = await this.db
      .update(tenants)
      .set(patch)
      .where(eq(tenants.id, tenantId))
      .returning();
    return this.shape(updated);
  }

  // ------------------------------------------------------------------

  private shape(t: TenantRow): IdVerificationSettingsResponse {
    const overrides = {
      autoApprovePct: numOrNull(t.faceMatchAutoApprovePct),
      reviewPct: numOrNull(t.faceMatchReviewPct),
      minOcrConfidence: numOrNull(t.minOcrConfidence),
    };
    const effective = resolveThresholds(overrides);
    return {
      enabled: t.idVerificationEnabled,
      requiredDocumentType: t.requiredDocumentType as RequiredDocumentType,
      faceMatchAutoApprovePct: overrides.autoApprovePct,
      faceMatchReviewPct: overrides.reviewPct,
      minOcrConfidence: overrides.minOcrConfidence,
      effectiveFaceMatchAutoApprovePct: effective.autoApprovePct,
      effectiveFaceMatchReviewPct: effective.reviewPct,
      effectiveMinOcrConfidence: effective.minOcrConfidence,
    };
  }
}

function numOrNull(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}
