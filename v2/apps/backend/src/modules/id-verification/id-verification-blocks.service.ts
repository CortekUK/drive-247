import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { blockedIdentities } from '@drive247/database';
import {
  BlockedIdentityType,
  type BlockedIdentityResponse,
} from '@drive247/shared-types';
import { DATABASE } from '../../database/database.module';
import type { Database } from '../../database/db';
import { TenantContextService } from '../../common/context/tenant-context.service';
import type { CreateBlockDto } from './dto/create-block.dto';
import type { UpdateBlockDto } from './dto/update-block.dto';
import type { ListBlocksDto } from './dto/list-blocks.dto';

type BlockRow = typeof blockedIdentities.$inferSelect;

/**
 * Tenant-scoped blacklist of ID identifiers (license number, passport
 * number, ID card number, email). When a verification completes OCR,
 * the ProcessingService calls `findMatch()` here — if any extracted
 * value matches an active block, the verification is auto-rejected with
 * `matched_block_id` set.
 *
 * Normalization rule: all values stored lowercase + trimmed. Lookups
 * apply the same transform so matching is case-insensitive regardless
 * of how the document text was captured or entered.
 */
@Injectable()
export class IdVerificationBlocksService {
  constructor(
    @Inject(DATABASE) private db: Database,
    private readonly ctx: TenantContextService,
  ) {}

  async list(query: ListBlocksDto): Promise<BlockedIdentityResponse[]> {
    const tenantId = this.ctx.requireTenantId();
    const conditions = [eq(blockedIdentities.tenantId, tenantId)];
    if (query.identityType)
      conditions.push(eq(blockedIdentities.identityType, query.identityType));
    if (query.isActive !== undefined)
      conditions.push(eq(blockedIdentities.isActive, query.isActive));

    const rows = await this.db
      .select()
      .from(blockedIdentities)
      .where(and(...conditions))
      .orderBy(desc(blockedIdentities.createdAt));

    return rows.map(shape);
  }

  async create(input: CreateBlockDto): Promise<BlockedIdentityResponse> {
    const tenantId = this.ctx.requireTenantId();
    const userId = this.ctx.getUserId();
    const normalized = normalize(input.identityValue);

    // Unique (tenant, type, value) — reject duplicates with a clear message
    const [existing] = await this.db
      .select({ id: blockedIdentities.id })
      .from(blockedIdentities)
      .where(
        and(
          eq(blockedIdentities.tenantId, tenantId),
          eq(blockedIdentities.identityType, input.identityType),
          eq(blockedIdentities.identityValue, normalized),
        ),
      )
      .limit(1);
    if (existing) {
      throw new ConflictException(
        'This identity is already blocked for your tenant',
      );
    }

    const [row] = await this.db
      .insert(blockedIdentities)
      .values({
        tenantId,
        identityType: input.identityType,
        identityValue: normalized,
        reason: input.reason,
        createdByUserId: userId,
      })
      .returning();
    return shape(row);
  }

  async update(
    id: string,
    input: UpdateBlockDto,
  ): Promise<BlockedIdentityResponse> {
    const tenantId = this.ctx.requireTenantId();
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.reason !== undefined) patch.reason = input.reason;
    if (input.isActive !== undefined) patch.isActive = input.isActive;

    const [updated] = await this.db
      .update(blockedIdentities)
      .set(patch)
      .where(
        and(
          eq(blockedIdentities.id, id),
          eq(blockedIdentities.tenantId, tenantId),
        ),
      )
      .returning();
    if (!updated) throw new NotFoundException('Blocked identity not found');
    return shape(updated);
  }

  async remove(id: string): Promise<{ success: true }> {
    const tenantId = this.ctx.requireTenantId();
    const result = await this.db
      .delete(blockedIdentities)
      .where(
        and(
          eq(blockedIdentities.id, id),
          eq(blockedIdentities.tenantId, tenantId),
        ),
      )
      .returning({ id: blockedIdentities.id });
    if (result.length === 0)
      throw new NotFoundException('Blocked identity not found');
    return { success: true };
  }

  // ---------------------------------------------------------------------
  // Internal — called by ProcessingService with an explicit tenantId
  // because it may run inside a request context we don't control here.
  // ---------------------------------------------------------------------

  /**
   * Returns the first matching active block for any of the supplied values,
   * or null when nothing matches. Values that are empty / null / whitespace
   * are skipped. Matches are case-insensitive via the normalize() transform.
   */
  async findMatch(
    tenantId: string,
    candidates: Array<{
      type: BlockedIdentityType;
      value: string | null | undefined;
    }>,
  ): Promise<BlockRow | null> {
    for (const c of candidates) {
      if (!c.value) continue;
      const normalized = normalize(c.value);
      if (!normalized) continue;

      const [hit] = await this.db
        .select()
        .from(blockedIdentities)
        .where(
          and(
            eq(blockedIdentities.tenantId, tenantId),
            eq(blockedIdentities.isActive, true),
            eq(blockedIdentities.identityType, c.type),
            eq(blockedIdentities.identityValue, normalized),
          ),
        )
        .limit(1);
      if (hit) return hit;
    }
    return null;
  }
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function shape(row: BlockRow): BlockedIdentityResponse {
  return {
    id: row.id,
    identityType: row.identityType as BlockedIdentityType,
    identityValue: row.identityValue,
    reason: row.reason,
    isActive: row.isActive,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
