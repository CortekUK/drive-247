import { Injectable } from '@nestjs/common';
import type {
  CalculatePremiumResponse,
  CoverageSelection,
} from '@drive247/shared-types';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { BonzahApiClient } from '../../integrations/bonzah/bonzah-api.client';
import { BONZAH_PATHS, BONZAH_REQUEST_SOURCE } from '../../integrations/bonzah/constants';
import { formatBonzahDate } from '../../integrations/bonzah/utils/date.util';
import { stateCodeToBonzahName } from '../../integrations/bonzah/utils/us-states.util';
import type {
  BonzahPremiumCalcRequest,
  BonzahPremiumCalcData,
} from '../../integrations/bonzah/types';
import type { CalculatePremiumDto } from './dto/calculate-premium.dto';

/**
 * Premium calculation — stateless read-only wrapper around Bonzah's
 * `/premiumCalc` endpoint. No DB writes.
 *
 * Bonzah returns `total_premium` and per-tier rates; we aggregate into the
 * clean `CalculatePremiumResponse` shape consumed by the frontend.
 */
@Injectable()
export class BonzahPremiumService {
  constructor(
    private readonly apiClient: BonzahApiClient,
    private readonly ctx: TenantContextService,
  ) {}

  async calculate(input: CalculatePremiumDto): Promise<CalculatePremiumResponse> {
    const tenantId = this.ctx.requireTenantId();

    const request: BonzahPremiumCalcRequest = {
      trip_start_date: formatBonzahDate(input.tripStartDate),
      trip_end_date: formatBonzahDate(input.tripEndDate),
      pickup_country: 'United States',
      pickup_state: stateCodeToBonzahName(input.pickupState),
      drop_off_time: 'Same',
      cdw_cover: input.coverage.cdw,
      rcli_cover: input.coverage.rcli,
      sli_cover: input.coverage.sli,
      pai_cover: input.coverage.pai,
      skip_validation: true,
    };

    const data = await this.apiClient.call<BonzahPremiumCalcData>(
      tenantId,
      'POST',
      BONZAH_PATHS.PREMIUM_CALC,
      { ...request, source: BONZAH_REQUEST_SOURCE },
    );

    const days = this.computeDays(input.tripStartDate, input.tripEndDate);
    const breakdown = this.extractBreakdown(data, input.coverage, days);

    // Prefer Bonzah's total when present; otherwise sum the breakdown.
    // With skip_validation=true, Bonzah sometimes omits `total_premium` —
    // the per-tier rates are always present so the sum is always reliable.
    const reported = Number(data.total_premium ?? 0);
    const summed =
      breakdown.cdw + breakdown.rcli + breakdown.sli + breakdown.pai;
    const totalPremium = reported > 0 ? reported : summed;

    return {
      totalPremium,
      currency: 'USD',
      days,
      breakdown,
    };
  }

  private computeDays(start: Date, end: Date): number {
    const ms = end.getTime() - start.getTime();
    return Math.max(1, Math.ceil(ms / (24 * 60 * 60 * 1000)));
  }

  private extractBreakdown(
    data: BonzahPremiumCalcData,
    coverage: CoverageSelection,
    days: number,
  ) {
    return {
      cdw: coverage.cdw ? parseRateToTotal(data.cdw_rate, days) : 0,
      rcli: coverage.rcli ? parseRateToTotal(data.rcli_rate, days) : 0,
      sli: coverage.sli ? parseRateToTotal(data.sli_rate, days) : 0,
      pai: coverage.pai ? parseRateToTotal(data.pai_rate, days) : 0,
    };
  }
}

/**
 * Bonzah returns rates like `"$21.95 / 24 hours"`. Multiply by days for the tier total.
 */
function parseRateToTotal(rate: string | undefined, days: number): number {
  if (!rate) return 0;
  const match = rate.match(/\$?([0-9]+(?:\.[0-9]+)?)/);
  if (!match) return 0;
  return Number(match[1]) * days;
}
