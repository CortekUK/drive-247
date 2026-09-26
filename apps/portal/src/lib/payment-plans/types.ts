/**
 * Payment plans — the shared contract.
 *
 * ONE plan model replaces PAYG and installments (and, later, auto-extension):
 * a schedule rule says WHEN, an amount spec says HOW MUCH, a collection method
 * says HOW. See docs/PAYMENT_PLANS_DESIGN.md — this file is its §3–§5 in code.
 *
 * KEEP-IN-SYNC: the canonical copy of every file in this directory lives here
 * (supabase/functions/_shared/payment-plans/). An identical copy is written to
 * apps/portal/src/lib/payment-plans/ by `node scripts/sync-payment-plans.mjs`,
 * and a portal test fails if the two ever differ. Edit HERE, then sync.
 *
 * Rules for every file in this directory, because it runs in Deno (edge), in
 * Next (portal, including the browser) and in Node (vitest):
 *   - no imports except relative `./x.ts` imports of siblings;
 *   - no Deno.*, no process.*, no window.*, no npm: specifiers;
 *   - money is INTEGER CENTS; dates are 'YYYY-MM-DD' local calendar strings.
 */

/** A local calendar date in the plan's timezone, 'YYYY-MM-DD'. Never a Date. */
export type ISODate = string;

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type Freq = "daily" | "weekly" | "monthly" | "dates";
export type EndKind = "rental_end" | "count" | "until" | "open";
export type AmountMode = "split_total" | "split_by_days" | "fixed" | "per_period";
export type CollectionMethod = "auto_charge" | "checkout_link" | "manual";
export type PlanStatus = "active" | "paused" | "completed" | "cancelled";

export type OccurrenceStatus =
  | "scheduled" // generated, not yet due
  | "due" // due date reached, nothing taken yet
  | "processing" // an attempt holds the claim (at most one, enforced by index)
  | "requires_action" // card needs the customer (SCA) — falls back to a link
  | "paid"
  | "partially_paid"
  | "failed" // last attempt definitively failed; may carry next_attempt_at
  | "skipped" // operator: nothing is collected on this date
  | "waived" // operator: forgiven (the rental balance is NOT changed by this)
  | "superseded" // replaced by a plan change; history only
  | "cancelled"; // plan cancelled; history only

export type AttemptStatus =
  | "claimed" // row written, provider not yet called
  | "in_flight" // provider called, no definitive answer recorded yet
  | "succeeded"
  | "failed"
  | "requires_action"
  | "indeterminate" // provider returned 5xx / timeout: replay the SAME key, never a new one
  | "abandoned"; // e.g. a checkout link that expired unpaid

/** How the schedule's end is decided. */
export type ScheduleEnd =
  | { kind: "rental_end"; rentalEnd: ISODate } // dates strictly BEFORE the return date
  | { kind: "count"; count: number } // first N occurrences (a stub counts)
  | { kind: "until"; until: ISODate } // dates ON OR BEFORE `until`
  | { kind: "open"; through: ISODate }; // open-ended: materialise dates ON OR BEFORE `through`

/**
 * WHEN. RRULE vocabulary (RFC 5545), our own semantics where the RFC's are
 * wrong for an operator (month-end clamps instead of skipping).
 *
 * daily   — anchor + k·interval days, k ≥ 0.
 * weekly  — weeks are ISO weeks (Monday start, WKST=MO). A date qualifies when
 *           its weekday ∈ byWeekday, it is ≥ anchor, and the number of whole
 *           weeks between the Monday of its week and the Monday of the
 *           anchor's week is a multiple of `interval`.
 * monthly — month = anchor's month + k·interval; day = byMonthDay clamped to
 *           that month's length (-1 = last day). ALWAYS computed from the
 *           anchor, never from the previous occurrence (chained addMonths
 *           loses the 31st forever after one February). Must be ≥ anchor.
 * dates   — exactly `dates`, sorted ascending, duplicates removed; a date
 *           before the anchor is a validation error.
 *
 * firstOccurrence — 'on_anchor': if the rhythm does not itself produce the
 *           anchor date, a STUB occurrence is added on the anchor (the rental
 *           starts on a Wednesday, payments are every Friday → a first payment
 *           on the Wednesday covering Wed–Thu). Ignored for freq 'dates'.
 *           'on_rhythm': no stub; the first payment is the first rhythm date.
 */
