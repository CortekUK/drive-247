// ONE-OFF BACKFILL: reconcile the accumulated deposit-hold wreckage against Stripe.
//
// WHY THIS EXISTS
// ---------------
// W1 of docs/GMT_AUTH_HOLD_90DAY_PLAN.md turns on operator alerting inside
// refresh-deposit-holds. If alerting is switched on before the existing damage is
// cleared, day one is an alert storm on rows that have been wrong for weeks, the
// channel gets muted, and the alerting is worthless. So: BACKFILL FIRST, ALERTING
// SECOND. This function is the backfill.
//
// It is deliberately a separate, unscheduled function rather than a flag on
// reconcile-deposit-holds, because it sweeps two cohorts the reconciler treats as
// out of scope and always will:
//
//   * deposit_hold_status = 'expired' — the reconciler treats 'expired' as
//     TERMINAL, which is correct going forward. But historically the refresh
//     loop's blanket catch wrote terminal 'expired' for EVERY error class,
//     including throws that happened BEFORE Stripe was ever contacted (the
//     tenants lookup, getConnectAccountId). Those rows may still be sitting on a
//     live authorisation that nothing will ever refresh, capture or release.
//     Only Stripe can tell us which. This is the highest-value cohort.
//
//   * deposit_hold_status IS NULL with a non-NULL deposit_hold_expires_at — the
//     fingerprint of place-deposit-hold failing: its error paths reset the status
//     claim to NULL but never clear the expiry it had already stamped. On prod at
//     the time of writing, 4 of GMT's 10 Active rentals look like this. The
//     reconciler's driver query is `.in(deposit_hold_status, <non-terminal set>)`,
//     which never matches NULL, so no scheduled job will ever look at them.
//
// It also sweeps three cohorts that reconcile-deposit-holds DOES cover on its
// 6-hourly tick — stranded 'refreshing'/'processing' claims, 'held' rows whose
// expiry is already in the past, and 'held' rows with a NULL expiry (invisible to
// the refresh cron forever, because `.lt()` against NULL yields NULL, not true).
// Overlap is intentional: the backfill has to run before the reconciler is
// scheduled, and running it afterwards is a no-op rather than a conflict.
//
// PRINCIPLES — all four are load-bearing
//
//  1. READ-ONLY BY DEFAULT. dryRun defaults to TRUE. An operator sees the full
//     blast radius, per rental, before a single row is written. Writes happen
//     only when the caller explicitly sends dryRun:false. A dry run still calls
//     Stripe (reads are free and safe) — a report built without asking Stripe
//     would just be the same lie the database is already telling.
//
//  2. RECORD-ANCHORED STRIPE RESOLUTION. The hold lives on the platform account,
//     connected account and mode it was CREATED under
//     (deposit_hold_connect_account_id / deposit_hold_stripe_mode, falling back
//     to rentals.platform_account) — never the tenant's CURRENT values. Reading a
//     UK-era hold with UAE keys mid-migration returns resource_missing, which
//     looks exactly like an expired hold and would mark a live authorisation
//     dead.
//
//  3. EXPIRY IS ONLY EVER STRIPE'S ANSWER. deposit_hold_expires_at is written
//     exclusively from payment_method_details.card.capture_before on the
//     authorising charge, stamped deposit_hold_expiry_source =
//     'stripe_capture_before'. We deliberately do NOT use the shared
//     resolveHoldExpiry helper: it layers a `now + N days` floor on top whenever
//     it cannot read capture_before, and that value MOVES on every call.
//     Persisting a computed fallback would re-arm the clock and push the row out
//     of refresh-deposit-holds' `.lt('deposit_hold_expires_at', now + lookahead)`
//     window — the hold then dies unnoticed at its real deadline. That IS the GMT
//     incident. When capture_before is absent we leave the stored value alone.
//
//  4. FAIL SAFE, NEVER OPEN. Anything we cannot conclude leaves the row as it is.
//     We never write a state that would permit a SECOND authorisation on a
//     renter's card on the strength of a guess. Where a row ASSERTS a live hold
//     but can never be checked (no PaymentIntent id at all, or Stripe has no
//     record of the id on the record-anchored account) it goes to 'needs_review'
//     — a human, not a heuristic.
//
// WHAT IT DELIBERATELY DOES NOT DO
//
//  * It never creates, captures or cancels anything at Stripe. It is a read plus
//    a database correction. Cancelling orphaned authorisations is the
//    reconciler's job (it owns the deposit_hold_links orphan sweep); doing it
//    from a one-off with no ledger history is how you release a renter's live
//    deposit by accident.
//  * It never inserts a `payments` row, not even for a PI Stripe reports as
//    'succeeded'. Payments rows keyed on deposit-hold PaymentIntents arm the
//    rental-cancellation path in stripe-webhook-*.
//  * It never touches a row it did not read (compare-and-set on BOTH status and
//    PaymentIntent id), so it is safe to run while the refresh cron is live.
//
// AUTH: service-role bearer only, checked in constant time. This function is not
// scheduled and is not in config.toml's verify_jwt=false list, so the gateway
// also enforces a valid JWT — the explicit check below is what stops any other
// signed-in principal from driving it.
//
// BODY (all optional):
//   {
//     dryRun?: boolean,        // default TRUE. Send false to actually write.
//     tenantId?: string,       // scope to one tenant — run GMT alone first.
//     onlyRentalId?: string,   // scope to one rental.
//     cohorts?: string[],      // subset of COHORTS below; default all.
//     limit?: number           // max rentals examined this invocation (<= 2000).
//   }
// snake_case aliases (dry_run, tenant_id, only_rental_id) are accepted too.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  getConnectAccountId,
  getStripeClientForRecord,
  TENANT_STRIPE_COLUMNS,
  type StripeMode,
} from "../_shared/stripe-client.ts";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const JOB_NAME = "backfill-deposit-holds";

/** Rows fetched per keyset page. */
const PAGE_SIZE = 100;

/** Default ceiling on rentals examined per invocation. Prod carries ~166 rentals
 *  in total so this never truncates today; it exists so a runaway dataset cannot
 *  kill the isolate mid-write. Truncation is reported and recorded in
 *  cron_runs.truncated — re-invoke to continue. */
const DEFAULT_MAX_RENTALS = 500;
const HARD_MAX_RENTALS = 2000;

/** Stop starting new work after this long. Supabase edge functions die at 150s
 *  idle / 400s wall clock, and a kill mid-write is exactly the failure mode that
 *  created half of this wreckage. */
const MAX_RUN_MS = 120_000;

/** One Stripe round-trip each, well inside Stripe's rate limits. */
const CONCURRENCY = 4;

/** A 'refreshing'/'processing' claim older than this is stranded, not in flight.
 *  Matches reconcile-deposit-holds so the two agree about who owns a row. */
const STUCK_CLAIM_MS = 30 * 60_000;

/** Cap on how many per-rental findings come back in the HTTP response. The full
 *  record of anything actually applied lives in deposit_hold_links. */
