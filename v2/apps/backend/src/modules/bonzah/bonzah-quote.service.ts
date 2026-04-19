import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import {
  bonzahInsurancePolicies,
  customers,
  rentals,
} from '@drive247/database';
import {
  BONZAH_MIN_DRIVER_AGE,
  BonzahPolicyStatus,
  InsuranceStatus,
  type CreateQuoteResponse,
} from '@drive247/shared-types';
import { DATABASE } from '../../database/database.module';
import type { Database } from '../../database/db';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { BonzahApiClient } from '../../integrations/bonzah/bonzah-api.client';
import { BonzahCredentialsService } from '../../integrations/bonzah/bonzah-credentials.service';
import {
  BONZAH_PATHS,
  BONZAH_REQUEST_SOURCE,
} from '../../integrations/bonzah/constants';
import { chunkDateRange } from '../../integrations/bonzah/utils/chunk.util';
import {
  ageInYearsAt,
  formatBonzahDate,
  formatBonzahDateTime,
} from '../../integrations/bonzah/utils/date.util';
import { stateCodeToBonzahName } from '../../integrations/bonzah/utils/us-states.util';
import {
  BonzahApiError,
  BonzahInsufficientBalanceError,
  BonzahNotConfiguredError,
} from '../../integrations/bonzah/errors';
import type {
  BonzahQuoteData,
  BonzahQuoteRequest,
} from '../../integrations/bonzah/types';
import type { CreateQuoteDto } from './dto/create-quote.dto';
import { BonzahPolicyService } from './bonzah-policy.service';

/**
 * Quote creation.
 *
 * Responsibilities:
 *   1. Cross-entity validation: rental belongs to tenant, customer belongs
 *      to tenant, age at trip start ≥ 21 (rule #4)
 *   2. Chunking: split trip > 30 days into Bonzah-max-length chunks
 *   3. Call Bonzah /quote with finalize=1 for each chunk in order
 *   4. Persist all chunks in a DB transaction with a shared `chain_id`
 *   5. Update the rental's `insurance_premium` (sum) and
 *      `insurance_status = 'pending'` (because payment hasn't happened yet)
 *
 * NOT responsible for: payment confirmation. That's a separate service.
 */
@Injectable()
export class BonzahQuoteService {
  private readonly logger = new Logger(BonzahQuoteService.name);

  constructor(
    @Inject(DATABASE) private db: Database,
    private readonly ctx: TenantContextService,
    private readonly apiClient: BonzahApiClient,
    private readonly credentialsService: BonzahCredentialsService,
    private readonly policyService: BonzahPolicyService,
  ) {}

