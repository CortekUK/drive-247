/**
 * The PGlite store: PlanStore & PlanOperations & PlanLookups & LedgerFixture &
 * ClockedStore, implemented by calling the pp_* SQL functions of
 * supabase/migrations/20260925120100_payment_plans.sql on real Postgres, with
 * the LIVE FIFO trigger doing the money allocation.
 *
 * It maps rows and nothing else: every rule lives in the SQL. It is what the
 * Supabase store (payment-plans-deno) does over PostgREST, minus the network.
 *
 * Clock: setNow() is synchronous (the engine calls it without awaiting), so
 * the instant is held here and applied to every call with
 * set_config('pp_test.now', …, is_local = true) inside that call's own
 * transaction. pp_clock() reads it (harness-only override).
 */
import type {
  AttemptRow,
  ClaimResult,
  ClockedStore,
  CollectionMethod,
  ISODate,
  LedgerFixture,
  OccurrenceDraft,
  OccurrenceRow,
  PlanEvent,
  PlanLookups,
  PlanOperations,
  PlanRow,
  PlanStore,
  RecordFailureInput,
  RecordSuccessInput,
} from "@fn/_shared/payment-plans/types.ts";
import { PlanStoreError } from "@fn/_shared/payment-plans/errors.ts";
import { toCents, type Db } from "./pglite";

type Row = Record<string, any>;

export function occFromRow(r: Row): OccurrenceRow {
  return {
    id: r.id,
    planId: r.plan_id,
    tenantId: r.tenant_id,
    rentalId: r.rental_id,
    seq: r.seq,
    planVersion: r.plan_version,
    dueDate: r.due_date,
    dueAt: r.due_at,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    amountCents: toCents(r.amount),
    amountPaidCents: toCents(r.amount_paid),
    collectionMethod: r.collection_method,
    status: r.status,
    attemptNo: r.attempt_no,
    nextAttemptAt: r.next_attempt_at,
    movedFrom: r.moved_from,
    paidAt: r.paid_at,
    note: r.note,
  };
}

export function attemptFromRow(r: Row): AttemptRow {
  return {
    id: r.id,
    occurrenceId: r.occurrence_id,
    attemptNo: r.attempt_no,
    method: r.method,
    idempotencyKey: r.idempotency_key,
    status: r.status,
    provider: r.provider,
    providerAccount: r.provider_account,
    providerMode: r.provider_mode,
    providerRef: r.provider_ref,
    paymentId: r.payment_id,
    amountCents: toCents(r.amount),
    declineCode: r.decline_code,
    errorCode: r.error_code,
    errorMessage: r.error_message,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
    checkoutSessionId: r.checkout_session_id,
  };
}

/** A Postgres error → the PlanStoreError the memory store throws for the same refusal. */
function mapError(e: any): Error {
  const msg: string = e?.message ?? String(e);
  const code: string | undefined = e?.code;
  if (code === "23505" && /ux_payment_plans_one_live_per_rental/.test(msg + (e?.constraint ?? ""))) return new PlanStoreError("plan_exists", msg);
  if (code === "40001") return new PlanStoreError("version_conflict", msg);
  if (/illegal transition/.test(msg)) return new PlanStoreError("illegal_transition", msg);
  if (code === "P0002") return new PlanStoreError("not_found", msg);
  if (code === "55000" && /charge in flight|open attempt/.test(msg)) return new PlanStoreError("attempt_in_flight", msg);
  if (code === "55000") return new PlanStoreError("refused", msg);
  if (code === "22023" || code === "22P02" || code === "23514" || code === "42501") return new PlanStoreError("invalid_input", msg);
  return e instanceof Error ? e : new Error(msg);
}

export class PglitePlanStore implements PlanStore, PlanOperations, PlanLookups, LedgerFixture, ClockedStore {
  private clock = "2026-01-01T00:00:00.000Z";
  constructor(readonly db: Db) {}

  setNow(asOf: string): void {
    if (!Number.isFinite(Date.parse(asOf))) throw new RangeError(`setNow: not an instant: ${asOf}`);
    this.clock = new Date(asOf).toISOString();
  }
  now(): string {
    return this.clock;
  }

