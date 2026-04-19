import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import {
  bonzahInsurancePolicies,
  rentals,
} from '@drive247/database';
import {
  BonzahPolicyStatus,
  InsuranceStatus,
  REMINDER_RULE_CODES,
  ReminderSeverity,
  type BonzahPolicyResponse,
  type ConfirmPaymentResponse,
  type RetryPendingResponse,
} from '@drive247/shared-types';
import { DATABASE } from '../../database/database.module';
import type { Database } from '../../database/db';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { BonzahApiClient } from '../../integrations/bonzah/bonzah-api.client';
import { BONZAH_PATHS } from '../../integrations/bonzah/constants';
import {
  BonzahApiError,
  BonzahInsufficientBalanceError,
} from '../../integrations/bonzah/errors';
import type { BonzahPaymentData } from '../../integrations/bonzah/types';
import { BonzahPolicyService } from './bonzah-policy.service';
import { RemindersService } from '../reminders/reminders.service';

type PolicyRow = typeof bonzahInsurancePolicies.$inferSelect;

/**
 * Payment confirmation & retry.
 *
 * - `confirmChain(chainId)` — processes every chunk in a chain in sequence.
 *   Aggregates result: anyFailed flag lets the UI show partial state.
 * - `retryPending()` — sweeps all insufficient_balance policies for the
 *   tenant and reattempts payment.
 *
 * Balance errors are caught specifically (via the typed
 * BonzahInsufficientBalanceError raised by BonzahApiClient). A reminder
 * is emitted so the tenant gets a UI alert; the policy is marked
 * `insufficient_balance` (retryable) rather than `failed` (terminal).
 */
@Injectable()
export class BonzahPaymentService {
  private readonly logger = new Logger(BonzahPaymentService.name);

  constructor(
    @Inject(DATABASE) private db: Database,
    private readonly ctx: TenantContextService,
    private readonly apiClient: BonzahApiClient,
    private readonly policyService: BonzahPolicyService,
    private readonly remindersService: RemindersService,
  ) {}

  async confirmChain(chainId: string): Promise<ConfirmPaymentResponse> {
    const tenantId = this.ctx.requireTenantId();

    const chunks = await this.loadChainChunks(tenantId, chainId);
    if (chunks.length === 0) {
      throw new NotFoundException('Bonzah policy chain not found');
    }

    let succeeded = 0;
    let anyFailed = false;

    for (const chunk of chunks) {
      if (chunk.status === BonzahPolicyStatus.ACTIVE) {
        succeeded++;
        continue; // already confirmed
      }
      const ok = await this.confirmSingle(tenantId, chunk);
      if (ok) succeeded++;
      else anyFailed = true;
    }

    await this.syncRentalInsuranceStatus(tenantId, chunks[0].rentalId);

    const refreshed = await this.policyService.list({ chainId });
    return {
      chainId,
      totalConfirmed: succeeded,
      totalPolicies: chunks.length,
      policies: refreshed,
      anyFailed,
    };
  }

  async retryPending(): Promise<RetryPendingResponse> {
    const tenantId = this.ctx.requireTenantId();

    const pending = await this.db
      .select()
      .from(bonzahInsurancePolicies)
      .where(
        and(
          eq(bonzahInsurancePolicies.tenantId, tenantId),
          eq(
            bonzahInsurancePolicies.status,
            BonzahPolicyStatus.INSUFFICIENT_BALANCE,
          ),
        ),
      )
      .orderBy(
        asc(bonzahInsurancePolicies.chainId),
        asc(bonzahInsurancePolicies.chainSequence),
      );

    let attempted = 0;
    let succeededCount = 0;
    let failedCount = 0;
    let stillPending = 0;
    const touchedRentals = new Set<string>();

    for (const chunk of pending) {
      attempted++;
      const ok = await this.confirmSingle(tenantId, chunk);
      if (ok) succeededCount++;
      else {
        // Re-read to see what state it landed in
        const [refreshed] = await this.db
          .select({ status: bonzahInsurancePolicies.status })
          .from(bonzahInsurancePolicies)
          .where(eq(bonzahInsurancePolicies.id, chunk.id))
          .limit(1);
        if (refreshed?.status === BonzahPolicyStatus.INSUFFICIENT_BALANCE) {
          stillPending++;
        } else {
          failedCount++;
        }
      }
      touchedRentals.add(chunk.rentalId);
    }

    for (const rentalId of touchedRentals) {
      await this.syncRentalInsuranceStatus(tenantId, rentalId);
    }

    return {
      attempted,
      succeeded: succeededCount,
      failed: failedCount,
      stillPending,
    };
  }

  // -----------------------------------------------------------------------

  private async loadChainChunks(
    tenantId: string,
    chainId: string,
  ): Promise<PolicyRow[]> {
    return this.db
      .select()
      .from(bonzahInsurancePolicies)
      .where(
        and(
          eq(bonzahInsurancePolicies.tenantId, tenantId),
          eq(bonzahInsurancePolicies.chainId, chainId),
        ),
      )
      .orderBy(asc(bonzahInsurancePolicies.chainSequence));
  }

