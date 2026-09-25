// Payment plans — the Supabase store: the engine's PlanStore / PlanOperations /
// PlanLookups, implemented by calling the pp_* SQL functions
// (supabase/migrations/20260925120100_payment_plans.sql) with the SERVICE-ROLE
// client. Every write is one of those SECURITY DEFINER functions; the only
// direct table access here is SELECTs (lookups and lists).
//
// supabase-js NEVER THROWS on a database error — it returns `{ error }`. That
// is the bug class behind most of the July 2026 money bugs (a failed write
// read as success). So every call below destructures `error` and THROWS,
// mapped to a PlanStoreError the engine and the manage function understand;
// every call that must return something asserts that it did. The SQL functions
// themselves RAISE on a zero-row write, so "no error" here really means "it
// happened".
//
// Units: the functions take and return INTEGER CENTS in every parameter and
// jsonb key (p_amount_cents, amountCents, …). Only raw table rows
// (pp_collect_due, pp_stale_attempts, lists) carry numeric(12,2) dollars; they
// are converted here, once, with decimalToCents (never `x * 100`).

import {
  type AttemptRow,
  type ClaimResult,
  type CollectionMethod,
  type ISODate,
  type OccurrenceDraft,
  type OccurrenceRow,
  type PlanEvent,
  type PlanLookups,
  type PlanOperations,
  type PlanRow,
  type PlanStore,
  type RecordFailureInput,
  type RecordSuccessInput,
} from "../payment-plans/types.ts";
import { PlanStoreError, type PlanStoreErrorCode } from "../payment-plans/errors.ts";
import { decimalToCents } from "../payment-plans/amounts.ts";
import { dueAtUtc } from "../payment-plans/dates.ts";

/** The narrowest client shape used: the real supabase-js client and a test fake both fit. */
export interface PlanDbClient {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
  // deno-lint-ignore no-explicit-any
  rpc: (name: string, params?: Record<string, unknown>) => any;
}

interface DbError {
  message?: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

/**
 * A PostgREST / Postgres error → PlanStoreError. SQLSTATEs are the ones the
 * pp_* functions raise with (see the migration): P0002 not found, 40001
 * version conflict, 55000 refused-in-this-state, 22023 bad input, 23505 a
 * unique index (one live plan per rental, one attempt in flight), 23514 the
 * state-machine triggers.
 */
export function toStoreError(where: string, error: DbError): PlanStoreError {
  const msg = `${where}: ${error.message ?? "database error"}`;
  const text = `${error.message ?? ""} ${error.details ?? ""}`;
  let code: PlanStoreErrorCode;
  switch (error.code) {
    case "P0002":
      code = "not_found";
      break;
    case "40001":
      code = "version_conflict";
      break;
    case "55000":
      code = /in flight|open attempt/i.test(text) ? "attempt_in_flight" : "refused";
      break;
    case "23505":
      code = /one_live_per_rental/.test(text)
        ? "plan_exists"
        : /one_in_flight/.test(text)
          ? "attempt_in_flight"
          : "invalid_input";
      break;
    case "23514":
      code = /illegal transition/i.test(text) ? "illegal_transition" : "invalid_input";
      break;
    case "22023":
    case "22P02":
    case "22007":
    case "22008":
    case "42501":
      code = "invalid_input";
      break;
    default:
      code = "refused";
  }
  const err = new PlanStoreError(code, msg);
  // Keep the SQLSTATE for logs; never the row data.
  (err as PlanStoreError & { sqlstate?: string }).sqlstate = error.code;
  return err;
}

const iso = (v: unknown): string => new Date(String(v)).toISOString();
const isoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v));
const dateOrNull = (v: unknown): ISODate | null => (v === null || v === undefined ? null : String(v).slice(0, 10));

