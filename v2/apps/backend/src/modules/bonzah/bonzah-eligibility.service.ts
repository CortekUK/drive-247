import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { vehicles } from '@drive247/database';
import type { EligibilityCheckResponse } from '@drive247/shared-types';
import { DATABASE } from '../../database/database.module';
import type { Database } from '../../database/db';
import { TenantContextService } from '../../common/context/tenant-context.service';
import {
  BONZAH_RESTRICTED_BRANDS,
  BONZAH_RESTRICTED_MODEL_PATTERNS,
} from '../../integrations/bonzah/constants';
import { OpenAIClient } from '../../integrations/openai/openai.client';
import {
  OPENAI_MAX_TOKENS_ELIGIBILITY,
  OPENAI_MODEL_ELIGIBILITY,
  OPENAI_TEMPERATURE_DETERMINISTIC,
} from '../../integrations/openai/constants';

interface CacheEntry {
  result: EligibilityCheckResponse;
  expiresAt: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Vehicle eligibility check.
 *
 * Order:
 *   1. Hardcoded exclusion list (fast, deterministic) — rule #14
 *   2. If no hit, ask OpenAI (fuzzy backstop for new/ambiguous vehicles)
 *   3. If OpenAI is not configured or errors out, fail open (eligible=true)
 *      — matches V1 behaviour, keeps the flow unblocked for legitimate vehicles
 *
 * Results cached in-process by (tenantId, makeLower, modelLower) for 24h.
 */
@Injectable()
export class BonzahEligibilityService {
  private readonly logger = new Logger(BonzahEligibilityService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @Inject(DATABASE) private db: Database,
    private readonly ctx: TenantContextService,
    private readonly openai: OpenAIClient,
  ) {}

  async checkVehicle(vehicleId: string): Promise<EligibilityCheckResponse> {
    const tenantId = this.ctx.requireTenantId();

    const [vehicle] = await this.db
      .select({ make: vehicles.make, model: vehicles.model })
      .from(vehicles)
      .where(and(eq(vehicles.id, vehicleId), eq(vehicles.tenantId, tenantId)))
      .limit(1);

    if (!vehicle) {
      throw new NotFoundException('Vehicle not found');
    }

    const key = this.cacheKey(tenantId, vehicle.make, vehicle.model);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }

    const result = await this.resolve(vehicle.make, vehicle.model);
    this.cache.set(key, {
      result,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return result;
  }

  /**
   * Test-only helper — exposed for clearing the in-process cache between
   * test runs. Not used by any production code path.
   */
  clearCache(): void {
    this.cache.clear();
  }

  // -----------------------------------------------------------------------

  private async resolve(
    make: string,
    model: string,
  ): Promise<EligibilityCheckResponse> {
    // 1) Hardcoded exclusion list
    const hardcodedReason = this.checkHardcodedList(make, model);
    if (hardcodedReason) {
      return { eligible: false, reason: hardcodedReason };
    }

    // 2) OpenAI fallback (if configured)
    if (!this.openai.isConfigured()) {
      return { eligible: true, reason: null };
    }

    const aiAnswer = await this.askOpenAI(make, model);
    if (aiAnswer === null) {
      // Error or missing key — fail open
      return { eligible: true, reason: null };
    }
    return aiAnswer;
  }

  private checkHardcodedList(make: string, model: string): string | null {
    const makeLower = make.toLowerCase().trim();

    // Brand match
    for (const brand of BONZAH_RESTRICTED_BRANDS) {
      if (makeLower.includes(brand.toLowerCase())) {
        return `${brand} vehicles are not eligible for Bonzah coverage`;
      }
    }

    // Brand + model pattern match
    for (const { brand, model: pattern } of BONZAH_RESTRICTED_MODEL_PATTERNS) {
      if (brand.test(make) && pattern.test(model)) {
        return `${make} ${model} is not eligible (restricted model variant)`;
      }
    }

    return null;
  }

  private async askOpenAI(
    make: string,
    model: string,
  ): Promise<EligibilityCheckResponse | null> {
    const prompt = [
      {
        role: 'system' as const,
        content:
          'You check if a vehicle qualifies for standard rental-car insurance. ' +
          'High-end exotics (Ferrari, Lamborghini, etc.), high-performance variants ' +
          '(AMG, M-series, RS, R), and cars classed as supercars are NOT eligible. ' +
          'Respond with ONLY: "ELIGIBLE" or "INELIGIBLE:<short reason>".',
      },
      {
        role: 'user' as const,
        content: `Vehicle: ${make} ${model}`,
      },
    ];

    const reply = await this.openai.chat({
      model: OPENAI_MODEL_ELIGIBILITY,
      messages: prompt,
      temperature: OPENAI_TEMPERATURE_DETERMINISTIC,
      maxTokens: OPENAI_MAX_TOKENS_ELIGIBILITY,
    });

    if (!reply) return null;

    const upper = reply.toUpperCase();
    if (upper.startsWith('ELIGIBLE')) {
      return { eligible: true, reason: null };
    }
    if (upper.startsWith('INELIGIBLE')) {
      const reason = reply.split(':').slice(1).join(':').trim() || 'Restricted vehicle';
      return { eligible: false, reason };
    }
    this.logger.warn(`OpenAI eligibility response unrecognized: ${reply}`);
    return null;
  }

  private cacheKey(tenantId: string, make: string, model: string): string {
    return `${tenantId}::${make.toLowerCase().trim()}::${model.toLowerCase().trim()}`;
  }
}