export interface ScheduleRule {
  freq: Freq;
  interval: number; // ≥ 1
  byWeekday?: Weekday[]; // weekly only; non-empty
  byMonthDay?: number; // monthly only; 1..31 or -1
  dates?: ISODate[]; // 'dates' only; non-empty
  anchor: ISODate;
  firstOccurrence: "on_anchor" | "on_rhythm";
  end: ScheduleEnd;
}

/**
 * HOW MUCH, in integer cents.
 * split_total   — total ÷ n, rounded DOWN to the cent; the remainder cents
 *                 are added to the LAST occurrence. ($1,000 over 6 → 5 × $166.66 + $166.70)
 * split_by_days — total × days_i ÷ total days, rounded DOWN to the cent; the
 *                 remainder cents are added to the LAST occurrence ("pay for
 *                 the time each payment covers").
 * fixed       — the same amount on every occurrence, stub included.
 * per_period  — days covered × daily rate.
 *
 * Periods (all three modes carry them; per_period prices by them): occurrence
 * i covers [start_i, start_{i+1}) where start_1 = the ANCHOR and start_i = its
 * own due date for i > 1. So the first occurrence always starts at the anchor —
 * with 'on_rhythm' and a Wednesday start, the first Friday covers Wed→Thu of
 * the following week (9 days), and no rental day is ever left unbilled. The
 * last occurrence ends at the rental end (end kind 'rental_end'), or at the
 * date the rhythm WOULD produce next (every other end kind).
 */
export type AmountSpec =
  | { mode: "split_total"; totalCents: number }
  | { mode: "split_by_days"; totalCents: number }
  | { mode: "fixed"; amountCents: number }
  | { mode: "per_period"; dailyRateCents: number };

/** One generated occurrence, before it is stored. */
export interface OccurrenceDraft {
  seq: number; // 1-based
  dueDate: ISODate;
  periodStart: ISODate; // inclusive
  periodEnd: ISODate; // exclusive
  days: number; // calendar days in [periodStart, periodEnd)
  amountCents: number; // > 0
  isStub: boolean;
}

/** A due-date move chosen in the preview; periods and amounts are unchanged. */
export interface ScheduleOverride {
  seq: number;
  moveTo: ISODate;
}

export type PlanRuleErrorCode =
  | "interval_invalid"
  | "weekday_required"
  | "month_day_invalid"
  | "dates_required"
  | "date_before_anchor"
  | "count_invalid"
  | "no_occurrences"
  | "too_many_occurrences"
  | "amount_too_small"
  | "charge_time_invalid";

/** Hard ceiling on generated occurrences — a guard against a runaway rule. */
export const MAX_OCCURRENCES = 520;

/** Charge time used to derive due_at. 00:00–03:59 is refused (DST gaps). */
export const DEFAULT_CHARGE_LOCAL_TIME = "10:00";

// ─────────────────────────────────────────────────────────────────────────────
// Stored rows (the shape the store returns — camelCase mirrors of the tables in
// docs/PAYMENT_PLANS_DESIGN.md §4).
// ─────────────────────────────────────────────────────────────────────────────