// deno-lint-ignore no-explicit-any
export function mapOccurrence(r: any): OccurrenceRow {
  return {
    id: r.id,
    planId: r.plan_id,
    tenantId: r.tenant_id,
    rentalId: r.rental_id,
    seq: Number(r.seq),
    planVersion: Number(r.plan_version),
    dueDate: String(r.due_date).slice(0, 10),
    dueAt: iso(r.due_at),
    periodStart: dateOrNull(r.period_start),
    periodEnd: dateOrNull(r.period_end),
    amountCents: decimalToCents(r.amount),
    amountPaidCents: decimalToCents(r.amount_paid),
    collectionMethod: r.collection_method,
    status: r.status,
    attemptNo: Number(r.attempt_no),
    nextAttemptAt: isoOrNull(r.next_attempt_at),
    movedFrom: dateOrNull(r.moved_from),
    paidAt: isoOrNull(r.paid_at),
    note: r.note ?? null,
  };
}

// deno-lint-ignore no-explicit-any
export function mapAttempt(r: any): AttemptRow {
  return {
    id: r.id,
    occurrenceId: r.occurrence_id,
    attemptNo: Number(r.attempt_no),
    method: r.method,
    idempotencyKey: r.idempotency_key,
    status: r.status,
    provider: r.provider,
    providerAccount: r.provider_account ?? null,
    providerMode: r.provider_mode ?? null,
    providerRef: r.provider_ref ?? null,
    paymentId: r.payment_id ?? null,
    amountCents: decimalToCents(r.amount),
    declineCode: r.decline_code ?? null,
    errorCode: r.error_code ?? null,
    errorMessage: r.error_message ?? null,
    createdAt: r.created_at ? iso(r.created_at) : undefined,
    finishedAt: isoOrNull(r.finished_at),
    checkoutSessionId: r.checkout_session_id ?? null,
  };
}

const EVENT_COLUMNS = "id, plan_id, occurrence_id, kind, dedupe_key, channel, amount, detail, actor_id, created_at";

export class SupabasePlanStore implements PlanStore, PlanOperations, PlanLookups {
  constructor(private readonly db: PlanDbClient) {}

  /** Call a pp_* function; throw on error. */
  private async call<T>(fn: string, params: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.db.rpc(fn, params);
    if (error) throw toStoreError(fn, error);
    return data as T;
  }

  /** A setof function: must come back as an array (an error was thrown above otherwise). */
  private async rows<T>(fn: string, params: Record<string, unknown>): Promise<T[]> {
    const data = await this.call<unknown>(fn, params);
    if (data === null || data === undefined) return [];
    if (!Array.isArray(data)) throw new PlanStoreError("refused", `${fn}: expected rows, got ${typeof data}`);
    return data as T[];
  }

  // ── PlanStore ──────────────────────────────────────────────────────────────

  async collectDue(asOf: string, filter?: { tenantId?: string; planId?: string }): Promise<OccurrenceRow[]> {
    return (await this.rows("pp_collect_due", { p_as_of: asOf, p_tenant: filter?.tenantId ?? null, p_plan: filter?.planId ?? null })).map(mapOccurrence);
  }

  async getPlan(planId: string): Promise<PlanRow | null> {
    const data = await this.call<PlanRow | null>("pp_get_plan", { p_plan_id: planId });
    return data ?? null;
  }

  async claim(occurrenceId: string, method: CollectionMethod, providerAccount: string | null): Promise<ClaimResult> {
    const data = await this.call<ClaimResult | null>("pp_claim", {
      p_occurrence_id: occurrenceId,
      p_method: method,
      p_provider_account: providerAccount,
    });
    // pp_claim returns types.ts ClaimResult verbatim. Anything else is a
    // contract break, and guessing what it meant is how money moves wrongly.
    if (!data || typeof data !== "object" || typeof (data as { ok?: unknown }).ok !== "boolean") {
      throw new PlanStoreError("refused", `pp_claim: unexpected result ${JSON.stringify(data)}`);
    }
    if (data.ok) {
      const c = data.claim;
      if (!c?.attemptId || !Number.isInteger(c.attemptNo) || !c.idempotencyKey || !Number.isSafeInteger(Number(c.amountCents)) || Number(c.amountCents) < 1) {
        throw new PlanStoreError("refused", `pp_claim: malformed claim ${JSON.stringify(c)}`);
      }
      return { ok: true, claim: { attemptId: c.attemptId, attemptNo: c.attemptNo, idempotencyKey: c.idempotencyKey, amountCents: Number(c.amountCents) } };
    }
    return data;
  }