  async createQuote(input: CreateQuoteDto): Promise<CreateQuoteResponse> {
    const tenantId = this.ctx.requireTenantId();

    const rental = await this.loadRental(tenantId, input.rentalId);
    await this.assertCustomerBelongsToTenant(tenantId, rental.customerId);

    // Rule #4 — age at trip_start_date
    const tripStart = new Date(`${rental.startDate}T00:00:00Z`);
    const tripEnd = new Date(`${rental.endDate}T23:59:59Z`);
    const age = ageInYearsAt(input.renter.dob, tripStart);
    if (age < BONZAH_MIN_DRIVER_AGE) {
      throw new BadRequestException(
        `Driver must be at least ${BONZAH_MIN_DRIVER_AGE} at trip start (age on ${rental.startDate}: ${age})`,
      );
    }

    // Block re-quoting if an active chain already exists on this rental
    const existing = await this.db
      .select({ id: bonzahInsurancePolicies.id })
      .from(bonzahInsurancePolicies)
      .where(
        and(
          eq(bonzahInsurancePolicies.rentalId, input.rentalId),
          eq(bonzahInsurancePolicies.tenantId, tenantId),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      throw new ConflictException(
        'An insurance quote already exists for this rental',
      );
    }

    const chunks = chunkDateRange(tripStart, tripEnd);
    const chainId = randomUUID();

    // Fetch tenant mode for the snapshot
    const creds = await this.credentialsService.loadForTenant(tenantId);

    // Call Bonzah /quote for each chunk, collecting results
    const issuedChunks: {
      sequence: number;
      start: Date;
      end: Date;
      data: BonzahQuoteData;
    }[] = [];

    try {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const data = await this.callQuoteEndpoint(
          tenantId,
          input,
          chunk.start,
          chunk.end,
        );
        // Bonzah returns HTTP 200 / status=0 even when finalization was
        // rejected. The tell-tale signs: `errors` is populated AND `payment_id`
        // / `quote_no` come back as empty strings. Treat this as a failure.
        const missingFinalizedIds = !data.payment_id || !data.quote_no;
        if (
          (Array.isArray(data.errors) && data.errors.length > 0) ||
          missingFinalizedIds
        ) {
          const messages = (data.errors ?? []).map(formatBonzahError).filter(Boolean);
          throw new BonzahApiError(
            messages.length > 0
              ? `Bonzah could not finalize the quote: ${messages.join('; ')}`
              : 'Bonzah could not finalize the quote (missing payment_id). ' +
                  'Usually caused by an invalid US address or ZIP code.',
            { bonzahText: JSON.stringify(data.errors ?? data) },
          );
        }
        issuedChunks.push({ sequence: i, start: chunk.start, end: chunk.end, data });
      }
    } catch (err) {
      this.logger.error(
        `Quote chain ${chainId} failed after ${issuedChunks.length}/${chunks.length} chunks — ` +
          `Bonzah-side orphans may exist for quote_ids: ${issuedChunks
            .map((c) => c.data.quote_id)
            .join(', ')}`,
      );
      // Map typed Bonzah errors to proper HTTP responses so the frontend
      // sees an actionable message instead of a generic 500.
      if (err instanceof BonzahNotConfiguredError) {
        throw new ConflictException(err.message);
      }
      if (err instanceof BonzahInsufficientBalanceError) {
        throw new ConflictException(err.message);
      }
      if (err instanceof BonzahApiError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    // Persist all chunks + update the rental in a single transaction
    let totalPremium = 0;
    for (const c of issuedChunks) totalPremium += Number(c.data.total_premium ?? 0);

    await this.db.transaction(async (tx) => {
      for (const c of issuedChunks) {
        await tx.insert(bonzahInsurancePolicies).values({
          tenantId,
          rentalId: input.rentalId,
          customerId: rental.customerId,
          chainId,
          chainSequence: c.sequence,
          policyType: 'original',
          mode: creds.mode,
          quoteId: c.data.quote_id,
          quoteNo: c.data.quote_no ?? null,
          paymentId: c.data.payment_id ?? null,
          policyNo: null,
          policyId: null,
          coverage: buildCoveragePayload(input.coverage, c.data),
          tripStartDate: formatDateOnly(c.start),
          tripEndDate: formatDateOnly(c.end),
          pickupState: input.pickupState,
          premiumAmount: String(c.data.total_premium ?? 0),
          renterDetails: input.renter,
          status: BonzahPolicyStatus.QUOTED,
        });
      }

      await tx
        .update(rentals)
        .set({
          insurancePremium: String(totalPremium),
          insuranceStatus: InsuranceStatus.PENDING,
          updatedAt: new Date(),
        })
        .where(
          and(eq(rentals.id, input.rentalId), eq(rentals.tenantId, tenantId)),
        );
    });

    const policies = await this.policyService.list({ chainId });
    return { chainId, totalPremium, policies };
  }

  // -----------------------------------------------------------------------

  private async loadRental(tenantId: string, rentalId: string) {
    const [row] = await this.db
      .select({
        id: rentals.id,
        startDate: rentals.startDate,
        endDate: rentals.endDate,
        customerId: rentals.customerId,
      })
      .from(rentals)
      .where(and(eq(rentals.id, rentalId), eq(rentals.tenantId, tenantId)))
      .limit(1);
    if (!row) throw new NotFoundException('Rental not found');
    return row;
  }

  private async assertCustomerBelongsToTenant(
    tenantId: string,
    customerId: string,
  ) {
    const [row] = await this.db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)))
      .limit(1);
    if (!row) throw new NotFoundException('Customer not found');
  }

  private async callQuoteEndpoint(
    tenantId: string,
    input: CreateQuoteDto,
    start: Date,
    end: Date,
  ): Promise<BonzahQuoteData> {
    const request: BonzahQuoteRequest & { source: string } = {
      trip_start_date: formatBonzahDateTime(start),
      trip_end_date: formatBonzahDateTime(end),
      pickup_country: 'United States',
      // Bonzah expects full state names (per their /master endpoint format)
      pickup_state: stateCodeToBonzahName(input.pickupState),
      drop_off_time: 'Same',
      residence_country: 'United States',
      residence_state: stateCodeToBonzahName(input.renter.address.state),
      cdw_cover: input.coverage.cdw,
      rcli_cover: input.coverage.rcli,
      sli_cover: input.coverage.sli,
      pai_cover: input.coverage.pai,
      first_name: input.renter.firstName,
      last_name: input.renter.lastName,
      dob: formatBonzahDate(input.renter.dob),
      pri_email_address: input.renter.email,
      address_line_1: input.renter.address.street,
      zip_code: input.renter.address.zip,
      phone_no: input.renter.phone,
      license_no: input.renter.license.number,
      // Drivers license state stays as a 2-letter code per Bonzah spec
      drivers_license_state: input.renter.license.state,
      policy_booking_time_zone: 'America/New_York',
      inspection_done: input.coverage.cdw ? 'Rental Agency' : undefined,
      source: BONZAH_REQUEST_SOURCE,
      finalize: 1,
    };

    return this.apiClient.call<BonzahQuoteData>(
      tenantId,
      'POST',
      BONZAH_PATHS.QUOTE,
      request,
    );
  }
}

/**
 * Bonzah's `errors` entries look like `{name: "state", msg: "..."}` — flatten
 * to a readable "field: reason" string so the toast is actionable.
 */
function formatBonzahError(e: { name?: string; msg?: string | string[] }): string {
  const parts: string[] = [];
  if (e.name) parts.push(e.name);
  const msg = Array.isArray(e.msg) ? e.msg.join(', ') : e.msg;
  if (msg) parts.push(msg);
  return parts.join(': ');
}

function buildCoveragePayload(
  coverage: CreateQuoteDto['coverage'],
  data: BonzahQuoteData,
) {
  return {
    ...coverage,
    pdf_ids: {
      cdw: data.cdw_pdf_id,
      rcli: data.rcli_pdf_id,
      sli: data.sli_pdf_id,
      pai: data.pai_pdf_id,
    },
  };
}

function formatDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