export interface PlanRow {
  id: string;
  tenantId: string;
  rentalId: string;
  customerId: string;
  status: PlanStatus;
  rule: ScheduleRule;
  amount: AmountSpec;
  currency: string; // ISO 4217, lower-case for Stripe
  timezone: string; // IANA
  chargeLocalTime: string; // 'HH:MM'
  collectionMethod: CollectionMethod; // default for new occurrences
  fallbackToLink: boolean; // auto_charge that needs the customer → send a link
  maxAttempts: number;
  retryAfterDays: number;
  reminderOffsets: number[]; // days relative to due date, e.g. [-2, 0, 2]
  paymentProvider: "stripe" | "square";
  stripePaymentMethodId: string | null; // validated at charge time; the customer id is NOT stored
  extendsRental: boolean; // open-ended plans that move the rental's end date (slice 3)
  version: number;
  // ── Additive (Wave 3, open-ended plans). Present only when extendsRental is
  // true: the plan RENEWS the rental one period at a time until it is stopped.
  renewal?: PlanRenewal | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Renewals — open-ended plans that extend the rental (Wave 3, spec §4 "green
// line", roadmap A3/A4/A5). One renewal period = one existing-shaped
// extension: a rental_extensions row (status approved) + Extension* ledger
// charges carrying its extension_id, priced exactly as auto-extend prices a
// period (renewal-pricing.ts). The end date moves when the period is PAID
// (finalize_rental_extension), or at once when the operator's Extend says
// "give the days now".
// ─────────────────────────────────────────────────────────────────────────────

/** A renewal period's length unit; `count` of them make one period. */
export type RenewalPeriodUnit = "day" | "week" | "month";

/** Bonzah coverage to buy for each period (A4). */
export interface RenewalCoverage {
  cdw?: boolean;
  rcli?: boolean;
  sli?: boolean;
  pai?: boolean;
}

export interface PlanRenewal {
  periodUnit: RenewalPeriodUnit;
  periodCount: number; // 1..52
  /** Buy this cover for every period BEFORE charging it; null = no insurance. */
  insurance: RenewalCoverage | null;
  /** A5: ask for an extension agreement for each new automatic period. */
  sendAgreementEachPeriod: boolean;
}

/**
 * Where a renewal period's insurance stands (payment_plan_occurrences.insurance_status):
 *   none          — no cover requested for this period;
 *   pending       — requested, not yet decided: the period CANNOT be charged (pp_claim refuses);
 *   insured       — a policy was bought (quote → confirm) and its premium added;
 *   not_insurable — Bonzah cannot cover it (Pacific-tomorrow, not sellable…): no premium;
 *   failed        — the insurer kept failing until the period fell due: no premium.
 */
export type RenewalInsuranceStatus = "none" | "pending" | "insured" | "not_insurable" | "failed";

/** A renewal period's price in integer cents (renewal-pricing.ts renewalBreakdownCents). */
export interface RenewalBreakdown {
  rentalCents: number;
  taxCents: number;
  serviceFeeCents: number;
  /** rentalCents + taxCents + serviceFeeCents — insurance is added only once a policy exists. */
  totalCents: number;
}

/**
 * What pricing a renewal period needs, read from the rental and its tenant at
 * the moment of posting (auto-extend re-prices every period the same way).
 * Dollars, exactly as the columns hold them.
 */
export interface RenewalPricingInputs {
  rentalId: string;
  tenantId: string;
  customerId: string;
  /** rentals.end_date — the paid-through date. */
  rentalEnd: ISODate | null;
  /** rentals.monthly_amount — the PRE-discount per-period rate. */
  monthlyAmount: number | null;
  /** rentals.discount_applied — a flat amount off each period. */
  discountApplied: number | null;
  /** tenants.* — the fields computeBreakdown reads. */
  tenant: {
    tax_enabled: boolean | null;
    tax_percentage: number | null;
    service_fee_enabled: boolean | null;
    service_fee_type: string | null;
    service_fee_value: number | null;
    service_fee_amount: number | null;
  };
}

export interface PostRenewalInput {
  occurrenceId: string;
  breakdown: RenewalBreakdown;
  /** true → the occurrence waits (insurance_status 'pending') until the policy is decided. */
  insuranceRequested: boolean;
  /** Operator's Extend, A3 "give the days now": the rental's end date moves at once. */
  giveDaysNow?: boolean;
  actorId?: string | null;
}

export interface PostRenewalResult {
  extensionId: string;
  /** false = already posted (idempotent; nothing written). */
  posted: boolean;
  sequenceNumber: number;
  /** giveDaysNow moved rentals.end_date. */
  endDateMoved: boolean;
}

export interface RenewalInsuranceDecision {
  occurrenceId: string;
  outcome: "insured" | "not_insurable" | "failed";
  /** bonzah_insurance_policies.id — required for 'insured'. */
  policyRef?: string | null;
  /** Required (> 0) for 'insured'. */
  premiumCents?: number | null;
  coveredFrom?: ISODate | null;
  coveredTo?: ISODate | null;
  reason?: string | null;
}

/**
 * The renewal half of the store (pp_* functions of
 * 20260926120200_open_ended_plans.sql). Optional on a store: the engine skips
 * the renewal stage for a store that does not implement it.
 */
export interface RenewalOperations {
  /** Active plans with renewal work: every renewal plan, and any plan holding an unposted or insurance-pending renewal period. */
  listRenewalPlans(filter?: { tenantId?: string; planId?: string }): Promise<PlanRow[]>;
  /** The rental + tenant fields a period is priced from (plain SELECTs). */
  renewalPricing(rentalId: string): Promise<RenewalPricingInputs>;
  /** pp_append_renewal_period: one more renewal period at the end of the chain. Idempotent per (plan, period start). */
  appendRenewalPeriod(planId: string, draft: OccurrenceDraft, actorId?: string | null): Promise<{ occurrenceId: string; appended: boolean }>;
  /** pp_post_renewal_period: the extension + its Extension* charges, atomically, once per occurrence. */
  postRenewalPeriod(input: PostRenewalInput): Promise<PostRenewalResult>;
  /** pp_record_renewal_insurance: the policy's premium goes on the ledger only with a policy behind it. */
  recordRenewalInsurance(input: RenewalInsuranceDecision): Promise<void>;
  /** pp_reconcile_renewals: renewal periods whose charges were settled outside the plan → paid, end date moved. Returns their ids. */
  reconcileRenewals(filter?: { tenantId?: string; planId?: string }): Promise<string[]>;
}

export interface OccurrenceRow {
  id: string;
  planId: string;
  tenantId: string;
  rentalId: string;
  seq: number;
  planVersion: number;
  dueDate: ISODate;
  dueAt: string; // ISO instant, derived from (dueDate, chargeLocalTime, timezone)
  periodStart: ISODate | null;
  periodEnd: ISODate | null;
  amountCents: number;
  amountPaidCents: number;
  collectionMethod: CollectionMethod;
  status: OccurrenceStatus;
  attemptNo: number;
  nextAttemptAt: string | null;
  // ── Additive (Engine agent, slice 1). Optional so a store that does not
  // select them still satisfies the type.
  /** The due date before the first operator move, when moved. */
  movedFrom?: ISODate | null;
  /** When the occurrence last became `paid`. */
  paidAt?: string | null;
  note?: string | null;
  // ── Additive (Wave 3, open-ended plans).
  /** A renewal period: posting it creates an extension and moves the end date when paid. */
  renews?: boolean;
  /** The rental_extensions row this period posted (null until posted). */
  extensionId?: string | null;
  /** Where the period's insurance stands; null until posted. */
  insuranceStatus?: RenewalInsuranceStatus | null;
}

export interface AttemptRow {
  id: string;
  occurrenceId: string;
  attemptNo: number;
  method: CollectionMethod;
  idempotencyKey: string;
  status: AttemptStatus;
  provider: "stripe" | "square" | "manual" | "simulated";
  providerAccount: string | null; // acct_… when the charge ran on a connected account
  providerMode: "test" | "live" | null;
  providerRef: string | null; // pi_… / cs_… / Square payment id
  paymentId: string | null;
  amountCents: number;
  declineCode: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  // ── Additive (Engine agent, slice 1). Optional so a store that does not
  // select them still satisfies the type.
  /**
   * When the attempt was claimed. Recovery needs it to choose between
   * replaying the key (< 23 h, inside Stripe's 24 h idempotency window) and a
   * lookup by metadata; with no createdAt the engine takes the lookup, which
   * is the path that can never charge twice.
   */
  createdAt?: string;
  finishedAt?: string | null;
  checkoutSessionId?: string | null;
}

export type PlanEventKind =
  | "plan_created"
  | "plan_changed"
  | "plan_paused"
  | "plan_resumed"
  | "plan_cancelled"
  | "plan_completed"
  | "occurrence_due"
  | "reminder"
  | "link_sent"
  | "charge_attempted"
  | "charge_succeeded"
  | "charge_failed"
  | "requires_action"
  | "fallback_to_link"
  | "manual_recorded"
  | "occurrence_moved"
  | "occurrence_skipped"
  | "occurrence_waived"
  | "occurrence_paid"
  | "covered_by_balance"
  // ── Additive (Wave 3, open-ended plans).
  | "period_posted" // a renewal period's extension + Extension* charges went on the ledger
  | "insurance_bought" // its Bonzah policy was bought before the charge (A4)
  | "insurance_not_bought" // Bonzah could not cover it: no premium was charged (A4)
  | "rental_extended" // the rental's end date moved (paid, covered, or days given now)
  | "agreement_choice"; // A5: whether an extension agreement goes out for this period

export interface PlanEvent {
  planId: string;
  occurrenceId?: string | null;
  kind: PlanEventKind;
  /** Unique when set: a second insert with the same key is a no-op (reminder dedupe). */
  dedupeKey?: string | null;
  channel?: "email" | "sms" | "none" | null;
  amountCents?: number | null;
  detail?: Record<string, unknown>;
  actorId?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// The store: every write the engine makes goes through these calls. Each maps
// 1:1 to a SQL function in docs/PAYMENT_PLANS_DESIGN.md §5 (the Supabase store
// calls the RPC; the memory store and the PGlite store implement the same
// semantics, and one parity suite runs against both).
// ─────────────────────────────────────────────────────────────────────────────

export interface ClaimOk {
  attemptId: string;
  attemptNo: number;
  idempotencyKey: string;
  /** min(occurrence remaining, rental outstanding) — never more than is owed. */
  amountCents: number;
}

export type ClaimResult =
  | { ok: true; claim: ClaimOk }
  | { ok: false; reason: "held_elsewhere" | "nothing_owed" | "not_claimable" };

export interface RecordSuccessInput {
  attemptId: string;
  amountCents: number;
  providerRef: string | null;
  providerAccount: string | null;
  providerMode: "test" | "live" | null;
  paymentProvider: "stripe" | "square";
  platformAccount: "uk" | "uae";
  paymentDate: ISODate;
  /** payments.method, e.g. 'Card', 'Cash', 'Bank Transfer'. */
  method: string;
  // ── Additive (Engine agent, slice 1).
  /** cs_… when the money came through a Checkout link (pp_record_success p_checkout_session_id). */
  checkoutSessionId?: string | null;
  /** Operator's note on a manual record; carried on the event. */
  note?: string | null;
  /** app_users.id of the operator who recorded a manual payment. */
  actorId?: string | null;
}

export interface RecordFailureInput {
  attemptId: string;
  status: "failed" | "requires_action" | "indeterminate" | "abandoned";
  providerRef?: string | null;
  declineCode?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  /** When set, the occurrence becomes eligible again at this instant (retry policy). */
  nextAttemptAt?: string | null;
}

export interface PlanStore {
  /** scheduled → due for every occurrence whose due_at ≤ asOf; returns every occurrence
   *  the engine should act on now (due, or failed with next_attempt_at ≤ asOf). */
  collectDue(asOf: string, filter?: { tenantId?: string; planId?: string }): Promise<OccurrenceRow[]>;
  getPlan(planId: string): Promise<PlanRow | null>;
  /** Guarded claim. Exactly one caller can hold an occurrence (partial unique index). */
  claim(occurrenceId: string, method: CollectionMethod, providerAccount: string | null): Promise<ClaimResult>;
  /** claimed → in_flight, written BEFORE the provider is called (write-ahead). */
  markInFlight(attemptId: string): Promise<void>;
  /** ONE transaction: payments row (status 'Completed' → the live FIFO trigger applies it)
   *  + occurrence re-settled + attempt succeeded. */
  recordSuccess(input: RecordSuccessInput): Promise<{ paymentId: string }>;
  recordFailure(input: RecordFailureInput): Promise<void>;
  /** Recompute amount_paid from linked payments and move the status accordingly. */
  settleOccurrence(occurrenceId: string): Promise<OccurrenceRow>;
  /** Attempts left claimed / in_flight / indeterminate for longer than `olderThanSeconds`. */
  staleAttempts(olderThanSeconds: number, asOf: string): Promise<AttemptRow[]>;
  /** false when dedupeKey already existed (nothing written). */
  recordEvent(event: PlanEvent): Promise<boolean>;
}

/**
 * Point reads the engine needs when it is handed an id rather than a row: the
 * webhook knows an attempt id, the operator's Retry knows an occurrence id,
 * recovery knows an attempt and must reach its plan. Plain SELECTs in the
 * Supabase store (service role), no SQL function.
 * Additive (Engine agent, slice 1).
 */
export interface PlanLookups {
  getOccurrence(occurrenceId: string): Promise<OccurrenceRow | null>;
  getAttempt(attemptId: string): Promise<AttemptRow | null>;
}

/**
 * A store whose notion of "now" can be driven — the memory store under a
 * simulated clock. The engine calls setNow(asOf) at every entry point when the
 * store has it; the Supabase store does not implement it (Postgres now() is
 * the clock). Additive (Engine agent, slice 1).
 */
export interface ClockedStore {
  setNow(asOf: string): void;
}

/**
 * Operator and lifecycle operations. Both stores (memory, PGlite/Supabase)
 * implement these with the semantics of the SQL functions in the design doc §5;
 * the scenario suite drives them.
 */
export interface PlanOperations {
  createPlan(input: {
    plan: Omit<PlanRow, "id" | "version" | "status">;
    occurrences: OccurrenceDraft[];
    actorId?: string | null;
  }): Promise<string>;
  replaceFuture(input: {
    planId: string;
    expectedVersion: number;
    planPatch: Partial<Omit<PlanRow, "id" | "tenantId" | "rentalId" | "customerId" | "version">>;
    occurrences: OccurrenceDraft[];
    actorId?: string | null;
    reason: string;
  }): Promise<number>;
  pausePlan(planId: string, actorId?: string | null, reason?: string): Promise<void>;
  resumePlan(planId: string, actorId?: string | null): Promise<void>;
  cancelPlan(planId: string, actorId?: string | null, reason?: string): Promise<void>;
  moveOccurrence(occurrenceId: string, to: ISODate, actorId?: string | null): Promise<void>;
  /** The remaining amount rolls into the next open occurrence; refused on the last. */
  skipOccurrence(occurrenceId: string, actorId?: string | null): Promise<void>;
  setMethod(occurrenceId: string, method: CollectionMethod, actorId?: string | null): Promise<void>;
  setLinkToken(occurrenceId: string, tokenHash: string): Promise<void>;
  setPaymentMethod(planId: string, paymentMethodId: string): Promise<void>;
  listOccurrences(planId: string): Promise<OccurrenceRow[]>;
  listAttempts(filter: { planId?: string; occurrenceId?: string }): Promise<AttemptRow[]>;
  listEvents(planId: string): Promise<(PlanEvent & { id: string; createdAt: string })[]>;
  listForReminders(asOf: string, horizonDays: number, filter?: { tenantId?: string; planId?: string }): Promise<OccurrenceRow[]>;
  rentalOwedCents(rentalId: string): Promise<number>;
}

/**
 * Money that reaches the rental OUTSIDE the plan — only the scenario harness
 * uses this (an early payment, a refund). The memory store models the rental
 * balance as one number per rental; the PGlite store uses the real ledger.
 */
export interface LedgerFixture {
  /** A captured payment applied to the rental's charges, not linked to any occurrence. */
  recordExternalPayment(rentalId: string, amountCents: number, paymentDate: ISODate): Promise<string>;
  /** Refund (part of) a payment; linked occurrences are re-settled. */
  refundPayment(paymentId: string, amountCents: number): Promise<void>;
}