  async markInFlight(attemptId: string): Promise<void> {
    await this.call("pp_mark_in_flight", { p_attempt_id: attemptId });
  }

  async recordSuccess(input: RecordSuccessInput): Promise<{ paymentId: string }> {
    const paymentId = await this.call<string | null>("pp_record_success", {
      p_attempt_id: input.attemptId,
      p_amount_cents: input.amountCents,
      p_provider_ref: input.providerRef,
      p_provider_account: input.providerAccount,
      p_provider_mode: input.providerMode,
      p_payment_provider: input.paymentProvider,
      p_platform_account: input.platformAccount,
      p_payment_date: input.paymentDate,
      p_method: input.method,
      p_checkout_session_id: input.checkoutSessionId ?? null,
      // Who recorded a manual payment, and why (design §12a). p_actor is an
      // app_users.id foreign key — payment-plan-manage passes caller.appUserId,
      // never the auth user's id, which would fail the FK and lose the record.
      p_note: input.note ?? null,
      p_actor: input.actorId ?? null,
    });
    if (!paymentId) throw new PlanStoreError("refused", `pp_record_success returned no payment id for attempt ${input.attemptId}`);
    return { paymentId };
  }

  async recordFailure(input: RecordFailureInput): Promise<void> {
    await this.call("pp_record_failure", {
      p_attempt_id: input.attemptId,
      p_status: input.status,
      p_provider_ref: input.providerRef ?? null,
      p_decline_code: input.declineCode ?? null,
      p_error_code: input.errorCode ?? null,
      p_error_message: input.errorMessage ?? null,
      p_next_attempt_at: input.nextAttemptAt ?? null,
    });
  }

  async settleOccurrence(occurrenceId: string): Promise<OccurrenceRow> {
    const row = await this.call<unknown>("pp_settle_occurrence", { p_occurrence_id: occurrenceId });
    const r = Array.isArray(row) ? row[0] : row;
    if (!r) throw new PlanStoreError("not_found", `pp_settle_occurrence returned nothing for ${occurrenceId}`);
    return mapOccurrence(r);
  }

  async staleAttempts(olderThanSeconds: number, asOf: string): Promise<AttemptRow[]> {
    return (await this.rows("pp_stale_attempts", { p_older_than_seconds: olderThanSeconds, p_as_of: asOf })).map(mapAttempt);
  }

  async recordEvent(event: PlanEvent): Promise<boolean> {
    // Only the keys pp_record_event accepts — it RAISES on any other.
    const payload: Record<string, unknown> = { planId: event.planId, kind: event.kind };
    if (event.occurrenceId) payload.occurrenceId = event.occurrenceId;
    if (event.dedupeKey) payload.dedupeKey = event.dedupeKey;
    if (event.channel) payload.channel = event.channel;
    if (event.amountCents !== undefined && event.amountCents !== null) payload.amountCents = event.amountCents;
    if (event.detail) payload.detail = event.detail;
    if (event.actorId) payload.actorId = event.actorId;
    const inserted = await this.call<boolean | null>("pp_record_event", { p_event: payload });
    if (typeof inserted !== "boolean") throw new PlanStoreError("refused", `pp_record_event returned ${JSON.stringify(inserted)}`);
    return inserted;
  }

  // ── PlanLookups (plain SELECTs) ────────────────────────────────────────────

  async getOccurrence(occurrenceId: string): Promise<OccurrenceRow | null> {
    const { data, error } = await this.db.from("payment_plan_occurrences").select("*").eq("id", occurrenceId).maybeSingle();
    if (error) throw toStoreError("getOccurrence", error);
    return data ? mapOccurrence(data) : null;
  }