  /** One statement, in its own transaction, at the store's clock. */
  private async call<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    try {
      return await this.db.pg.transaction(async (tx) => {
        await tx.query(`SELECT set_config('pp_test.now', $1, true)`, [this.clock]);
        return (await tx.query<T>(sql, params as any[])).rows;
      });
    } catch (e) {
      throw mapError(e);
    }
  }

  // ── PlanStore ─────────────────────────────────────────────────────────────

  async collectDue(asOf: string, filter?: { tenantId?: string; planId?: string }): Promise<OccurrenceRow[]> {
    const rows = await this.call(`SELECT * FROM pp_collect_due($1, $2, $3)`, [asOf, filter?.tenantId ?? null, filter?.planId ?? null]);
    return rows.map(occFromRow);
  }

  async getPlan(planId: string): Promise<PlanRow | null> {
    const [r] = await this.call<{ p: PlanRow | null }>(`SELECT pp_get_plan($1) p`, [planId]);
    return r?.p ?? null;
  }

  async claim(occurrenceId: string, method: CollectionMethod, providerAccount: string | null): Promise<ClaimResult> {
    const [r] = await this.call<{ r: ClaimResult }>(`SELECT pp_claim($1, $2, $3) r`, [occurrenceId, method, providerAccount]);
    return r.r;
  }

  async markInFlight(attemptId: string): Promise<void> {
    await this.call(`SELECT pp_mark_in_flight($1)`, [attemptId]);
  }

  async recordSuccess(input: RecordSuccessInput): Promise<{ paymentId: string }> {
    const [r] = await this.call<{ id: string }>(`SELECT pp_record_success($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) id`, [
      input.attemptId,
      input.amountCents,
      input.providerRef,
      input.providerAccount,
      input.providerMode,
      input.paymentProvider,
      input.platformAccount,
      input.paymentDate,
      input.method,
      input.checkoutSessionId ?? null,
      input.note ?? null,
      input.actorId ?? null,
    ]);
    return { paymentId: r.id };
  }

  async recordFailure(input: RecordFailureInput): Promise<void> {
    await this.call(`SELECT pp_record_failure($1,$2,$3,$4,$5,$6,$7)`, [
      input.attemptId,
      input.status,
      input.providerRef ?? null,
      input.declineCode ?? null,
      input.errorCode ?? null,
      input.errorMessage ?? null,
      input.nextAttemptAt ?? null,
    ]);
  }

  async settleOccurrence(occurrenceId: string): Promise<OccurrenceRow> {
    const [r] = await this.call(`SELECT (pp_settle_occurrence($1)).*`, [occurrenceId]);
    return occFromRow(r);
  }

  async staleAttempts(olderThanSeconds: number, asOf: string): Promise<AttemptRow[]> {
    return (await this.call(`SELECT * FROM pp_stale_attempts($1, $2)`, [olderThanSeconds, asOf])).map(attemptFromRow);
  }

  async recordEvent(event: PlanEvent): Promise<boolean> {
    const payload: Record<string, unknown> = { planId: event.planId, kind: event.kind };
    if (event.occurrenceId != null) payload.occurrenceId = event.occurrenceId;
    if (event.dedupeKey != null) payload.dedupeKey = event.dedupeKey;
    if (event.channel != null) payload.channel = event.channel;
    if (event.amountCents != null) payload.amountCents = event.amountCents;
    if (event.detail != null) payload.detail = event.detail;
    if (event.actorId != null) payload.actorId = event.actorId;
    const [r] = await this.call<{ ok: boolean }>(`SELECT pp_record_event($1::jsonb) ok`, [JSON.stringify(payload)]);
    return r.ok;
  }

  // ── PlanLookups ───────────────────────────────────────────────────────────

  async getOccurrence(occurrenceId: string): Promise<OccurrenceRow | null> {
    const [r] = await this.call(`SELECT * FROM payment_plan_occurrences WHERE id = $1`, [occurrenceId]);
    return r ? occFromRow(r) : null;
  }

  async getAttempt(attemptId: string): Promise<AttemptRow | null> {
    const [r] = await this.call(`SELECT * FROM payment_plan_attempts WHERE id = $1`, [attemptId]);
    return r ? attemptFromRow(r) : null;
  }

  // ── PlanOperations ────────────────────────────────────────────────────────

  async createPlan(input: { plan: Omit<PlanRow, "id" | "version" | "status">; occurrences: OccurrenceDraft[]; actorId?: string | null }): Promise<string> {
    const [r] = await this.call<{ id: string }>(`SELECT pp_create_plan($1::jsonb, $2::jsonb, $3) id`, [
      JSON.stringify(input.plan),
      JSON.stringify(input.occurrences),
      input.actorId ?? null,
    ]);
    return r.id;
  }

  async replaceFuture(input: {
    planId: string;
    expectedVersion: number;
    planPatch: Partial<Omit<PlanRow, "id" | "tenantId" | "rentalId" | "customerId" | "version">>;
    occurrences: OccurrenceDraft[];
    actorId?: string | null;
    reason: string;
  }): Promise<number> {
    const [r] = await this.call<{ v: number }>(`SELECT pp_replace_future($1, $2, $3::jsonb, $4::jsonb, $5, $6) v`, [
      input.planId,
      input.expectedVersion,
      JSON.stringify(input.planPatch ?? {}),
      JSON.stringify(input.occurrences),
      input.actorId ?? null,
      input.reason,
    ]);
    return r.v;
  }

  async pausePlan(planId: string, actorId?: string | null, reason?: string): Promise<void> {
    await this.call(`SELECT pp_pause_plan($1, $2, $3)`, [planId, actorId ?? null, reason ?? null]);
  }
  async resumePlan(planId: string, actorId?: string | null): Promise<void> {
    await this.call(`SELECT pp_resume_plan($1, $2, NULL)`, [planId, actorId ?? null]);
  }
  async cancelPlan(planId: string, actorId?: string | null, reason?: string): Promise<void> {
    await this.call(`SELECT pp_cancel_plan($1, $2, $3)`, [planId, actorId ?? null, reason ?? null]);
  }
  async moveOccurrence(occurrenceId: string, to: ISODate, actorId?: string | null): Promise<void> {
    await this.call(`SELECT pp_move_occurrence($1, $2, $3)`, [occurrenceId, to, actorId ?? null]);
  }
  async skipOccurrence(occurrenceId: string, actorId?: string | null): Promise<void> {
    await this.call(`SELECT pp_skip_occurrence($1, $2)`, [occurrenceId, actorId ?? null]);
  }
  async setMethod(occurrenceId: string, method: CollectionMethod, actorId?: string | null): Promise<void> {
    await this.call(`SELECT pp_set_method($1, $2, $3)`, [occurrenceId, method, actorId ?? null]);
  }
  async setLinkToken(occurrenceId: string, tokenHash: string): Promise<void> {
    await this.call(`SELECT pp_set_link_token($1, $2)`, [occurrenceId, tokenHash]);
  }
  async setPaymentMethod(planId: string, paymentMethodId: string): Promise<void> {
    await this.call(`SELECT pp_set_payment_method($1, $2)`, [planId, paymentMethodId]);
  }

  async listOccurrences(planId: string): Promise<OccurrenceRow[]> {
    return (await this.call(`SELECT * FROM payment_plan_occurrences WHERE plan_id = $1 ORDER BY seq`, [planId])).map(occFromRow);
  }

  async listAttempts(filter: { planId?: string; occurrenceId?: string }): Promise<AttemptRow[]> {
    const rows = await this.call(
      `SELECT a.* FROM payment_plan_attempts a JOIN payment_plan_occurrences o ON o.id = a.occurrence_id
        WHERE ($1::uuid IS NULL OR o.plan_id = $1) AND ($2::uuid IS NULL OR a.occurrence_id = $2)
        ORDER BY a.created_at, o.seq, a.attempt_no`,
      [filter.planId ?? null, filter.occurrenceId ?? null],
    );
    return rows.map(attemptFromRow);
  }

  async listEvents(planId: string): Promise<(PlanEvent & { id: string; createdAt: string })[]> {
    const rows = await this.call(
      `SELECT e.* FROM payment_plan_events e WHERE plan_id = $1 ORDER BY created_at, ctid`,
      [planId],
    );
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      planId: r.plan_id,
      occurrenceId: r.occurrence_id,
      kind: r.kind,
      dedupeKey: r.dedupe_key,
      channel: r.channel,
      amountCents: r.amount == null ? null : toCents(r.amount),
      detail: r.detail,
      actorId: r.actor_id,
    }));
  }

  async listForReminders(asOf: string, horizonDays: number, filter?: { tenantId?: string; planId?: string }): Promise<OccurrenceRow[]> {
    const rows = await this.call(`SELECT * FROM pp_list_for_reminders($1, $2, $3, $4)`, [asOf, horizonDays, filter?.tenantId ?? null, filter?.planId ?? null]);
    return rows.map(occFromRow);
  }

  async rentalOwedCents(rentalId: string): Promise<number> {
    const [r] = await this.call<{ n: number }>(`SELECT pp_rental_owed_cents($1)::bigint n`, [rentalId]);
    return Number(r.n);
  }

  // ── LedgerFixture: real payments / ledger rows ────────────────────────────

  /** An ordinary captured payment (status 'Completed' → the live FIFO trigger applies it). */
  async recordExternalPayment(rentalId: string, amountCents: number, paymentDate: ISODate): Promise<string> {
    const [r] = await this.call<{ id: string }>(
      `INSERT INTO payments (customer_id, rental_id, vehicle_id, tenant_id, amount, remaining_amount, payment_date, method,
                             payment_type, status, booking_source)
       SELECT customer_id, id, vehicle_id, tenant_id, $2::numeric / 100, $2::numeric / 100, $3, 'External', 'Payment', 'Completed', 'admin'
         FROM rentals WHERE id = $1
       RETURNING id`,
      [rentalId, amountCents, paymentDate],
    );
    if (!r) throw new PlanStoreError("not_found", `Rental ${rentalId} not found`);
    return r.id;
  }

  /**
   * What process-refund writes (supabase/functions/process-refund): the
   * payment's refund_amount and status ('Refunded' / 'Partial Refund'), and a
   * negative 'Refund' ledger row with remaining_amount 0. It does NOT reopen
   * the charge. The linked occurrence is re-settled by the payments trigger
   * (D12), not by this fixture.
   */
  async refundPayment(paymentId: string, amountCents: number): Promise<void> {
    const [p] = await this.call<{ amount: string; refunded: string; occ: string | null }>(
      `SELECT amount, COALESCE(refund_amount, 0) refunded, payment_plan_occurrence_id occ FROM payments WHERE id = $1`,
      [paymentId],
    );
    if (!p) throw new PlanStoreError("not_found", `Payment ${paymentId} not found`);
    const refunded = toCents(p.refunded);
    if (!Number.isSafeInteger(amountCents) || amountCents < 1 || refunded + amountCents > toCents(p.amount)) {
      throw new PlanStoreError("invalid_input", "Refund must be ≥ 1 cent and no more than what is left of the payment");
    }
    const total = refunded + amountCents;
    await this.call(
      `WITH upd AS (
         UPDATE payments
            SET refund_amount = $2::numeric / 100,
                status = CASE WHEN $2::bigint >= $3::bigint THEN 'Refunded' ELSE 'Partial Refund' END,
                refund_processed_at = pp_clock()
          WHERE id = $1
         RETURNING id, rental_id, customer_id, vehicle_id, tenant_id)
       INSERT INTO ledger_entries (customer_id, rental_id, vehicle_id, tenant_id, entry_date, due_date, type, category,
                                   amount, remaining_amount, reference)
       SELECT customer_id, rental_id, vehicle_id, tenant_id, (pp_clock() AT TIME ZONE 'UTC')::date,
              (pp_clock() AT TIME ZONE 'UTC')::date, 'Refund', 'Rental', -($4::numeric / 100), 0,
              'Refund: ' || id || ' @ ' || pp_clock()
         FROM upd`,
      [paymentId, total, toCents(p.amount), amountCents],
    );
    // No explicit settle: the payments trigger (pp_payment_settles_occurrence)
    // re-settles the occurrence, exactly as it does for the webhook's UPDATE.
  }
}