const MAX_REPORTED_FINDINGS = 300;

// ---------------------------------------------------------------------------
// Cohorts
// ---------------------------------------------------------------------------

const COHORTS = [
  /** Terminal 'expired' written by the old blanket catch — including for errors
   *  that occurred before Stripe was ever contacted. Many may still be alive. */
  "expired_terminal",
  /** Claim states nothing reaps. Invisible to every query and to all three
   *  portal branches. */
  "stuck_claim",
  /** DB says held, the stored deadline has already passed. */
  "held_past_expiry",
  /** DB says held with no deadline at all — invisible to the refresh cron
   *  forever, because `.lt()` against NULL yields NULL, not true. */
  "held_null_expiry",
  /** GMT fingerprint: place-deposit-hold's error path reset the status to NULL
   *  but left the expiry it had already stamped. */
  "null_status_with_expiry",
] as const;

type Cohort = (typeof COHORTS)[number];

/** States in which another worker is supposed to be mid-flight on the row. */
const CLAIM_STATUSES = new Set(["refreshing", "processing"]);

/** Stripe PaymentIntent status -> the deposit_hold_status that is TRUE when we
 *  see it. Anything absent here (processing, requires_confirmation) is still in
 *  motion: no funds are authorised yet, but it is not dead either, so writing any
 *  terminal status for it would be a lie.
 *
 *  Every value on the right MUST exist in the rentals.deposit_hold_status CHECK
 *  (processing | refreshing | capturing | held | requires_action | failed |
 *  needs_review | disputed | captured | released | expired). */