  async getAttempt(attemptId: string): Promise<AttemptRow | null> {
    const { data, error } = await this.db.from("payment_plan_attempts").select("*").eq("id", attemptId).maybeSingle();
    if (error) throw toStoreError("getAttempt", error);
    return data ? mapAttempt(data) : null;
  }

  /** The occurrence a link token's SHA-256 belongs to (payment-plan-pay). */
  async getOccurrenceByTokenHash(tokenHash: string): Promise<OccurrenceRow | null> {
    const { data, error } = await this.db.from("payment_plan_occurrences").select("*").eq("link_token_hash", tokenHash).maybeSingle();
    if (error) throw toStoreError("getOccurrenceByTokenHash", error);
    return data ? mapOccurrence(data) : null;
  }

  // ── PlanOperations ─────────────────────────────────────────────────────────

  /**
   * Each draft carries the TS-computed dueAt; pp__insert_occurrences checks it
   * against Postgres' own `(date + time) AT TIME ZONE tz` and raises if they
   * differ — so the two clocks can never silently disagree about when a card
   * is charged.
   */
  private draftsWithDueAt(drafts: OccurrenceDraft[], chargeLocalTime: string, timezone: string) {
    return drafts.map((d) => ({ ...d, dueAt: dueAtUtc(d.dueDate, chargeLocalTime, timezone) }));
  }

  async createPlan(input: { plan: Omit<PlanRow, "id" | "version" | "status">; occurrences: OccurrenceDraft[]; actorId?: string | null }): Promise<string> {
    const id = await this.call<string | null>("pp_create_plan", {
      p_plan: input.plan,
      p_occurrences: this.draftsWithDueAt(input.occurrences, input.plan.chargeLocalTime, input.plan.timezone),
      p_actor: input.actorId ?? null,
    });
    if (!id) throw new PlanStoreError("refused", "pp_create_plan returned no plan id");
    return id;
  }

  async replaceFuture(input: {
    planId: string;
    expectedVersion: number;
    planPatch: Partial<Omit<PlanRow, "id" | "tenantId" | "rentalId" | "customerId" | "version">>;
    occurrences: OccurrenceDraft[];
    actorId?: string | null;
    reason: string;
  }): Promise<number> {
    const current = await this.getPlan(input.planId);
    if (!current) throw new PlanStoreError("not_found", `Plan ${input.planId} not found`);
    const time = input.planPatch.chargeLocalTime ?? current.chargeLocalTime;
    const zone = input.planPatch.timezone ?? current.timezone;
    const version = await this.call<number | null>("pp_replace_future", {
      p_plan_id: input.planId,
      p_expected_version: input.expectedVersion,
      p_plan_patch: input.planPatch,
      p_occurrences: this.draftsWithDueAt(input.occurrences, time, zone),
      p_actor: input.actorId ?? null,
      p_reason: input.reason,
    });
    if (!Number.isInteger(Number(version))) throw new PlanStoreError("refused", "pp_replace_future returned no version");
    return Number(version);
  }

  async pausePlan(planId: string, actorId?: string | null, reason?: string): Promise<void> {
    await this.call("pp_pause_plan", { p_plan_id: planId, p_actor: actorId ?? null, p_reason: reason ?? null });
  }

  async resumePlan(planId: string, actorId?: string | null, reason?: string): Promise<void> {
    await this.call("pp_resume_plan", { p_plan_id: planId, p_actor: actorId ?? null, p_reason: reason ?? null });
  }

  async cancelPlan(planId: string, actorId?: string | null, reason?: string): Promise<void> {
    await this.call("pp_cancel_plan", { p_plan_id: planId, p_actor: actorId ?? null, p_reason: reason ?? null });
  }

  async moveOccurrence(occurrenceId: string, to: ISODate, actorId?: string | null): Promise<void> {
    await this.call("pp_move_occurrence", { p_occurrence_id: occurrenceId, p_to: to, p_actor: actorId ?? null });
  }