  /**
   * Attempt payment for a single chunk. Returns true on success.
   * On typed insufficient-balance error: emits a reminder + marks
   * `insufficient_balance`. On any other error: marks `failed`.
   */
  private async confirmSingle(
    tenantId: string,
    chunk: PolicyRow,
  ): Promise<boolean> {
    if (!chunk.paymentId) {
      await this.markFailed(tenantId, chunk.id, 'Missing Bonzah payment_id');
      return false;
    }

    await this.updateStatus(
      tenantId,
      chunk.id,
      BonzahPolicyStatus.PAYMENT_PENDING,
      null,
    );

    try {
      const data = await this.apiClient.call<BonzahPaymentData>(
        tenantId,
        'POST',
        BONZAH_PATHS.PAYMENT,
        {
          payment_id: chunk.paymentId,
          amount: Number(chunk.premiumAmount),
        },
      );

      const coverage = chunk.coverage as Record<string, unknown>;
      const nextCoverage = {
        ...coverage,
        pdf_ids: {
          ...(coverage.pdf_ids as Record<string, number> | undefined),
          cdw: data.cdw_pdf_id ?? (coverage.pdf_ids as any)?.cdw,
          rcli: data.rcli_pdf_id ?? (coverage.pdf_ids as any)?.rcli,
          sli: data.sli_pdf_id ?? (coverage.pdf_ids as any)?.sli,
          pai: data.pai_pdf_id ?? (coverage.pdf_ids as any)?.pai,
        },
      };

      await this.db
        .update(bonzahInsurancePolicies)
        .set({
          status: BonzahPolicyStatus.ACTIVE,
          policyId: data.policy_id ?? chunk.policyId,
          policyNo: data.policy_no ?? chunk.policyNo,
          coverage: nextCoverage,
          policyIssuedAt: new Date(),
          lastError: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(bonzahInsurancePolicies.id, chunk.id),
            eq(bonzahInsurancePolicies.tenantId, tenantId),
          ),
        );
      return true;
    } catch (err) {
      if (err instanceof BonzahInsufficientBalanceError) {
        await this.updateStatus(
          tenantId,
          chunk.id,
          BonzahPolicyStatus.INSUFFICIENT_BALANCE,
          err.message,
        );
        await this.emitInsufficientBalanceReminder(tenantId, err.message);
        return false;
      }

      const msg =
        err instanceof BonzahApiError
          ? err.message
          : (err as Error).message ?? 'Unknown Bonzah error';
      this.logger.error(
        `Payment confirmation failed for policy ${chunk.id}: ${msg}`,
      );
      await this.markFailed(tenantId, chunk.id, msg);
      return false;
    }
  }

  private async updateStatus(
    tenantId: string,
    id: string,
    status: BonzahPolicyStatus,
    lastError: string | null,
  ) {
    await this.db
      .update(bonzahInsurancePolicies)
      .set({ status, lastError, updatedAt: new Date() })
      .where(
        and(
          eq(bonzahInsurancePolicies.id, id),
          eq(bonzahInsurancePolicies.tenantId, tenantId),
        ),
      );
  }

  private async markFailed(tenantId: string, id: string, reason: string) {
    await this.updateStatus(
      tenantId,
      id,
      BonzahPolicyStatus.FAILED,
      reason,
    );
  }

  /**
   * Keep rentals.insurance_status in sync with the chain's aggregate state:
   *   - All chunks active          → 'bonzah'
   *   - Any chunk insufficient/failed/pending → 'pending'
   *   - No chunks at all           → 'pending'
   */
  private async syncRentalInsuranceStatus(
    tenantId: string,
    rentalId: string,
  ) {
    const chunks = await this.db
      .select({ status: bonzahInsurancePolicies.status })
      .from(bonzahInsurancePolicies)
      .where(
        and(
          eq(bonzahInsurancePolicies.tenantId, tenantId),
          eq(bonzahInsurancePolicies.rentalId, rentalId),
        ),
      );

    const allActive =
      chunks.length > 0 &&
      chunks.every((c) => c.status === BonzahPolicyStatus.ACTIVE);

    await this.db
      .update(rentals)
      .set({
        insuranceStatus: allActive
          ? InsuranceStatus.BONZAH
          : InsuranceStatus.PENDING,
        updatedAt: new Date(),
      })
      .where(and(eq(rentals.id, rentalId), eq(rentals.tenantId, tenantId)));
  }

  private async emitInsufficientBalanceReminder(
    tenantId: string,
    detail: string,
  ) {
    await this.remindersService.upsertByRule(
      tenantId,
      REMINDER_RULE_CODES.BONZAH_LOW_BALANCE,
      {
        objectType: 'Integration',
        title: 'Bonzah balance insufficient',
        message:
          `A policy payment could not be processed because your Bonzah balance is too low. ` +
          `Top up your Bonzah account and click "Retry pending" in Settings → Bonzah. ` +
          `(Detail: ${detail})`,
        severity: ReminderSeverity.CRITICAL,
        context: { detail },
      },
    );
  }
}

// silence unused-type-import in strict mode
void (null as BonzahPolicyResponse | null);