const PI_STATUS_TO_HOLD_STATUS: Record<string, string> = {
  requires_capture: "held",
  canceled: "expired",
  succeeded: "captured",
  requires_payment_method: "failed",
  requires_action: "requires_action",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RentalRow {
  id: string;
  tenant_id: string;
  status: string | null;
  platform_account: string | null;
  deposit_hold_status: string | null;
  deposit_hold_payment_intent_id: string | null;
  deposit_hold_expires_at: string | null;
  deposit_hold_expiry_source: string | null;
  deposit_hold_extended_auth: boolean | null;
  deposit_hold_window_seconds: number | null;
  deposit_hold_connect_account_id: string | null;
  deposit_hold_stripe_mode: string | null;
  deposit_hold_currency: string | null;
  deposit_hold_status_changed_at: string | null;
  deposit_hold_attempt_seq: number | null;
  deposit_hold_amount: number | null;
  deposit_hold_card_brand: string | null;
  deposit_hold_card_last4: string | null;
  deposit_hold_card_exp_month: number | null;
  deposit_hold_card_exp_year: number | null;
  deposit_hold_card_funding: string | null;
}

const RENTAL_COLUMNS = `
  id, tenant_id, status, platform_account,
  deposit_hold_status, deposit_hold_payment_intent_id,
  deposit_hold_expires_at, deposit_hold_expiry_source,
  deposit_hold_extended_auth, deposit_hold_window_seconds,
  deposit_hold_connect_account_id, deposit_hold_stripe_mode, deposit_hold_currency,
  deposit_hold_status_changed_at, deposit_hold_attempt_seq, deposit_hold_amount,
  deposit_hold_card_brand, deposit_hold_card_last4,
  deposit_hold_card_exp_month, deposit_hold_card_exp_year, deposit_hold_card_funding
`;

interface TenantRow {
  id: string;
  stripe_mode: string | null;
  stripe_account_id: string | null;
  stripe_onboarding_complete: boolean | null;
  payment_model: string | null;
  own_stripe_account_id: string | null;
  own_stripe_test_account_id: string | null;
}

interface StripeContext {
  stripe: ReturnType<typeof getStripeClientForRecord>;
  stripeOptions: { stripeAccount?: string } | undefined;
  connectAccountId: string | null;
  mode: StripeMode;
}

/** Everything we are ALLOWED to persist about an authorisation, read straight
 *  off the charge. Never a computed value — see principle 3. */
interface ChargeFacts {
  captureBefore: string | null;
  extendedAuth: boolean | null;
  extendedAuthStatus: string | null;
  windowSeconds: number | null;
  cardBrand: string | null;
  cardLast4: string | null;
  cardExpMonth: number | null;
  cardExpYear: number | null;
  cardFunding: string | null;
}

type Outcome =
  /** A correction was applied (or would be, in a dry run). */
  | "corrected"
  /** Stripe agrees with the database. Nothing to do beyond the heartbeat. */
  | "confirmed"
  /** Another worker legitimately owns the row right now. */
  | "claim_active"
  /** Still authorising at Stripe — neither live nor dead yet. */
  | "in_flight"
  /** Sent to a human: asserts a live hold that can never be checked. */
  | "needs_review"
  /** Reported only: no PaymentIntent survives, so Stripe cannot be consulted and
   *  the row asserts nothing that would block placement. */
  | "unverifiable"
  /** Stripe context could not be resolved (tenant mid-OAuth, missing keys).
   *  Transient — left completely alone, never downgraded. */
  | "unresolvable"
  /** Row changed underneath us between the read and the write. */
  | "lost_race"
  /** Threw. Row untouched. */
  | "failed";

interface Finding {
  rental_id: string;
  tenant_id: string;
  cohort: Cohort;
  rental_status: string | null;
  outcome: Outcome;
  from_status: string | null;
  to_status: string | null;
  payment_intent_id: string | null;
  stripe_pi_status: string | null;
  expires_at_before: string | null;
  expires_at_after: string | null;
  note: string;
}

interface Summary {
  examined: number;
  corrected: number;
  confirmed: number;
  claimActive: number;
  inFlight: number;
  needsReview: number;
  unverifiable: number;
  unresolvable: number;
  lostRace: number;
  failed: number;
  truncated: boolean;
  /** Rows that remain invisible to refresh-deposit-holds after this pass:
   *  Stripe confirms them live but has published no capture_before, so their
   *  deposit_hold_expires_at is still NULL and `.lt()` still cannot see them. */
  stillUnknownExpiry: number;
  byCohort: Record<string, number>;
  transitions: Record<string, number>;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isServiceRoleCall(req: Request): boolean {
  const serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  if (!serviceKey) return false;
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  return constantTimeEquals(token, serviceKey);
}

// ---------------------------------------------------------------------------
// Stripe context — RECORD-anchored (principle 2)
// ---------------------------------------------------------------------------

/**
 * Preference order, strongest first:
 *   1. rentals.deposit_hold_stripe_mode / _connect_account_id — written at
 *      placement precisely so later operations never re-derive context.
 *   2. rentals.platform_account + the tenant's current Stripe columns — correct
 *      for every hold placed before the anchor columns existed.
 *
 * Returns null rather than throwing: getConnectAccountId THROWS for a live
 * payment_model='own' tenant with no connected account, and platform_account
 * 'uae' forces that model, so a tenant mid-OAuth would otherwise take down the
 * whole batch. An unresolvable context means Stripe cannot be consulted, which by
 * principle 4 means we change nothing at all.
 */
function resolveStripeContext(rental: RentalRow, tenant: TenantRow | undefined): StripeContext | null {
  try {
    const anchoredMode =
      rental.deposit_hold_stripe_mode === "test" || rental.deposit_hold_stripe_mode === "live"
        ? (rental.deposit_hold_stripe_mode as StripeMode)
        : null;
    const mode: StripeMode = anchoredMode ?? ((tenant?.stripe_mode as StripeMode) || "test");
    const stripe = getStripeClientForRecord(rental, mode);

    let connectAccountId = rental.deposit_hold_connect_account_id || null;
    if (!connectAccountId) {
      if (!tenant) return null;
      connectAccountId = getConnectAccountId({
        // The MODE the hold lives in decides the connected account, not the
        // tenant's mode today. A rental anchored to 'live' whose tenant has since
        // been flipped back to 'test' would otherwise be probed with live keys
        // against the shared TEST Connect account — Stripe answers
        // resource_missing, which reads exactly like a dead authorisation.
        stripe_mode: mode,
        stripe_account_id: tenant.stripe_account_id,
        stripe_onboarding_complete: tenant.stripe_onboarding_complete,
        // The HOLD's platform decides the model, not the tenant's today.
        payment_model: rental.platform_account === "uae" ? "own" : "managed",
        own_stripe_account_id: tenant.own_stripe_account_id,
        own_stripe_test_account_id: tenant.own_stripe_test_account_id,
      });
    }

    return {
      stripe,
      stripeOptions: connectAccountId ? { stripeAccount: connectAccountId } : undefined,
      connectAccountId,
      mode,
    };
  } catch (err) {
    console.warn("[HOLD-BACKFILL] Stripe context unresolvable for rental", rental.id, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Reading truth off the authorising charge (principle 3)
// ---------------------------------------------------------------------------

/**
 * Read capture_before and card identity DIRECTLY off the expanded charge.
 *
 * Deliberately not resolveHoldExpiry / resolveHoldExpiryDetailed: both layer a
 * `now + HOLD_EXPIRY_FALLBACK_DAYS` floor on top when Stripe has published no
 * deadline, and that value moves on every call. Persisting it here would re-arm
 * the clock on rows this sweep exists to expose. Absent capture_before ⟹
 * captureBefore stays null ⟹ deposit_hold_expires_at is excluded from the patch
 * entirely and the stored value is left exactly as it is.
 *
 * The window is measured from the CHARGE's created timestamp, not from now: a
 * hold read back weeks later would otherwise look as though the network granted
 * it a much shorter window than it did.
 */
function readChargeFacts(intent: any): ChargeFacts {
  const charge =
    intent?.latest_charge && typeof intent.latest_charge === "object" ? intent.latest_charge : null;
  if (!charge && typeof intent?.latest_charge === "string") {
    // Should not happen — every retrieve here passes expand:['latest_charge'].
    // We deliberately do NOT pay for a second round-trip: this sweep can touch
    // hundreds of rows, and losing the deadline for one row is the SAFE
    // direction (we leave the stored expiry alone rather than guess).
    console.warn("[HOLD-BACKFILL] latest_charge came back unexpanded for", intent?.id, "— card facts skipped");
  }
  const card = charge?.payment_method_details?.card ?? null;

  const captureBeforeUnix = card?.capture_before;
  const hasDeadline = typeof captureBeforeUnix === "number" && captureBeforeUnix > 0;
  const createdUnix = typeof charge?.created === "number" ? charge.created : null;

  const extendedAuthStatus = (card?.extended_authorization?.status as string | undefined) ?? null;

  return {
    captureBefore: hasDeadline ? new Date(captureBeforeUnix * 1000).toISOString() : null,
    extendedAuth: extendedAuthStatus === null ? null : extendedAuthStatus === "enabled",
    extendedAuthStatus,
    windowSeconds:
      hasDeadline && createdUnix !== null ? Math.max(0, captureBeforeUnix - createdUnix) : null,
    cardBrand: card?.brand ?? null,
    cardLast4: card?.last4 ?? null,
    cardExpMonth: typeof card?.exp_month === "number" ? card.exp_month : null,
    cardExpYear: typeof card?.exp_year === "number" ? card.exp_year : null,
    cardFunding: card?.funding ?? null,
  };
}

// ---------------------------------------------------------------------------
// Guarded writes
// ---------------------------------------------------------------------------

/**
 * Compare-and-set on BOTH the status we read AND the PaymentIntent we probed.
 *
 * Status alone is not enough, and the gap is not theoretical — it opens exactly
 * when we conclude "dead", because that is what refresh-deposit-holds does to the
 * incumbent PI:
 *   T0  we read the row: status='held', PI=PI_A
 *   T1  the refresh engine cancels PI_A, creates PI_B, writes PI_B + 'held'
 *   T2  our probe of PI_A returns 'canceled' → we classify it dead
 *   T3  a status-only CAS still matches ('held' again) and we stamp 'expired'
 *       over a row that now carries a LIVE authorisation
 * The renter would then be authorised on top of PI_B — two live holds on one
 * card. A row whose PI has moved on is by definition not the row we probed, so a
 * 0-row update is the CORRECT outcome.
 *
 * NOTE: a PostgREST `.or()` filter on `.update()` mis-qualifies the column
 * ("column rentals.deposit_hold_status does not exist"), so we branch on the
 * proven `.is(null)` / `.eq()` filters — the same idiom as place-deposit-hold's
 * atomic claim.
 */
async function casUpdateRental(
  supabase: SupabaseClient,
  rentalId: string,
  expectedStatus: string | null,
  expectedPi: string | null,
  patch: Record<string, unknown>
): Promise<boolean> {
  let query = supabase.from("rentals").update(patch).eq("id", rentalId);
  query = expectedStatus === null
    ? query.is("deposit_hold_status", null)
    : query.eq("deposit_hold_status", expectedStatus);
  query = expectedPi === null
    ? query.is("deposit_hold_payment_intent_id", null)
    : query.eq("deposit_hold_payment_intent_id", expectedPi);

  const { data, error } = await query.select("id");
  if (error) throw new Error(`Failed to save backfilled deposit hold: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

/**
 * Append to the authorization ledger. Bookkeeping must NEVER fail a correction:
 * deposit_hold_links carries UNIQUE(rental_id, attempt_seq, action), so re-running
 * the same correction at the same attempt_seq collides — that is a duplicate
 * record, not a money problem, and swallowing it is correct.
 */
async function recordLink(supabase: SupabaseClient, row: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from("deposit_hold_links").insert({
    actor: "backfill",
    ...row,
  });
  if (error) {
    console.warn("[HOLD-BACKFILL] Ledger insert failed (continuing):", error.message, row);
  }
}

// ---------------------------------------------------------------------------
// Per-rental backfill
// ---------------------------------------------------------------------------

function finding(
  rental: RentalRow,
  cohort: Cohort,
  outcome: Outcome,
  note: string,
  extra: Partial<Finding> = {}
): Finding {
  return {
    rental_id: rental.id,
    tenant_id: rental.tenant_id,
    cohort,
    rental_status: rental.status ?? null,
    outcome,
    from_status: rental.deposit_hold_status ?? null,
    to_status: null,
    payment_intent_id: rental.deposit_hold_payment_intent_id ?? null,
    stripe_pi_status: null,
    expires_at_before: rental.deposit_hold_expires_at ?? null,
    expires_at_after: null,
    note,
    ...extra,
  };
}

async function backfillRental(
  supabase: SupabaseClient,
  rental: RentalRow,
  tenant: TenantRow | undefined,
  cohort: Cohort,
  opts: { dryRun: boolean; activeClaim: boolean }
): Promise<{ finding: Finding; unknownExpiry?: boolean }> {
  const currentStatus = rental.deposit_hold_status ?? null;
  const probedPiId = rental.deposit_hold_payment_intent_id || null;
  const attemptSeq = rental.deposit_hold_attempt_seq ?? 0;
  const nowIso = new Date().toISOString();

  // ── Claim states: only a STRANDED claim is ours ─────────────────────────
  // 'refreshing'/'processing' mean another worker owns the row right now.
  // deposit_hold_status_changed_at is NULL on every row written before that
  // column existed — precisely the rows stranded by the old refresh cron, the
  // ones we most need — so NULL counts as stale. A deposit_hold_links row written
  // for this rental in the last 30 minutes still holds us off: a live writer
  // always leaves a fresh ledger row, which is stronger evidence than a column
  // nobody wrote yet.
  if (CLAIM_STATUSES.has(currentStatus ?? "")) {
    const changedAt = rental.deposit_hold_status_changed_at
      ? new Date(rental.deposit_hold_status_changed_at).getTime()
      : null;
    const stale = changedAt === null || Date.now() - changedAt > STUCK_CLAIM_MS;
    if (!stale || opts.activeClaim) {
      return {
        finding: finding(rental, cohort, "claim_active", "A writer is actively mid-flight on this rental — left alone."),
      };
    }
  }

  // ── Nothing to probe ────────────────────────────────────────────────────
  if (!probedPiId) {
    // A row that ASSERTS a live hold with no PaymentIntent recorded cannot be
    // true and can never be checked: the writer died before persisting the id.
    // Guessing 'expired' would let a second authorisation onto the renter's card;
    // leaving it 'held' keeps a lie on screen AND cannot be acted on (the refresh
    // engine needs the id it does not have). 'needs_review' is exactly the state
    // for "divergence we cannot safely resolve".
    if (currentStatus === "held" || CLAIM_STATUSES.has(currentStatus ?? "")) {
      if (opts.dryRun) {
        return {
          finding: finding(rental, cohort, "needs_review", "Asserts a hold but records no PaymentIntent — would move to needs_review.", {
            to_status: "needs_review",
          }),
        };
      }
      const applied = await casUpdateRental(supabase, rental.id, currentStatus, null, {
        deposit_hold_status: "needs_review",
        deposit_hold_status_changed_at: nowIso,
        deposit_hold_last_error:
          "Backfill: no PaymentIntent recorded for a hold the database believes exists — cannot be verified at Stripe.",
      });
      if (!applied) {
        return { finding: finding(rental, cohort, "lost_race", "Row changed between read and write.") };
      }
      await recordLink(supabase, {
        rental_id: rental.id,
        tenant_id: rental.tenant_id,
        attempt_seq: attemptSeq,
        action: "backfill:needs_review",
        platform_account: rental.platform_account,
        outcome: "succeeded",
        error_message: `Backfill: status '${currentStatus}' with no payment_intent_id`,
        completed_at: nowIso,
      });
      console.warn("[HOLD-BACKFILL] Rental", rental.id, `${currentStatus} -> needs_review (no PaymentIntent recorded)`);
      return {
        finding: finding(rental, cohort, "needs_review", "Asserted a hold but recorded no PaymentIntent — moved to needs_review.", {
          to_status: "needs_review",
        }),
      };
    }

    // 'expired' or NULL status with no PaymentIntent: nothing to consult Stripe
    // about, and neither state blocks a fresh placement. Report, never guess.
    return {
      finding: finding(
        rental,
        cohort,
        "unverifiable",
        cohort === "null_status_with_expiry"
          ? "NULL status with a stale expiry and no PaymentIntent — placement almost certainly failed before Stripe was reached. Nothing to verify; re-place the hold."
          : "No PaymentIntent recorded — nothing for Stripe to answer about."
      ),
    };
  }

  // ── Resolve the account the hold actually lives on ──────────────────────
  const ctx = resolveStripeContext(rental, tenant);
  if (!ctx) {
    // Transient by nature (tenant mid-OAuth, a missing key). We deliberately do
    // NOT downgrade the row: moving a 'held' row to needs_review here would
    // remove it from refresh-deposit-holds' driver query and could kill a hold
    // that is perfectly alive. Report and move on.
    return {
      finding: finding(rental, cohort, "unresolvable", "Stripe context could not be resolved (tenant Stripe config) — row untouched."),
    };
  }

  // ── Ask Stripe ──────────────────────────────────────────────────────────
  let intent: any;
  try {
    intent = await ctx.stripe.paymentIntents.retrieve(
      probedPiId,
      // Expand the authorising charge so the real capture deadline, the
      // extended-authorization grant and the card identity all arrive in one
      // round-trip.
      { expand: ["latest_charge"] },
      ctx.stripeOptions
    );
  } catch (err: any) {
    const code = err?.code ?? err?.raw?.code;
    if (code === "resource_missing") {
      // Stripe has never heard of this id ON THIS ACCOUNT/MODE. Either the anchor
      // is wrong or the id is. We CANNOT conclude the renter's money is free.
      if (currentStatus === "held" || CLAIM_STATUSES.has(currentStatus ?? "")) {
        if (opts.dryRun) {
          return {
            finding: finding(rental, cohort, "needs_review", `Stripe has no record of ${probedPiId} on ${ctx.connectAccountId ?? "the platform account"} (${ctx.mode}) — would move to needs_review.`, {
              to_status: "needs_review",
            }),
          };
        }
        const applied = await casUpdateRental(supabase, rental.id, currentStatus, probedPiId, {
          deposit_hold_status: "needs_review",
          deposit_hold_status_changed_at: nowIso,
          deposit_hold_last_error_code: "resource_missing",
          deposit_hold_last_error: `Backfill: Stripe has no record of ${probedPiId} on ${ctx.connectAccountId ?? "the platform account"} (${ctx.mode}).`,
        });
        if (!applied) {
          return { finding: finding(rental, cohort, "lost_race", "Row changed between read and write.") };
        }
        await recordLink(supabase, {
          rental_id: rental.id,
          tenant_id: rental.tenant_id,
          attempt_seq: attemptSeq,
          action: "backfill:needs_review",
          payment_intent_id: probedPiId,
          platform_account: rental.platform_account,
          connect_account_id: ctx.connectAccountId,
          stripe_mode: ctx.mode,
          outcome: "succeeded",
          error_code: "resource_missing",
          error_message: "Backfill: PaymentIntent not found on the record-anchored account",
          completed_at: nowIso,
        });
        return {
          finding: finding(rental, cohort, "needs_review", "Stripe has no record of this PaymentIntent on the record-anchored account — moved to needs_review.", {
            to_status: "needs_review",
          }),
        };
      }
      // 'expired' / NULL status: the row already claims nothing, so an id Stripe
      // cannot find changes nothing and is safe to leave.
      return {
        finding: finding(rental, cohort, "unverifiable", `Stripe has no record of ${probedPiId} on ${ctx.connectAccountId ?? "the platform account"} (${ctx.mode}) — row left as-is.`),
      };
    }
    // Network / auth / anything else is a genuine failure, not a state we can
    // reconcile. Reporting a hold as dead because Stripe was unreachable is the
    // one thing we must never do.
    throw err;
  }

  const piStatus = String(intent.status);
  const trueStatus = PI_STATUS_TO_HOLD_STATUS[piStatus] ?? null;
  const piCurrency = typeof intent.currency === "string" ? intent.currency.toLowerCase() : null;
  const amountCapturable = typeof intent.amount_capturable === "number" ? intent.amount_capturable : null;

  if (!trueStatus) {
    // 'processing' / 'requires_confirmation': still authorising. Not live, not
    // dead. Any terminal write here would be a lie.
    return {
      finding: finding(rental, cohort, "in_flight", `Stripe reports '${piStatus}' — still in motion, left alone.`, {
        stripe_pi_status: piStatus,
      }),
    };
  }

  // ═══ The authorisation is LIVE ═════════════════════════════════════════
  if (trueStatus === "held") {
    const facts = readChargeFacts(intent);

    // Cohort E: status NULL but funds ARE authorised at Stripe. This is the
    // recovery that matters most — an untracked live hold on a renter's card that
    // no refresh, capture or release path can currently reach.
    const patch: Record<string, unknown> = { deposit_hold_verified_at: nowIso };
    let changed = false;

    if (facts.captureBefore) {
      // Compare as instants, not strings: Postgres returns
      // "2026-08-16T10:00:00+00:00" while toISOString() gives
      // "2026-08-16T10:00:00.000Z", so a string compare is never equal.
      const storedMs = rental.deposit_hold_expires_at ? new Date(rental.deposit_hold_expires_at).getTime() : NaN;
      const drifted = !(Math.abs(storedMs - new Date(facts.captureBefore).getTime()) < 1000);
      if (drifted || rental.deposit_hold_expiry_source !== "stripe_capture_before") {
        patch.deposit_hold_expires_at = facts.captureBefore;
        patch.deposit_hold_expiry_source = "stripe_capture_before";
        changed = true;
      }
      if (facts.windowSeconds !== null && facts.windowSeconds !== rental.deposit_hold_window_seconds) {
        patch.deposit_hold_window_seconds = facts.windowSeconds;
      }
    }

    if (facts.extendedAuth !== null && facts.extendedAuth !== rental.deposit_hold_extended_auth) {
      patch.deposit_hold_extended_auth = facts.extendedAuth;
      changed = true;
    }

    if (facts.cardBrand && facts.cardBrand !== rental.deposit_hold_card_brand) patch.deposit_hold_card_brand = facts.cardBrand;
    if (facts.cardLast4 && facts.cardLast4 !== rental.deposit_hold_card_last4) patch.deposit_hold_card_last4 = facts.cardLast4;
    if (facts.cardExpMonth !== null && facts.cardExpMonth !== rental.deposit_hold_card_exp_month) patch.deposit_hold_card_exp_month = facts.cardExpMonth;
    if (facts.cardExpYear !== null && facts.cardExpYear !== rental.deposit_hold_card_exp_year) patch.deposit_hold_card_exp_year = facts.cardExpYear;
    if (facts.cardFunding && facts.cardFunding !== rental.deposit_hold_card_funding) patch.deposit_hold_card_funding = facts.cardFunding;

    // The currency the authorisation is ACTUALLY held in. Three code paths read
    // currency from the tenant's CURRENT row, so a UK→UAE settings flip mid-rental
    // can produce a replacement hold in a new currency. Anchoring the real one
    // here is what lets anything downstream notice.
    if (piCurrency && piCurrency !== rental.deposit_hold_currency) {
      patch.deposit_hold_currency = piCurrency;
    }

    // Anchor the Stripe context we just PROVED correct — Stripe answering for
    // this PaymentIntent on this account/mode IS the proof. This converts a
    // derived context into a record-anchored one so future operations survive the
    // tenant flipping platform mid-rental.
    if (!rental.deposit_hold_connect_account_id && ctx.connectAccountId) {
      patch.deposit_hold_connect_account_id = ctx.connectAccountId;
    }
    if (!rental.deposit_hold_stripe_mode) {
      patch.deposit_hold_stripe_mode = ctx.mode;
    }

    if (currentStatus !== "held") {
      patch.deposit_hold_status = "held";
      patch.deposit_hold_status_changed_at = nowIso;
      // A demonstrably live authorisation clears the failure state that was
      // blocking retries.
      patch.deposit_hold_last_error = null;
      patch.deposit_hold_last_error_code = null;
      patch.deposit_hold_next_retry_at = null;
      changed = true;
    }

    // Still invisible to refresh-deposit-holds: live, but Stripe has published no
    // capture_before and we refuse to invent one, so deposit_hold_expires_at stays
    // NULL and `.lt()` still cannot see the row. Surface it loudly — this is the
    // cohort that needs a human or a W2 NULL-safe driver query, not a guess.
    const unknownExpiry = !facts.captureBefore && !rental.deposit_hold_expires_at;

    const noteBits = [
      `Stripe reports the authorisation is LIVE (${piStatus}).`,
      currentStatus === "held" ? "Status already correct." : `Recovering ${currentStatus ?? "NULL"} -> held.`,
      facts.captureBefore
        ? `True deadline ${facts.captureBefore}${facts.extendedAuthStatus ? ` (extended_auth=${facts.extendedAuthStatus})` : ""}.`
        : "Stripe has published no capture_before — stored expiry left untouched (never guessed).",
      unknownExpiry ? "STILL INVISIBLE to the refresh cron: expiry unknown." : "",
    ].filter(Boolean);

    if (opts.dryRun) {
      return {
        unknownExpiry,
        finding: finding(rental, cohort, changed ? "corrected" : "confirmed", noteBits.join(" "), {
          to_status: "held",
          stripe_pi_status: piStatus,
          expires_at_after: (patch.deposit_hold_expires_at as string | undefined) ?? rental.deposit_hold_expires_at ?? null,
        }),
      };
    }

    const applied = await casUpdateRental(supabase, rental.id, currentStatus, probedPiId, patch);
    if (!applied) {
      return { finding: finding(rental, cohort, "lost_race", "Row changed between read and write.") };
    }

    if (changed) {
      await recordLink(supabase, {
        rental_id: rental.id,
        tenant_id: rental.tenant_id,
        attempt_seq: attemptSeq,
        action: "backfill:held",
        payment_intent_id: probedPiId,
        platform_account: rental.platform_account,
        connect_account_id: ctx.connectAccountId,
        stripe_mode: ctx.mode,
        amount_cents: amountCapturable,
        currency: piCurrency,
        capture_before: facts.captureBefore,
        extended_auth_status: facts.extendedAuthStatus,
        card_funding: facts.cardFunding,
        outcome: "succeeded",
        error_message: `Backfill: Stripe reports ${piStatus}; ${currentStatus ?? "NULL"} -> held`,
        completed_at: nowIso,
      });
      console.warn(
        "[HOLD-BACKFILL] LIVE authorisation recovered on rental", rental.id,
        `${currentStatus ?? "NULL"} -> held; expires`,
        facts.captureBefore ?? "(unchanged — Stripe published no deadline)"
      );
    }

    return {
      unknownExpiry,
      finding: finding(rental, cohort, changed ? "corrected" : "confirmed", noteBits.join(" "), {
        to_status: "held",
        stripe_pi_status: piStatus,
        expires_at_after: (patch.deposit_hold_expires_at as string | undefined) ?? rental.deposit_hold_expires_at ?? null,
      }),
    };
  }

  // ═══ The authorisation is conclusively NOT live ════════════════════════

  // Cohort E special case: the status is already NULL — which is the state the
  // placement paths want, and which correctly claims nothing. The only lie is the
  // orphaned deposit_hold_expires_at that place-deposit-hold's error path left
  // behind. Clear THAT and nothing else.
  //
  // We deliberately do not promote NULL to 'expired' here: NULL is what every
  // placement path treats as "no hold, go ahead", and moving a rental into a
  // status branch the portal renders differently is a UI change, not a backfill.
  // Clearing a timestamp Stripe has just disproven is pure fact.
  if (currentStatus === null) {
    if (!rental.deposit_hold_expires_at) {
      return {
        finding: finding(rental, cohort, "confirmed", `Stripe reports '${piStatus}'; status already NULL with no expiry.`, {
          stripe_pi_status: piStatus,
        }),
      };
    }
    const note = `Stripe reports '${piStatus}' — the stored expiry ${rental.deposit_hold_expires_at} is an orphan left by a failed placement; clearing it.`;
    if (opts.dryRun) {
      return {
        finding: finding(rental, cohort, "corrected", note, {
          stripe_pi_status: piStatus,
          expires_at_after: null,
        }),
      };
    }
    const applied = await casUpdateRental(supabase, rental.id, null, probedPiId, {
      deposit_hold_expires_at: null,
      deposit_hold_expiry_source: null,
      deposit_hold_window_seconds: null,
      deposit_hold_verified_at: nowIso,
    });
    if (!applied) {
      return { finding: finding(rental, cohort, "lost_race", "Row changed between read and write.") };
    }
    await recordLink(supabase, {
      rental_id: rental.id,
      tenant_id: rental.tenant_id,
      attempt_seq: attemptSeq,
      action: "backfill:clear_orphan_expiry",
      payment_intent_id: probedPiId,
      platform_account: rental.platform_account,
      connect_account_id: ctx.connectAccountId,
      stripe_mode: ctx.mode,
      currency: piCurrency,
      outcome: "succeeded",
      error_message: `Backfill: Stripe reports ${piStatus}; cleared orphaned deposit_hold_expires_at on a NULL-status rental`,
      completed_at: nowIso,
    });
    console.warn("[HOLD-BACKFILL] Cleared orphaned expiry on rental", rental.id, `(PI ${probedPiId} is ${piStatus})`);
    return {
      finding: finding(rental, cohort, "corrected", note, { stripe_pi_status: piStatus, expires_at_after: null }),
    };
  }

  // Already agrees with Stripe: stamp the freshness heartbeat only, so silence is
  // not mistaken for "nobody has ever looked at this".
  if (currentStatus === trueStatus) {
    const note = `Stripe confirms '${piStatus}' — database already correct.`;
    if (opts.dryRun) {
      return { finding: finding(rental, cohort, "confirmed", note, { stripe_pi_status: piStatus, to_status: trueStatus }) };
    }
    await casUpdateRental(supabase, rental.id, currentStatus, probedPiId, { deposit_hold_verified_at: nowIso });
    return { finding: finding(rental, cohort, "confirmed", note, { stripe_pi_status: piStatus, to_status: trueStatus }) };
  }

  const patch: Record<string, unknown> = {
    deposit_hold_status: trueStatus,
    deposit_hold_status_changed_at: nowIso,
    deposit_hold_verified_at: nowIso,
  };
  if (!rental.deposit_hold_connect_account_id && ctx.connectAccountId) {
    patch.deposit_hold_connect_account_id = ctx.connectAccountId;
  }
  if (!rental.deposit_hold_stripe_mode) patch.deposit_hold_stripe_mode = ctx.mode;
  if (piCurrency && piCurrency !== rental.deposit_hold_currency) patch.deposit_hold_currency = piCurrency;

  const lastError = intent.last_payment_error?.message ?? null;
  const lastErrorCode = intent.last_payment_error?.code ?? intent.last_payment_error?.decline_code ?? null;
  if (trueStatus === "expired" || trueStatus === "failed" || trueStatus === "requires_action") {
    if (lastError) patch.deposit_hold_last_error = lastError;
    if (lastErrorCode) patch.deposit_hold_last_error_code = lastErrorCode;
  }
  // trueStatus === 'captured' deliberately gets NO extra fields, and NO payments
  // row: backfilling `payments` keyed on a deposit-hold PaymentIntent arms the
  // rental-cancellation path in stripe-webhook-*. Payments rows are written
  // exclusively by capture-deposit-hold, which is also the only thing that knows
  // the captured amount.

  const note = `Stripe reports '${piStatus}' — correcting ${currentStatus} -> ${trueStatus}.`;

  if (opts.dryRun) {
    return {
      finding: finding(rental, cohort, "corrected", note, { stripe_pi_status: piStatus, to_status: trueStatus }),
    };
  }

  const applied = await casUpdateRental(supabase, rental.id, currentStatus, probedPiId, patch);
  if (!applied) {
    return { finding: finding(rental, cohort, "lost_race", "Row changed between read and write.") };
  }

  await recordLink(supabase, {
    rental_id: rental.id,
    tenant_id: rental.tenant_id,
    attempt_seq: attemptSeq,
    action: `backfill:${trueStatus}`,
    payment_intent_id: probedPiId,
    platform_account: rental.platform_account,
    connect_account_id: ctx.connectAccountId,
    stripe_mode: ctx.mode,
    amount_cents: amountCapturable,
    currency: piCurrency,
    outcome: "succeeded",
    error_code: lastErrorCode,
    error_message: `Backfill: Stripe reports ${piStatus}; ${currentStatus} -> ${trueStatus}`,
    completed_at: nowIso,
  });

  console.warn("[HOLD-BACKFILL] Rental", rental.id, `${currentStatus} -> ${trueStatus}`, `(Stripe PI ${probedPiId} is ${piStatus})`);
  return { finding: finding(rental, cohort, "corrected", note, { stripe_pi_status: piStatus, to_status: trueStatus }) };
}

// ---------------------------------------------------------------------------
// Cohort queries
// ---------------------------------------------------------------------------

/**
 * Build the base filter for a cohort. `nowIso` is captured once per invocation so
 * every page of a cohort is evaluated against the same instant — otherwise a row
 * could sit exactly on the boundary and appear on two pages or none.
 */
function applyCohortFilter(query: any, cohort: Cohort, nowIso: string) {
  switch (cohort) {
    case "expired_terminal":
      return query.eq("deposit_hold_status", "expired");
    case "stuck_claim":
      return query.in("deposit_hold_status", ["refreshing", "processing"]);
    case "held_past_expiry":
      return query.eq("deposit_hold_status", "held").lt("deposit_hold_expires_at", nowIso);
    case "held_null_expiry":
      return query.eq("deposit_hold_status", "held").is("deposit_hold_expires_at", null);
    case "null_status_with_expiry":
      return query.is("deposit_hold_status", null).not("deposit_hold_expires_at", "is", null);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (!isServiceRoleCall(req)) {
    return errorResponse("Unauthorized", 401);
  }

  // ── Body ────────────────────────────────────────────────────────────────
  let body: any = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    body = {};
  }

  // DRY RUN IS THE DEFAULT. Only an explicit false writes anything — a missing,
  // misspelled or mistyped flag must never turn into a live money-path mutation.
  const dryRun = !(body?.dryRun === false || body?.dry_run === false);

  const tenantId =
    (typeof body?.tenantId === "string" && body.tenantId) ||
    (typeof body?.tenant_id === "string" && body.tenant_id) ||
    null;
  const onlyRentalId =
    (typeof body?.onlyRentalId === "string" && body.onlyRentalId) ||
    (typeof body?.only_rental_id === "string" && body.only_rental_id) ||
    null;

  const requestedCohorts: Cohort[] = Array.isArray(body?.cohorts)
    ? (body.cohorts as unknown[]).filter((c): c is Cohort => COHORTS.includes(c as Cohort))
    : [...COHORTS];
  if (requestedCohorts.length === 0) {
    return errorResponse(`No valid cohorts requested. Valid cohorts: ${COHORTS.join(", ")}`, 400);
  }

  const maxRentals =
    typeof body?.limit === "number" && Number.isFinite(body.limit) && body.limit > 0
      ? Math.min(Math.floor(body.limit), HARD_MAX_RENTALS)
      : DEFAULT_MAX_RENTALS;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  // Distinct job_name per shape, exactly as reconcile-deposit-holds does: a dry
  // or scoped run recorded under the same name would satisfy a dead-man check
  // ("max(finished_at) is recent") that the real sweep never ran.
  const scoped = !!(tenantId || onlyRentalId);
  const jobName = JOB_NAME + (dryRun ? ":dry-run" : "") + (scoped ? ":scoped" : "");

  const startedAt = new Date();
  const nowIso = startedAt.toISOString();
  const deadline = startedAt.getTime() + MAX_RUN_MS;

  const { data: runRow } = await supabase
    .from("cron_runs")
    .insert({ job_name: jobName, started_at: nowIso })
    .select("id")
    .maybeSingle();
  const runId = (runRow as { id?: string } | null)?.id ?? null;

  const summary: Summary = {
    examined: 0,
    corrected: 0,
    confirmed: 0,
    claimActive: 0,
    inFlight: 0,
    needsReview: 0,
    unverifiable: 0,
    unresolvable: 0,
    lostRace: 0,
    failed: 0,
    truncated: false,
    stillUnknownExpiry: 0,
    byCohort: {},
    transitions: {},
    errors: [],
  };

  const findings: Finding[] = [];
  // Declared before `finish` closes over them so a throw in the counting phase
  // does not hit the temporal dead zone and mask the real error.
  let totalDue = 0;
  const cohortCounts: Record<string, number> = {};

  const finish = async (fatal?: string) => {
    if (!runId) return;
    await supabase
      .from("cron_runs")
      .update({
        finished_at: new Date().toISOString(),
        total_due: totalDue,
        processed: summary.examined,
        succeeded: summary.corrected + summary.confirmed,
        failed: summary.failed,
        truncated: summary.truncated,
        error: fatal ?? (summary.errors.length ? summary.errors.slice(0, 10).join(" | ") : null),
      })
      .eq("id", runId);
  };

  try {
    // ── Count the whole backlog per cohort, separately from what we process ──
    // total_due > processed is then a visible, alertable signal rather than a
    // silent truncation.
    for (const cohort of requestedCohorts) {
      let countQuery: any = supabase.from("rentals").select("id", { count: "exact", head: true });
      countQuery = applyCohortFilter(countQuery, cohort, nowIso);
      if (tenantId) countQuery = countQuery.eq("tenant_id", tenantId);
      if (onlyRentalId) countQuery = countQuery.eq("id", onlyRentalId);
      const { count, error } = await countQuery;
      if (error) throw new Error(`Failed to count cohort ${cohort}: ${error.message}`);
      cohortCounts[cohort] = count ?? 0;
      totalDue += count ?? 0;
    }

    console.log(
      `[HOLD-BACKFILL] Starting ${jobName} — ${totalDue} row(s) across ${requestedCohorts.length} cohort(s): ` +
      requestedCohorts.map((c) => `${c}=${cohortCounts[c]}`).join(" ") +
      (scoped ? ` (scoped tenant=${tenantId ?? "-"} rental=${onlyRentalId ?? "-"})` : "") +
      (dryRun ? " [DRY RUN — no writes]" : " [LIVE — writing corrections]")
    );

    const tenantCache = new Map<string, TenantRow>();

    // Cohorts are mutually exclusive at any single instant, so this set is empty
    // in a dry run. In a LIVE run a correction can move a row into a cohort that
    // has not been swept yet (e.g. an 'expired' row proved alive becomes 'held',
    // and if Stripe published no capture_before its expiry stays NULL, matching
    // held_null_expiry). Re-examining is harmless but would spend a second Stripe
    // call and make `examined` exceed `totalDue`, which is the signal that says
    // "this run was truncated". Skip what we have already resolved.
    const seen = new Set<string>();

    for (const cohort of requestedCohorts) {
      if (summary.examined >= maxRentals || Date.now() > deadline) {
        summary.truncated = true;
        break;
      }

      // Keyset pagination on id. Deliberately NOT offset paging: a live run
      // writes statuses that REMOVE rows from the very filter it is paging over,
      // so every offset page would skip exactly as many rows as it corrected.
      let cursor: string | null = null;
      let drained = false;

      while (!drained && summary.examined < maxRentals) {
        if (Date.now() > deadline) {
          summary.truncated = true;
          break;
        }

        let pageQuery: any = supabase
          .from("rentals")
          .select(RENTAL_COLUMNS)
          .order("id", { ascending: true })
          .limit(PAGE_SIZE);
        pageQuery = applyCohortFilter(pageQuery, cohort, nowIso);
        if (cursor) pageQuery = pageQuery.gt("id", cursor);
        if (tenantId) pageQuery = pageQuery.eq("tenant_id", tenantId);
        if (onlyRentalId) pageQuery = pageQuery.eq("id", onlyRentalId);

        const { data: page, error: pageError } = await pageQuery;
        if (pageError) throw new Error(`Failed to query cohort ${cohort}: ${pageError.message}`);

        const fetched = (page ?? []) as unknown as RentalRow[];
        if (fetched.length === 0) break;
        if (fetched.length < PAGE_SIZE) drained = true;
        // Advance the cursor from the RAW page, before filtering — otherwise a
        // page whose rows were all already seen would rewind and loop forever.
        cursor = fetched[fetched.length - 1].id;

        const rentals = fetched.filter((r) => !seen.has(r.id));
        for (const r of rentals) seen.add(r.id);
        if (rentals.length === 0) continue;

        // Tenants for this page, one query.
        const missingTenantIds = [...new Set(rentals.map((r) => r.tenant_id))].filter((id) => !tenantCache.has(id));
        if (missingTenantIds.length > 0) {
          const { data: tenants } = await supabase
            .from("tenants")
            .select(`id, ${TENANT_STRIPE_COLUMNS}`)
            .in("id", missingTenantIds);
          for (const t of (tenants ?? []) as unknown as TenantRow[]) tenantCache.set(t.id, t);
        }

        // Liveness signal for claim states: a ledger row for this rental in the
        // last 30 minutes means a writer is genuinely mid-flight, which is
        // stronger evidence than deposit_hold_status_changed_at (NULL on every
        // legacy row). One query per page, not per rental.
        const claimRentalIds = rentals
          .filter((r) => CLAIM_STATUSES.has(r.deposit_hold_status ?? ""))
          .map((r) => r.id);
        const activeClaimIds = new Set<string>();
        if (claimRentalIds.length > 0) {
          const { data: recentLinks } = await supabase
            .from("deposit_hold_links")
            .select("rental_id")
            .in("rental_id", claimRentalIds)
            .gt("created_at", new Date(Date.now() - STUCK_CLAIM_MS).toISOString());
          for (const l of (recentLinks ?? []) as { rental_id: string }[]) activeClaimIds.add(l.rental_id);
        }

        for (let i = 0; i < rentals.length && summary.examined < maxRentals; i += CONCURRENCY) {
          if (Date.now() > deadline) {
            summary.truncated = true;
            break;
          }
          const chunk = rentals.slice(i, i + CONCURRENCY);
          const results = await Promise.all(
            chunk.map(async (rental) => {
              try {
                return await backfillRental(supabase, rental, tenantCache.get(rental.tenant_id), cohort, {
                  dryRun,
                  activeClaim: activeClaimIds.has(rental.id),
                });
              } catch (err: any) {
                // One rental's failure must never stop the others — the next row
                // may be the one whose authorisation is actually still alive.
                const message = err?.message ?? String(err);
                console.error("[HOLD-BACKFILL] Failed for rental", rental.id, message);
                summary.errors.push(`${rental.id}: ${message}`);
                return {
                  finding: finding(rental, cohort, "failed", `Threw: ${message}`),
                  unknownExpiry: false,
                };
              }
            })
          );

          for (const result of results) {
            summary.examined++;
            summary.byCohort[cohort] = (summary.byCohort[cohort] ?? 0) + 1;
            if (result.unknownExpiry) summary.stillUnknownExpiry++;

            const f = result.finding;
            switch (f.outcome) {
              case "corrected": summary.corrected++; break;
              case "confirmed": summary.confirmed++; break;
              case "claim_active": summary.claimActive++; break;
              case "in_flight": summary.inFlight++; break;
              case "needs_review": summary.needsReview++; break;
              case "unverifiable": summary.unverifiable++; break;
              case "unresolvable": summary.unresolvable++; break;
              case "lost_race": summary.lostRace++; break;
              case "failed": summary.failed++; break;
            }
            // Only status MOVES belong in the transition histogram. A correction
            // that only clears an orphaned expiry (cohort E) leaves the status
            // alone and would otherwise show up as a meaningless "NULL->NULL".
            if ((f.outcome === "corrected" || f.outcome === "needs_review") && f.to_status && f.to_status !== f.from_status) {
              const key = `${f.from_status ?? "NULL"}->${f.to_status}`;
              summary.transitions[key] = (summary.transitions[key] ?? 0) + 1;
            }
            // Everything except a clean confirmation is worth an operator's eyes.
            if (f.outcome !== "confirmed" && findings.length < MAX_REPORTED_FINDINGS) {
              findings.push(f);
            }
          }
        }
      }
    }

    if (summary.examined < totalDue) summary.truncated = true;

    console.log(
      `[HOLD-BACKFILL] Complete (${dryRun ? "DRY RUN" : "LIVE"}). examined=${summary.examined}/${totalDue} ` +
      `corrected=${summary.corrected} confirmed=${summary.confirmed} needsReview=${summary.needsReview} ` +
      `unverifiable=${summary.unverifiable} unresolvable=${summary.unresolvable} inFlight=${summary.inFlight} ` +
      `claimActive=${summary.claimActive} lostRace=${summary.lostRace} failed=${summary.failed} ` +
      `stillUnknownExpiry=${summary.stillUnknownExpiry} truncated=${summary.truncated}`
    );

    await finish();

    return jsonResponse({
      success: true,
      job: jobName,
      dryRun,
      // Loud enough that nobody mistakes a rehearsal for the real thing.
      mode: dryRun ? "DRY RUN — nothing was written. Re-send with {\"dryRun\": false} to apply." : "LIVE — corrections applied",
      scope: { tenantId, onlyRentalId, cohorts: requestedCohorts, limit: maxRentals },
      totalDue,
      cohortCounts,
      ...summary,
      findingsTruncated: findings.length >= MAX_REPORTED_FINDINGS,
      findings,
      errors: summary.errors.slice(0, 25),
    });
  } catch (error: any) {
    console.error("[HOLD-BACKFILL] Fatal error:", error);
    await finish(error?.message ?? String(error));
    return errorResponse(error?.message ?? "Backfill failed", 500);
  }
});