  async skipOccurrence(occurrenceId: string, actorId?: string | null): Promise<void> {
    await this.call("pp_skip_occurrence", { p_occurrence_id: occurrenceId, p_actor: actorId ?? null });
  }

  async setMethod(occurrenceId: string, method: CollectionMethod, actorId?: string | null): Promise<void> {
    await this.call("pp_set_method", { p_occurrence_id: occurrenceId, p_method: method, p_actor: actorId ?? null });
  }

  async setLinkToken(occurrenceId: string, tokenHash: string): Promise<void> {
    await this.call("pp_set_link_token", { p_occurrence_id: occurrenceId, p_token_hash: tokenHash });
  }

  async setPaymentMethod(planId: string, paymentMethodId: string): Promise<void> {
    await this.call("pp_set_payment_method", { p_plan_id: planId, p_pm: paymentMethodId });
  }

  async listOccurrences(planId: string): Promise<OccurrenceRow[]> {
    const { data, error } = await this.db.from("payment_plan_occurrences").select("*").eq("plan_id", planId).order("seq", { ascending: true });
    if (error) throw toStoreError("listOccurrences", error);
    return (data ?? []).map(mapOccurrence);
  }

  async listAttempts(filter: { planId?: string; occurrenceId?: string }): Promise<AttemptRow[]> {
    let occurrenceIds: string[] | null = null;
    if (filter.planId) {
      // Attempts carry no plan_id; go through the plan's occurrences.
      occurrenceIds = (await this.listOccurrences(filter.planId)).map((o) => o.id);
      if (occurrenceIds.length === 0) return [];
    }
    if (!filter.planId && !filter.occurrenceId) throw new PlanStoreError("invalid_input", "listAttempts needs a planId or an occurrenceId");
    let q = this.db.from("payment_plan_attempts").select("*");
    if (filter.occurrenceId) q = q.eq("occurrence_id", filter.occurrenceId);
    if (occurrenceIds) q = q.in("occurrence_id", occurrenceIds);
    const { data, error } = await q.order("created_at", { ascending: true }).order("attempt_no", { ascending: true });
    if (error) throw toStoreError("listAttempts", error);
    return (data ?? []).map(mapAttempt);
  }

  async listEvents(planId: string): Promise<(PlanEvent & { id: string; createdAt: string })[]> {
    const { data, error } = await this.db
      .from("payment_plan_events")
      .select(EVENT_COLUMNS)
      .eq("plan_id", planId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) throw toStoreError("listEvents", error);
    // deno-lint-ignore no-explicit-any
    return (data ?? []).map((e: any) => ({
      id: e.id,
      planId: e.plan_id,
      occurrenceId: e.occurrence_id ?? null,
      kind: e.kind,
      dedupeKey: e.dedupe_key ?? null,
      channel: e.channel ?? null,
      amountCents: e.amount === null || e.amount === undefined ? null : decimalToCents(e.amount),
      detail: e.detail ?? {},
      actorId: e.actor_id ?? null,
      createdAt: iso(e.created_at),
    }));
  }

  async listForReminders(asOf: string, horizonDays: number, filter?: { tenantId?: string; planId?: string }): Promise<OccurrenceRow[]> {
    return (
      await this.rows("pp_list_for_reminders", {
        p_as_of: asOf,
        p_horizon_days: horizonDays,
        p_tenant: filter?.tenantId ?? null,
        p_plan: filter?.planId ?? null,
      })
    ).map(mapOccurrence);
  }

  async rentalOwedCents(rentalId: string): Promise<number> {
    const data = await this.call<number | string | null>("pp_rental_owed_cents", { p_rental_id: rentalId });
    const cents = Number(data);
    if (data === null || !Number.isSafeInteger(cents) || cents < 0) {
      throw new PlanStoreError("refused", `pp_rental_owed_cents returned ${JSON.stringify(data)} for rental ${rentalId}`);
    }
    return cents;
  }
}
