// The chained-hold refresh ENGINE — one authorization link at a time.
//
// WHY THIS FILE EXISTS
// A card authorization can never outlive the network's ceiling (Visa is exactly
// 29d18h card-present-style; the card-absent merchant-initiated window is
// 4d18h, and GMT's live Connect account — acct_1SrIFEPcUIaEGCY0 — is not
// approved for extended authorization at all, so it lands on the ~5-7 day
// network default). A 90-120 day rental therefore needs a CHAIN of 4-18 links:
// cancel the incumbent authorization and place a replacement on the saved card
// before the incumbent dies. The engineering problem is not the length of one
// hold, it is the RELIABILITY OF EACH LINK — one bad night used to end a chain
// permanently and silently ("I cannot refresh the hold. This is affecting our
// day to day business" — GMT, Aug 2026).
//
// It also exists because `refresh-deposit-holds` and
// `sandbox-refresh-deposit-holds` were hand-maintained verbatim FORKS. The
// sandbox ("Time Machine") is the de-facto verification path for this code, so
// a fork means staging green-lights logic production no longer runs. Both
// drivers now import `refreshOneHold` from here; the sandbox keeps only its
// three genuine differences (fail-closed scoping, tenant lock, preview).
//
// The defects this engine was written to kill, all verified against the old
// forked code:
//   1. Every throw — including throws that happened BEFORE Stripe was ever
//      contacted, e.g. the tenants lookup — landed in one catch that wrote
//      terminal 'expired'. The driver selected only 'held', so the rental was
//      never looked at again. No alert, no retry, no backoff.
//   2. The idempotency key embedded the OLD payment-intent id, which the
//      failure path never updated, so a retry inside Stripe's 24h window
//      replayed the cached decline verbatim.
//   3. `deposit_hold_payment_method_id` was reused verbatim for the whole
//      rental. Over 90 days, crossing a card expiry is a base-rate event.
//   4. Currency was read from the CURRENT tenant row while the platform
//      account was record-anchored (UK->UAE migration).
//   5. Every write was a bare `.eq('id', …)` that discarded its `{ error }`, so
//      a rental released or captured mid-loop was silently re-authorized.
//   6. The auto-extend "release instead of refresh" branch ran AFTER the
//      unconditional cancel — i.e. "destroy, then record that we released".
//
// And two the FIRST version of this engine introduced, caught in review:
//   7. Widening the driver to `deposit_hold_status IN ('held','failed')` swept
//      up the 'failed' rows the Stripe webhooks write when the FIRST placement
//      of a brand-new hold fails. Those have no PaymentIntent and no amount, so
//      the zero-amount branch would have rewritten them as 'released' across
//      all 28 tenants on the first cron tick. See HOLD_HISTORY_PREDICATE and
//      the hasHoldHistory gate.
//   8. `deposit_hold_attempt_seq` is in the idempotency key, so a retry can
//      never replay the previous key. A create that SUCCEEDED at Stripe but
//      whose response was lost would therefore be re-attempted under a fresh
//      key — a second live authorization on the renter's card, with the first
//      invisible forever. See findLiveDepositIntent.
//   9. `deposit_hold_chain_expires_at` was treated as a hard stop in BOTH the
//      driver predicate and the engine, but it is written once at placement from
//      an `end_date` snapshot. Extending a rental moved end_date and left the
//      bound frozen, so the chain terminated on the ORIGINAL end date and the
//      deposit silently stopped being renewed while the car was still out — for
//      a manually-extended fleet, every rental. The bound is now RECOMPUTED from
//      the live end_date on every pass and the column is a cache. See
//      resolveChainBound.
//
// FAIL SAFE, NEVER OPEN: whenever Stripe cannot be consulted conclusively we
// keep treating the incumbent hold as LIVE rather than putting a second
// authorization on a renter's card.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import {
  getConnectAccountId,
  getStripeClientForRecord,
  createDepositHoldIntentWithFallback,
  validateStripeCustomerId,
  chainExpiryFromEndDate,
  CHAIN_GRACE_DAYS_AFTER_END,
  TENANT_STRIPE_COLUMNS,
  type StripeMode,
} from "./stripe-client.ts";
import {
  notifyDepositHoldFailure,
  notifyDepositHoldOrphanedAuthorization,
  type DepositHoldMoneyState,
} from "./deposit-hold-notify.ts";

type Stripe = ReturnType<typeof getStripeClientForRecord>;
type StripeOptions = { stripeAccount?: string } | undefined;

// ---------------------------------------------------------------------------
// Driver query — shared so production and the sandbox can never drift.
// ---------------------------------------------------------------------------

/**
 * Every column `refreshOneHold` reads. Both drivers select exactly this.
 *
 * NOTE: this is a PostgREST column list, not SQL — no comments, no whitespace
 * tricks beyond newlines.
 *
 * `deposit_hold_platform_account` is load-bearing and was MISSING here, which
 * caused a live `account_invalid`: the connect-account and mode anchors were
 * selected and honoured, but without the platform anchor refreshOneHold fell
 * back to `rentals.platform_account` for the Stripe KEYS while still targeting
 * the hold's connected ACCOUNT. Stripe rejects that pair outright. Any anchor
 * added to the schema must be added here too or it silently does nothing.
 */
export const HOLD_REFRESH_COLUMNS = `
  id, tenant_id, customer_id, status,
  end_date,
  auto_extend_enabled,
  platform_account,
  deposit_hold_payment_intent_id,
  deposit_hold_amount,
  deposit_hold_payment_method_id,
  deposit_hold_stripe_customer_id,
  deposit_hold_expires_at,
  deposit_hold_placed_at,
  deposit_hold_status,
  deposit_hold_attempt_seq,
  deposit_hold_failure_count,
  deposit_hold_connect_account_id,
  deposit_hold_stripe_mode,
  deposit_hold_platform_account,
  deposit_hold_currency,
  deposit_hold_chain_expires_at
`;

/**
 * Rental lifecycle states that END a deposit chain — a DENY list, not an allow
 * list.
 *
 * This used to be `REFRESHABLE_RENTAL_STATUSES = ['Active','Pending']`. The live
 * `rentals_status_check` in the oldest schema dump permits Pending / Active /
 * Closed / Rejected / Cancelled, but the rest of the repo demonstrably deals in
 * a WIDER vocabulary — `apps/booking/src/lib/vehicle-availability.ts` and both
 * `use-vehicle-booked-dates` hooks list Pending/Active/Upcoming/Confirmed/
 * Started, and the 2026-03-17 notification migrations key off 'Started' and
 * 'Quoted'. An allow list therefore has a silent-death mode that is exactly what
 * this workstream exists to kill: a rental that moves into a status nobody
 * enumerated becomes invisible to the driver AND loses the claim CAS, so every
 * remaining link of its chain never happens and nothing says so.
 *
 * Inverting it means an unknown status keeps the chain ALIVE (safe: the worst
 * case is one more authorization on a card that is already authorized) while
 * only unambiguously finished rentals stop it.
 */
export const TERMINAL_RENTAL_STATUSES = [
  "Closed",
  "Completed",
  "Cancelled",
  // US spelling — inshur-reconcile treats both as terminal, so both exist in
  // somebody's data.
  "Canceled",
  "Rejected",
] as const;

/** PostgREST list literal for the deny list, e.g. `(Closed,Completed,…)`. */
const TERMINAL_RENTAL_STATUS_LIST = `(${TERMINAL_RENTAL_STATUSES.join(",")})`;

/**
 * Hold states the driver picks up.
 *
 * 'failed' is in here deliberately: under the old engine failure was terminal
 * ('expired', never re-selected). 'failed' now means "recoverable — retry after
 * deposit_hold_next_retry_at". Everything else is either mid-flight and owned
 * by another worker ('processing', 'refreshing', 'capturing'), waiting on a
 * human ('requires_action', 'needs_review', 'disputed') or finished
 * ('captured', 'released', 'expired').
 *
 * NOT every 'failed' row qualifies — see HOLD_HISTORY_PREDICATE.
 */
export const REFRESHABLE_HOLD_STATUSES = ["held", "failed"] as const;

/**
 * "This rental once carried a REAL authorization."
 *
 * `deposit_hold_status = 'failed'` has TWO producers with opposite meanings:
 *
 *   a) this engine, after a chain link failed to place its replacement. The
 *      renter WAS secured a moment ago, `deposit_hold_placed_at` is set from the
 *      original placement, and retrying is exactly right.
 *   b) `stripe-webhook-live/index.ts` and `stripe-webhook-test/index.ts`, which
 *      write `{ deposit_hold_status: 'failed' }` gated on
 *      `.is('deposit_hold_status', null)` when the FIRST auto-placement of a
 *      brand-new hold fails. place-deposit-hold's `releaseClaim()` resets the
 *      status to NULL on every failure path but has already burned an
 *      attempt_seq, so these rows carry attempt_seq >= 1 with NO PaymentIntent,
 *      NO deposit_hold_amount and NO deposit_hold_placed_at. They mean "we never
 *      managed to take this renter's deposit" and the refresh engine has no
 *      business touching them — it chains authorizations, it does not place
 *      first holds.
 *
 * Without this predicate the first production cron tick after deploy would have
 * selected every (b) row across all 28 tenants, computed amountCents = 0 from the
 * NULL amount, taken the "nothing to re-authorize" release branch and written
 * `deposit_hold_status = 'released'` on rentals that never had a hold —
 * destroying the 'Hold failed' signal the portal renders and removing the rows
 * from the reconciler's non-terminal sweep. attempt_seq is NOT a usable
 * discriminator (see (b) above); a persisted PaymentIntent or a
 * `deposit_hold_placed_at` stamp is, because both are only ever written after
 * Stripe confirmed an authorization.
 */
// PostgREST syntax note: both idioms used here have production precedent in
// this repo — `col.not.is.null` inside `.or()` (reminders-generate/index.ts:288,
// apps/portal insurances pages) and `and(...)` groups inside `.or()`
// (reminders-digest/index.ts:58). Written as sibling `and(...)` groups rather
// than a nested `or(...)` to keep it two levels deep.
const HOLD_HISTORY_PREDICATE = [
  "deposit_hold_status.eq.held",
  "and(deposit_hold_status.eq.failed,deposit_hold_payment_intent_id.not.is.null)",
  "and(deposit_hold_status.eq.failed,deposit_hold_placed_at.not.is.null)",
].join(",");

/** How far ahead of the REAL Stripe deadline we re-authorize. */
export const DEFAULT_LOOKAHEAD_DAYS = 2;

/** Max rentals one invocation will touch. See the batch note in the drivers. */
export const DEFAULT_BATCH_LIMIT = 25;

// ---------------------------------------------------------------------------
// The chain bound — DERIVED here, never trusted from the row.
//
// `rentals.deposit_hold_chain_expires_at` is written ONCE, by place-deposit-hold,
// from the `end_date` as it stood at placement. `rentals.end_date` moves every
// time a rental is extended and an extension does NOT re-place the hold, so a
// frozen bound terminates the chain on the ORIGINAL end date and the deposit
// quietly stops being renewed while the car is still out — the exact silent
// death this engine exists to prevent, and near-certain for a fleet that is
// manually extended (GMT).
//
// verify-deposit-hold re-stamps the column forward, but only when somebody
// happens to call verify. So the fix belongs at the AUTHORITATIVE READER: this
// engine recomputes the bound from the rental's CURRENT end_date on every pass
// and only stops when the RECOMPUTED bound has genuinely passed. The stored
// column stays as a cache/diagnostic and is refreshed (forward only) whenever
// the recomputation moves it.
//
// The grace window itself is `CHAIN_GRACE_DAYS_AFTER_END` in
// `_shared/stripe-client.ts` — ONE named constant, imported by this file and by
// place-deposit-hold so the two derivations can never drift. Its VALUE (3 days)
// is a PRODUCT DECISION THAT HAS NOT BEEN FORMALLY MADE: how long after handback
// an operator may still authorise against a renter's card is a business call.
// It is a deliberately conservative placeholder, not ratified policy.
// ---------------------------------------------------------------------------

/** A `rentals` row as the drivers select it (HOLD_REFRESH_COLUMNS). */
// deno-lint-ignore no-explicit-any
export type RentalRow = Record<string, any>;

export interface ChainBound {
  /**
   * The bound we actually enforce: the LATER of the stored cache and the bound
   * implied by the rental's live `end_date`. `null` means "no ceiling".
   */
  effective: string | null;
  /** What the row was carrying. */
  stored: string | null;
  /**
   * What the rental's CURRENT `end_date` implies — `null` for an open-ended
   * rental, and also `null` when the caller did not select `end_date` at all.
   */
  live: string | null;
  /** True when the stored cache is behind `effective` and should be re-stamped. */
  stale: boolean;
  /** True when `effective` has genuinely passed. */
  expired: boolean;
}

/**
 * Resolve a rental's deposit-chain bound from the row PLUS its live end date.
 *
 * Two rules, both load-bearing:
 *
 *  1. LATER OF THE TWO, not "the live one wins". place-deposit-hold deliberately
 *     floors the bound at now + grace when a hold is placed on a rental that is
 *     ALREADY past its end date (routine: staff hold a deposit late on an
 *     overdue or extended rental). Letting a live derivation pull the bound back
 *     IN would kill that hold at its first link, ~4 days later, in silence.
 *     Moving the bound OUT is always safe — the rental lifecycle deny list, the
 *     amount/auto-extend release branches and the operator's own release remain
 *     the other stops. This matches verify-deposit-hold's forward-only re-stamp.
 *
 *  2. ONLY A NULL/UNREADABLE **LIVE** SIDE MEANS "NO CEILING" — that is a
 *     genuinely open-ended rental (end_date IS NULL), where any ceiling would
 *     be invented.
 *
 *  2b. A NULL/unreadable STORED cache SEEDS from the live end_date instead,
 *     floored at now + grace. This previously also meant "no ceiling", to avoid
 *     mass-terminating chains on the first run after deploy — but measured
 *     against production the seed terminates ZERO rows, while the old reading
 *     left every unstamped hold re-authorising a renter's card indefinitely
 *     after the car came back. For a mechanism that exists to stay inside
 *     card-network rules, unbounded is the wrong direction to fail. The floor
 *     keeps a hold placed onto an already-ended rental from dying at its first
 *     link; see the inline note for why it cannot make the chain immortal.
 *
 * `end_date === undefined` is NOT the same fact as `end_date === null`: it means
 * the caller never selected the column. Guessing "open-ended" from an absent
 * column would silently disable the ceiling for that caller, so we fall back to
 * the stored cache alone.
 */
export function resolveChainBound(rental: RentalRow, now: Date = new Date()): ChainBound {
  const stored = (rental.deposit_hold_chain_expires_at as string | null) ?? null;
  const storedMs = stored ? new Date(stored).getTime() : Number.NaN;
  const storedOk = Number.isFinite(storedMs);

  // Distinguish "not selected" from "open-ended" BEFORE deriving anything.
  const endDateSelected = rental.end_date !== undefined;
  const live = endDateSelected ? chainExpiryFromEndDate(rental.end_date as string | null) : null;
  const liveMs = live ? new Date(live).getTime() : Number.NaN;
  const liveOk = Number.isFinite(liveMs);

  const noCeiling: ChainBound = { effective: null, stored, live, stale: false, expired: false };

  // The caller never asked for end_date, so the cache is the best (and only)
  // information there is. Honour it as-is: this is the pre-recomputation
  // behaviour, and it is the right answer for a caller that has nothing better.
  if (!endDateSelected) {
    if (!storedOk) return noCeiling;
    return { effective: stored, stored, live, stale: false, expired: storedMs <= now.getTime() };
  }

  // Rule 2: an unreadable LIVE side means "no ceiling" — that is a genuinely
  // open-ended rental (end_date IS NULL), and inventing a ceiling for it would
  // be a guess.
  if (!liveOk) return noCeiling;

  // Rule 2b: a NULL/unreadable STORED cache is NOT "open-ended" — it is simply
  // a row written before this column existed, or by one of the three paths that
  // mint 'held' without stamping it. We know the rental's real end date, so use
  // it.
  //
  // This used to fall through to `noCeiling`, on the rationale that inventing a
  // ceiling would mass-terminate chains on the first run after deploy. Measured
  // against production that rationale does not hold: the seed terminates ZERO
  // rows today, while the old behaviour left every unstamped hold with NO
  // ceiling at all — re-authorising a renter's card indefinitely, weeks after
  // the car came back. For a mechanism whose entire purpose is to stay inside
  // card-network rules, unbounded is the wrong direction to fail.
  //
  // FLOORED at now + grace, and this floor is load-bearing. place-deposit-hold
  // applies the same floor when a hold is placed on an ALREADY-ended rental
  // (routine: staff hold a deposit late on an overdue or extended booking), but
  // it only ever lands in the stored column. Without the floor here, a hold
  // synced onto a rental that ended last week would be born with a bound
  // already in the past and die at its first link, in silence — precisely the
  // harm Rule 1 exists to prevent, just relocated.
  //
  // It cannot make the chain immortal: it fires only while `stored` is NULL,
  // and the value is persisted under the claim CAS on the next pass, after
  // which Rule 1 governs and extensions move the bound forward normally.
  if (!storedOk) {
    const seedMs = Math.max(liveMs, now.getTime() + CHAIN_GRACE_DAYS_AFTER_END * 86_400_000);
    return {
      effective: new Date(seedMs).toISOString(),
      stored,
      live,
      stale: true,
      expired: false,
    };
  }

  // Rule 1: the LATER of the two.
  const effectiveMs = Math.max(storedMs, liveMs);
  return {
    effective: new Date(effectiveMs).toISOString(),
    stored,
    live,
    stale: liveMs > storedMs,
    expired: effectiveMs <= now.getTime(),
  };
}

/**
 * The earliest `end_date` whose derived bound can still be in the future, as a
 * date literal for PostgREST.
 *
 * Mirrors `chainExpiryFromEndDate`: the bound is the END of the last rental day
 * plus the grace window, so `bound > now` holds for every `end_date` on or after
 * `now - grace days`. Coarse by one day at the edges, deliberately — this is a
 * pre-filter, `resolveChainBound` is the authority, and over-selecting by a day
 * costs one extra row read while under-selecting would drop a live chain.
 */
function chainCutoffDate(now: Date): string {
  return new Date(now.getTime() - CHAIN_GRACE_DAYS_AFTER_END * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Apply the "due for a refresh" predicate to a select/count builder.
 *
 * Two filters are written as PostgREST `.or()` because the plain comparison is
 * NULL-blind:
 *   * `deposit_hold_expires_at` — `.lt()` against NULL evaluates to NULL, not
 *     true, so rows whose expiry we never learned (or that we deliberately
 *     cleared after a failed link) were INVISIBLE to the old driver forever.
 *     A NULL expiry means "we do not know it is alive" and must sort FIRST.
 *   * `deposit_hold_next_retry_at` — NULL means "no backoff pending".
 * `.or()` is safe on `.select()`; it is NOT safe on `.update()` (PostgREST
 * mis-qualifies the column and errors with "column rentals.deposit_hold_status
 * does not exist"), which is why every write below branches instead.
 */
export function applyDueHoldFilters<T>(
  query: T,
  opts: { lookaheadDays?: number; now?: Date } = {}
): T {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const threshold = new Date(now.getTime() + (opts.lookaheadDays ?? DEFAULT_LOOKAHEAD_DAYS) * 86_400_000).toISOString();

  // deno-lint-ignore no-explicit-any
  let q: any = query;
  q = q
    // Rental lifecycle: a DENY list, and NULL-safe. `status` is nullable
    // (DEFAULT 'Active', and the CHECK constraint passes NULL), and a NULL
    // status must not be able to end a chain either.
    .or(`status.is.null,status.not.in.${TERMINAL_RENTAL_STATUS_LIST}`)
    // Hold state: 'held', plus only those 'failed' rows that evidence a real
    // prior authorization. See HOLD_HISTORY_PREDICATE.
    .or(HOLD_HISTORY_PREDICATE)
    .or(`deposit_hold_expires_at.is.null,deposit_hold_expires_at.lt.${threshold}`)
    .or(`deposit_hold_next_retry_at.is.null,deposit_hold_next_retry_at.lte.${nowIso}`)
    // I9 / EC-25: never re-authorize past the end of the chain. Enforced here so
    // a chain-expired rental cannot sit at the head of the queue (it has the
    // oldest expiry) and starve the batch, and again — authoritatively — inside
    // refreshOneHold.
    //
    // FOUR terms in ONE .or(), not two .or() calls: successive .or() calls are
    // AND-ed, and this has to be a single disjunction. It is the SQL shadow of
    // resolveChainBound's "later of the two" rule — a row survives if the stored
    // cache says the chain is alive OR the rental's LIVE end_date does. Filtering
    // on the stored column alone (what this used to do) meant an extended rental
    // whose bound was frozen at its ORIGINAL end date was never even SELECTED, so
    // the authoritative recomputation below could never run and the chain died
    // silently — the defect this pass exists to close.
    .or(
      [
        "deposit_hold_chain_expires_at.is.null",
        `deposit_hold_chain_expires_at.gt.${nowIso}`,
        "end_date.is.null",
        `end_date.gte.${chainCutoffDate(now)}`,
      ].join(",")
    );
  return q as T;
}

// ---------------------------------------------------------------------------
// Error taxonomy (defect 1)
// ---------------------------------------------------------------------------

export type FailureClass = "transient" | "funds" | "sca" | "dead_card" | "ambiguous";

/**
 * Stripe's own guidance: "We recommend a maximum of eight retries… issuers
 * might see additional retries as potential fraud." Past this the chain stops
 * and asks for a human instead of hammering the issuer.
 */
export const MAX_HOLD_ATTEMPTS = 8;

/** Infra / issuer-timeout style problems. Cheap to retry, no issuer decline. */
const TRANSIENT_CODES = new Set([
  "processing_error",
  "issuer_not_available",
  "reenter_transaction",
  "approve_with_id",
  "try_again_later",
  "rate_limit",
  "lock_timeout",
  "api_connection_error",
  "api_error",
  "temporary_failure",
  // OUR database, not Stripe's. casUpdate tags its throws with this so a
  // momentary PostgREST/Postgres blip takes the ordinary 6h/24h/72h ladder as
  // 'failed'. Left untagged it fell through to 'ambiguous' -> 'needs_review'
  // with next_retry_at NULL, i.e. a transport hiccup silently retired the
  // rental from the retry loop — the precise failure mode this engine exists to
  // eliminate, and 'needs_review' has no notification wired to it yet.
  "db_write_failed",
]);

/** Real declines about money. Retrying fast just burns issuer goodwill. */
const FUNDS_CODES = new Set([
  "insufficient_funds",
  "withdrawal_count_limit_exceeded",
  "card_velocity_exceeded",
  // Soft issuer declines: the card is fine and the money may well be there, the
  // issuer just said no to THIS request. Stripe's own advice is to try again
  // later, so they take the SAME long ladder as a funds decline. They must not
  // fall through to 'ambiguous' — do_not_honor/generic_decline are the two most
  // common declines in existence, and a dead-end 'needs_review' on either would
  // end most chains on a routine hiccup.
  "generic_decline",
  "do_not_honor",
  "call_issuer",
  "transaction_not_allowed",
  "service_not_allowed",
  // A decline Stripe gave us no decline_code for. stripeErrorCode() prefers
  // decline_code, so this only matches the bare case — the specific hard
  // declines (lost_card, stolen_card, …) are already routed to dead_card above.
  "card_declined",
]);

/** The card itself is gone. Re-resolve the payment method, once. */
const DEAD_CARD_CODES = new Set([
  "expired_card",
  "lost_card",
  "stolen_card",
  "pickup_card",
  "restricted_card",
  "resource_missing",
]);

/** Backoff ladders, indexed by prior failure count. */
const TRANSIENT_BACKOFF_HOURS = [6, 24, 72];
const FUNDS_BACKOFF_HOURS = [24, 72, 72];

// deno-lint-ignore no-explicit-any
function stripeErrorCode(err: any): string {
  return String(
    err?.decline_code ??
      err?.raw?.decline_code ??
      err?.code ??
      err?.raw?.code ??
      err?.type ??
      err?.raw?.type ??
      "unknown"
  );
}

/**
 * Classify a Stripe failure. Anything we cannot place goes to 'ambiguous' ->
 * 'needs_review', NOT to a terminal status: writing 'expired' because our own
 * code threw is precisely how chains died silently.
 */
// deno-lint-ignore no-explicit-any
export function classifyStripeFailure(err: any): FailureClass {
  const status = Number(err?.statusCode ?? err?.raw?.statusCode ?? err?.status ?? 0);
  const type = String(err?.type ?? err?.raw?.type ?? "");
  const code = stripeErrorCode(err);

  // Network / rate limit / Stripe 5xx: never the customer's fault.
  if (status === 429 || status >= 500) return "transient";
  if (type === "StripeConnectionError" || type === "StripeAPIError") return "transient";
  if (err instanceof TypeError && /fetch|network/i.test(String(err?.message))) return "transient";

  if (code === "authentication_required" || code === "payment_intent_authentication_failure") return "sca";
  if (FUNDS_CODES.has(code)) return "funds";
  if (DEAD_CARD_CODES.has(code)) return "dead_card";
  if (TRANSIENT_CODES.has(code)) return "transient";

  return "ambiguous";
}

/**
 * When to try this rental again.
 *
 * `expiresAt` is the deadline the row carried when the attempt STARTED. For
 * non-funds failures we clamp the backoff to an hour before it, floored at
 * now+30min.
 *
 * Be precise about what that buys, because the obvious reading is wrong: by the
 * time `recordFailure` runs, the incumbent has already been cancelled, so this
 * is NOT "one last swing before the authorization dies". What it actually does
 * is stop a rental that WAS due imminently from being parked for 72h while it
 * sits unsecured — the sooner-of-the-two is simply the more urgent retry, and
 * the clamp can only ever shorten. It is load-bearing for the callers that fail
 * BEFORE the cancel (the outer catch can be reached from the pre-cancel paths),
 * where the incumbent genuinely is still live.
 *
 * We deliberately do NOT clamp funds declines: those must respect the long
 * ladder so we are not re-presenting a declined card every half hour.
 */
export function computeRetryAt(
  failureClass: FailureClass,
  priorFailureCount: number,
  expiresAt: string | null,
  now: Date = new Date()
): string {
  const ladder = failureClass === "funds" ? FUNDS_BACKOFF_HOURS : TRANSIENT_BACKOFF_HOURS;
  const hours = ladder[Math.min(priorFailureCount, ladder.length - 1)];
  let candidate = new Date(now.getTime() + hours * 3_600_000);

  if (failureClass !== "funds" && expiresAt) {
    const deadline = new Date(expiresAt).getTime();
    if (Number.isFinite(deadline)) {
      // An hour before the deadline the row carried, and never sooner than 30
      // minutes from now (the floor keeps a hard-down Stripe from turning into
      // a hot loop).
      const lastChance = Math.max(now.getTime() + 1_800_000, deadline - 3_600_000);
      if (candidate.getTime() > lastChance) candidate = new Date(lastChance);
    }
  }
  return candidate.toISOString();
}

// ---------------------------------------------------------------------------
// Expiry provenance (defect 8)
// ---------------------------------------------------------------------------

/**
 * Conservative fallback window when Stripe has not published a deadline.
 *
 * NOT the 7 days `_shared/stripe-client.ts:resolveHoldExpiry` assumes. Visa's
 * card-absent MERCHANT-INITIATED window is 4d18h, so a 7-day guess plus the
 * 2-day lookahead means the row is first examined AFTER the authorization has
 * already died — the row says 'held', the money is back with the renter, and
 * nothing ever notices. 4 days sits safely inside 4d18h, and
 * `deposit_hold_expiry_source = 'fallback'` records that the value is a guess
 * so the reconciler and the operator panel can tell it apart from the truth.
 */
export const FALLBACK_HOLD_WINDOW_DAYS = 4;

export interface HoldWindow {
  expiresAt: string;
  source: "stripe_capture_before" | "fallback";
  windowSeconds: number | null;
  extendedAuthStatus: string | null;
  captureBefore: string | null;
  cardFunding: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
}

/** Read the REAL deadline (and card identity) off the authorising charge. */
async function readHoldWindow(
  stripe: Stripe,
  // deno-lint-ignore no-explicit-any
  intent: any,
  stripeOptions: StripeOptions,
  now: Date
): Promise<HoldWindow> {
  const fallback = (): HoldWindow => ({
    expiresAt: new Date(now.getTime() + FALLBACK_HOLD_WINDOW_DAYS * 86_400_000).toISOString(),
    source: "fallback",
    windowSeconds: null,
    extendedAuthStatus: null,
    captureBefore: null,
    cardFunding: null,
    cardBrand: null,
    cardLast4: null,
  });

  try {
    const latestCharge = intent?.latest_charge;
    // deno-lint-ignore no-explicit-any
    let charge: any = latestCharge && typeof latestCharge === "object" ? latestCharge : null;
    if (!charge && typeof latestCharge === "string") {
      charge = await stripe.charges.retrieve(latestCharge, stripeOptions);
    }
    const card = charge?.payment_method_details?.card;
    const captureBefore = card?.capture_before;
    const base = fallback();
    base.cardFunding = card?.funding ?? null;
    base.cardBrand = card?.brand ?? null;
    base.cardLast4 = card?.last4 ?? null;
    base.extendedAuthStatus = card?.extended_authorization?.status ?? null;

    if (typeof captureBefore === "number" && captureBefore > 0) {
      const expiresAt = new Date(captureBefore * 1000);
      const created = typeof charge?.created === "number" ? charge.created * 1000 : now.getTime();
      return {
        ...base,
        expiresAt: expiresAt.toISOString(),
        source: "stripe_capture_before",
        captureBefore: expiresAt.toISOString(),
        windowSeconds: Math.max(0, Math.round((expiresAt.getTime() - created) / 1000)),
      };
    }
    console.warn("[DEPOSIT-REFRESH] Stripe published no capture_before; using the conservative fallback window");
    return base;
  } catch (err) {
    console.warn("[DEPOSIT-REFRESH] Could not read capture_before; using the conservative fallback window:", err);
    return fallback();
  }
}

// ---------------------------------------------------------------------------
// Payment-method re-resolution (defect 3 / EC-13 / EC-73 / EC-74)
// ---------------------------------------------------------------------------

interface ResolvedCard {
  id: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  funding: string | null;
  source: "default" | "stored" | "list";
}

// deno-lint-ignore no-explicit-any
function cardIsExpired(pm: any, now: Date): boolean {
  const m = Number(pm?.card?.exp_month);
  const y = Number(pm?.card?.exp_year);
  if (!m || !y) return false; // unknown — let the issuer decide
  // A card is good through the LAST day of its expiry month.
  return new Date(Date.UTC(y, m, 1)).getTime() <= now.getTime();
}

// deno-lint-ignore no-explicit-any
function toResolvedCard(pm: any, source: ResolvedCard["source"]): ResolvedCard {
  return {
    id: pm.id,
    brand: pm?.card?.brand ?? null,
    last4: pm?.card?.last4 ?? null,
    expMonth: pm?.card?.exp_month ?? null,
    expYear: pm?.card?.exp_year ?? null,
    funding: pm?.card?.funding ?? null,
    source,
  };
}

/**
 * Resolve the card to authorize THIS link on — every link, not once per rental.
 *
 * The old engine reused `rentals.deposit_hold_payment_method_id` verbatim for
 * the entire rental. Across 90 days a card expiring, being reissued after
 * fraud, or being replaced by the renter is a base-rate event, and every
 * subsequent link then declined into a terminal status nobody was told about.
 *
 * Order is the same as place-deposit-hold's: the customer's CURRENT default
 * payment method, then the id we stored, then whatever cards are on file.
 * Obviously-expired cards are skipped rather than presented to the issuer.
 * `exclude` carries the id that just failed so the one permitted re-resolution
 * cannot hand back the same dead card.
 *
 * NOTE for whoever wires up `rental_card_mandates`: a link CAN legitimately move
 * to a different card mid-chain (that is the point — otherwise a reissued card
 * ends the rental's cover). The resolved id, brand, last4 and funding are
 * persisted on the rental and on every deposit_hold_links row, which is what a
 * 'pm_replaced' mandate invalidation would key off.
 */
async function resolvePaymentMethod(
  stripe: Stripe,
  customerId: string,
  stripeOptions: StripeOptions,
  storedPmId: string | null,
  exclude: Set<string>,
  now: Date
): Promise<ResolvedCard | null> {
  const customer = await stripe.customers.retrieve(
    customerId,
    { expand: ["invoice_settings.default_payment_method"] },
    stripeOptions
  );
  // deno-lint-ignore no-explicit-any
  if ((customer as any)?.deleted) return null;

  // deno-lint-ignore no-explicit-any
  const def = (customer as any)?.invoice_settings?.default_payment_method;
  if (def && typeof def === "object" && def.type === "card" && !exclude.has(def.id) && !cardIsExpired(def, now)) {
    return toResolvedCard(def, "default");
  }

  if (storedPmId && !exclude.has(storedPmId)) {
    try {
      const pm = await stripe.paymentMethods.retrieve(storedPmId, stripeOptions);
      // An unattached PM cannot be charged off-session, and a PM attached to a
      // DIFFERENT customer is a mis-anchored row (EC-73: five call sites re-mint
      // stripe_customer_id) — either way, fall through rather than fail.
      // deno-lint-ignore no-explicit-any
      const attachedTo = (pm as any)?.customer;
      if (pm?.type === "card" && attachedTo === customerId && !cardIsExpired(pm, now)) {
        return toResolvedCard(pm, "stored");
      }
    } catch (err) {
      console.warn("[DEPOSIT-REFRESH] Stored payment method unusable, falling through:", stripeErrorCode(err));
    }
  }

  const list = await stripe.paymentMethods.list(
    { customer: customerId, type: "card", limit: 10 },
    stripeOptions
  );
  for (const pm of list.data) {
    if (exclude.has(pm.id)) continue;
    if (cardIsExpired(pm, now)) continue;
    return toResolvedCard(pm, "list");
  }
  return null;
}

// ---------------------------------------------------------------------------
// Orphan reconciliation — never authorize a renter twice (fail-OPEN defect)
// ---------------------------------------------------------------------------

/**
 * How far back an orphaned authorization could plausibly still be alive.
 *
 * This is a NETWORK FACT, not a tuning knob: no card authorisation outlives 30
 * days on any network (Visa 29d18h; Mastercard/Amex/Discover 30), so nothing
 * created before this can still be holding a renter's funds. 35 gives five days
 * of slack over the ceiling.
 *
 * It was 8 — which was 7 (the observed default window) + 1 day. That was a valid
 * PROOF only while every authorisation lasted ~7 days. The moment a Connect
 * account becomes eligible for extended authorization the window becomes up to
 * 29d18h, and an orphan created 20 days ago is still live and still holding
 * money while sitting outside an 8-day search — so this function, whose entire
 * job is "never authorize a renter twice", would return null and the caller
 * would place a SECOND full-deposit hold on the same card. The first is
 * unrecoverable (see the docblock below).
 *
 * Nothing in our code changes when Stripe enables that feature — we already send
 * request_extended_authorization: 'if_available' — so this constant had to be
 * correct BEFORE the flip, not after it.
 *
 * reconcile-deposit-holds' SUPERSEDED_LOOKBACK_MS already encodes the same fact
 * at the same value; the two are deliberately equal and must move together.
 */
const ORPHAN_LOOKBACK_DAYS = 35;

/**
 * Pages of 100 to walk when sweeping for orphans. At an 8-day lookback a single
 * page was almost certainly the whole story; over 35 days a customer on a long
 * chain can legitimately exceed 100 PaymentIntents (each link mints one), and
 * stopping at page 1 would silently reintroduce the miss this widening exists to
 * prevent. Bounded rather than auto-paginated so a pathological customer cannot
 * stall the batch.
 */
const ORPHAN_SWEEP_MAX_PAGES = 5;

/**
 * Find a LIVE deposit-hold authorization for this rental that we are not
 * tracking.
 *
 * WHY: `deposit_hold_attempt_seq` is incremented on every attempt and the
 * idempotency key is built from it, so a retry NEVER re-drives the previous
 * key. If `paymentIntents.create` succeeded at Stripe but the response never
 * reached us — a connection reset or a Stripe 5xx, both of which
 * classifyStripeFailure (correctly) calls 'transient' — the next run would
 * create a SECOND live authorization under a brand-new key while the first was
 * still holding the renter's funds. And the first is unrecoverable by anything
 * downstream: `stampLinkIntent` never ran, so its ledger row has a NULL
 * payment_intent_id, and reconcile-deposit-holds explicitly refuses to guess on
 * those. The renter ends up with one invisible frozen hold plus one visible one.
 *
 * HOW: list the customer's recent PaymentIntents and match on our own metadata.
 * Deliberately NOT `paymentIntents.search` (Stripe's search index lags writes by
 * up to a minute, and a lagging index here means "no orphan found" — the
 * fail-OPEN answer), and deliberately NOT an idempotency-key replay: a replay
 * only returns the cached response when the request body is byte-identical, and
 * the body carries the payment method, which this engine re-resolves on every
 * link. A body that has drifted returns `idempotency_error`, not the intent.
 *
 * Both the currently-resolved Stripe customer and the one anchored on the
 * rental are swept, because EC-73's five re-mint sites can move the rental onto
 * a new customer between attempts and the orphan stays attached to the old one.
 */
async function findLiveDepositIntent(
  stripe: Stripe,
  rentalId: string,
  customerIds: string[],
  stripeOptions: StripeOptions,
  exclude: Set<string>,
  now: Date
  // deno-lint-ignore no-explicit-any
): Promise<any | null> {
  const createdGte = Math.floor((now.getTime() - ORPHAN_LOOKBACK_DAYS * 86_400_000) / 1000);
  for (const customerId of customerIds) {
    let startingAfter: string | undefined = undefined;

    for (let pageNo = 0; pageNo < ORPHAN_SWEEP_MAX_PAGES; pageNo++) {
      const page = await stripe.paymentIntents.list(
        {
          customer: customerId,
          limit: 100,
          created: { gte: createdGte },
          expand: ["data.latest_charge"],
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        },
        stripeOptions
      );

      const match = scanPage(page.data, rentalId, exclude);
      if (match) return match;

      if (!page.has_more || page.data.length === 0) break;
      startingAfter = page.data[page.data.length - 1].id;
      if (pageNo === ORPHAN_SWEEP_MAX_PAGES - 1) {
        // Say so. Silence here would be indistinguishable from "no orphan
        // exists", which is the fail-OPEN answer this whole function exists to
        // avoid giving.
        console.warn(
          `[deposit-hold] orphan sweep hit the ${ORPHAN_SWEEP_MAX_PAGES}-page cap for customer ${customerId} ` +
            `on rental ${rentalId}; an orphan older than the last page would not be seen.`
        );
      }
    }
  }
  return null;
}

/** The per-page match, split out so the paging loop above stays readable. */
function scanPage(
  // deno-lint-ignore no-explicit-any
  intents: any[],
  rentalId: string,
  exclude: Set<string>
  // deno-lint-ignore no-explicit-any
): any | null {
  for (const intent of intents) {
    if (exclude.has(intent.id)) continue;
    // Only an authorization that is STILL holding funds matters. Anything
    // canceled/succeeded/in-motion is either dead or somebody else's problem.
    if (String(intent.status) !== "requires_capture") continue;
    // deno-lint-ignore no-explicit-any
    const md = ((intent as any).metadata ?? {}) as Record<string, string>;
    if (md.rental_id !== rentalId) continue;
    // Rollovers count. capture-deposit-hold mints the remainder-hold left
    // after a PARTIAL capture with type 'deposit_hold_rollover', so an exact
    // match on 'deposit_hold' made every rollover invisible to the orphan
    // sweep — the one mechanism whose entire job is finding authorisations
    // the product has lost track of. A rollover holds the renter's money
    // exactly like any other hold and is if anything MORE likely to be
    // orphaned, since it is minted mid-capture when the row is contended.
    if (md.type !== "deposit_hold" && md.type !== "deposit_hold_rollover") continue;
    return intent;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Row writes — optimistic concurrency on every single one (defect 5)
// ---------------------------------------------------------------------------

interface CasExpectation {
  status: string;
  paymentIntentId?: string | null;
  /** Also require the rental to still be in a refreshable lifecycle state. */
  requireRefreshableRental?: boolean;
}

/**
 * Compare-and-set. Anchored on the hold status AND — when it matters — on the
 * exact PaymentIntent the row carried when we read it.
 *
 * Status alone is not enough. The gap is not theoretical: this very engine sets
 * 'refreshing', cancels PI_A and writes PI_B back as 'held', so a status-only
 * predicate can match a row that now carries a DIFFERENT, LIVE authorization.
 * Zero rows updated therefore means "somebody else owns this rental" and the
 * caller must abort — cancelling anything it just created at Stripe first.
 */
async function casUpdate(
  supabase: SupabaseClient,
  rentalId: string,
  patch: Record<string, unknown>,
  expect: CasExpectation
): Promise<boolean> {
  // deno-lint-ignore no-explicit-any
  let query: any = supabase
    .from("rentals")
    .update({ ...patch, deposit_hold_status_changed_at: new Date().toISOString() })
    .eq("id", rentalId)
    .eq("deposit_hold_status", expect.status);

  if (expect.paymentIntentId !== undefined) {
    query = expect.paymentIntentId === null
      ? query.is("deposit_hold_payment_intent_id", null)
      : query.eq("deposit_hold_payment_intent_id", expect.paymentIntentId);
  }
  if (expect.requireRefreshableRental) {
    // EC-10: the operator closing the rental mid-loop (GMT's after-hours lockbox
    // drops land inside the 03:00 UTC window) must beat us, not lose to us.
    //
    // DENY list, matching applyDueHoldFilters. `.or()` is not usable on an
    // UPDATE here (PostgREST mis-qualifies the column and errors with "column
    // rentals.deposit_hold_status does not exist"), so this cannot be made
    // NULL-safe the way the SELECT is: a rental with a NULL status would fail
    // the CAS and be reported as 'lost_race'. That is the SAFE direction — no
    // Stripe call, no money moved, the row untouched and still selectable next
    // run — and `status` has DEFAULT 'Active', so a NULL is pathological.
    query = query.not("status", "in", TERMINAL_RENTAL_STATUS_LIST);
  }

  const { data, error } = await query.select("id");
  // supabase-js RESOLVES on a failed statement instead of throwing; the old
  // engine discarded `{ error }` on every write, which is how a released rental
  // could be silently re-authorized.
  //
  // Tagged with a code so classifyStripeFailure routes it to the transient
  // ladder. An untagged Error has no statusCode/type/code, lands in 'ambiguous'
  // and would retire the rental to 'needs_review' over a database blip.
  if (error) {
    throw Object.assign(new Error(`deposit hold write failed: ${error.message}`), {
      code: "db_write_failed",
    });
  }
  return Array.isArray(data) && data.length > 0;
}

// ---------------------------------------------------------------------------
// deposit_hold_links — the authorization ledger (item 10)
// ---------------------------------------------------------------------------

interface LinkContext {
  supabase: SupabaseClient;
  id: string | null;
}

async function openLink(
  supabase: SupabaseClient,
  row: Record<string, unknown>
): Promise<LinkContext> {
  const { data, error } = await supabase
    .from("deposit_hold_links")
    .insert({ ...row, outcome: "pending" })
    .select("id")
    .maybeSingle();
  if (error) {
    // The ledger is audit substrate, not a gate: refusing to refresh because we
    // could not write history would let a live hold die over a logging problem.
    console.error("[DEPOSIT-REFRESH] Could not open deposit_hold_links row:", error.message);
    return { supabase, id: null };
  }
  return { supabase, id: (data?.id as string) ?? null };
}

/**
 * Stamp the PaymentIntent id onto a still-PENDING link, the instant Stripe
 * returns one and before anything else can fail.
 *
 * This is what makes an orphan recoverable: reconcile-deposit-holds' stale
 * pending-link sweep can only look an authorization up at Stripe if the link
 * carries its id — a pending link with a NULL payment_intent_id is explicitly
 * left alone there ("never guess"). Without this stamp, a crash between the
 * create and the rental write leaves a live authorization on the renter's card
 * that nothing in the product can find.
 */
async function stampLinkIntent(link: LinkContext, paymentIntentId: string): Promise<void> {
  if (!link.id) return;
  const { error } = await link.supabase
    .from("deposit_hold_links")
    .update({ payment_intent_id: paymentIntentId })
    .eq("id", link.id)
    .eq("outcome", "pending");
  if (error) console.error("[DEPOSIT-REFRESH] Could not stamp PaymentIntent onto the link row:", error.message);
}

async function closeLink(link: LinkContext, patch: Record<string, unknown>): Promise<void> {
  if (!link.id) return;
  const { error } = await link.supabase
    .from("deposit_hold_links")
    .update({ ...patch, completed_at: new Date().toISOString() })
    .eq("id", link.id);
  if (error) console.error("[DEPOSIT-REFRESH] Could not close deposit_hold_links row:", error.message);
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export type RefreshResult =
  | "refreshed"
  | "released"
  | "skipped"
  | "failed"
  | "requires_action"
  | "needs_review"
  | "lost_race"
  | "chain_expired"
  | "config_unavailable";

export interface RefreshOutcome {
  rentalId: string;
  result: RefreshResult;
  message: string;
  paymentIntentId?: string | null;
  expiresAt?: string | null;
  /** True when the row was left exactly as we found it. */
  untouched: boolean;
}

export interface RefreshOptions {
  /** Prefix for every console line; the sandbox uses its own. */
  logPrefix?: string;
  /** deposit_hold_links.actor — 'cron' in production, 'sandbox' in the harness. */
  actor?: string;
  /** Cache shared across a batch so one tenant is fetched once. */
  tenantCache?: Map<string, Record<string, unknown> | null>;
  now?: Date;
}

/**
 * Refresh ONE rental's deposit hold: cancel the incumbent authorization and
 * place its replacement, or decide not to. Never throws for anything the caller
 * can act on — the outcome is the contract.
 */
export async function refreshOneHold(
  supabase: SupabaseClient,
  rental: RentalRow,
  opts: RefreshOptions = {}
): Promise<RefreshOutcome> {
  const log = opts.logPrefix ?? "[DEPOSIT-REFRESH]";
  const actor = opts.actor ?? "cron";
  const now = opts.now ?? new Date();
  const rentalId = rental.id as string;
  const incumbentPi = (rental.deposit_hold_payment_intent_id as string | null) ?? null;
  const startingStatus = (rental.deposit_hold_status as string | null) ?? "held";
  const storedExpiresAt = (rental.deposit_hold_expires_at as string | null) ?? null;

  const untouched = (result: RefreshResult, message: string): RefreshOutcome => {
    console.warn(`${log} ${rentalId}: ${message}`);
    return { rentalId, result, message, untouched: true };
  };

  // ── I9 / EC-25: the chain has a hard end — RECOMPUTED, not read. ──────────
  // A rental left 'Active' past its end date is the most common operational
  // slip in a 60-120 day fleet; without a bound the card is re-authorized every
  // ~5 days forever after the car came back.
  //
  // But the stored bound is a placement-time snapshot and goes stale the moment
  // the rental is extended, so THIS is the authoritative reader: resolveChainBound
  // recomputes from the rental's CURRENT end_date and we stop only when the
  // recomputed bound has genuinely passed. See the section header above for why
  // "later of the two" rather than "the live one wins".
  const chain = resolveChainBound(rental, now);
  if (chain.expired) {
    return untouched(
      "chain_expired",
      `chain bound ${chain.effective} has passed ` +
        `(stored ${chain.stored ?? "null"}, from live end_date ${chain.live ?? "null"}) — ` +
        "not re-authorizing (capture or release is an operator decision)"
    );
  }
  // ── The incumbent already outlives the chain. Leave it alone. ──────────────
  //
  // The check above is past-tense — "has the bound already passed?" — and was
  // the ONLY question asked of the chain bound. Nothing ever compared the
  // authorisation we are about to place against it.
  //
  // At a 7-day window that gap was invisible: a replacement placed inside the
  // 2-day lookahead overshoots the bound by at most a few days. At 29d18h it
  // becomes the common case — we would cancel a perfectly good authorisation
  // that already covers the rest of the rental, purely to mint one that
  // ring-fences the renter's money for weeks past handback. That is the
  // opposite of what a deposit chain is for, and it is the direction that
  // attracts card-network attention rather than the direction that satisfies it.
  //
  // Refusing here also removes the final link of every chain outright: if the
  // incumbent reaches the bound, there is nothing left to renew.
  //
  // Guarded on a REAL stored expiry only. A NULL or unparseable one means we do
  // not know when the incumbent dies, and assuming it survives would be the
  // fail-OPEN answer.
  if (chain.effective && storedExpiresAt) {
    const incumbentEndsMs = new Date(storedExpiresAt).getTime();
    const boundMs = new Date(chain.effective).getTime();
    if (Number.isFinite(incumbentEndsMs) && Number.isFinite(boundMs) && incumbentEndsMs >= boundMs) {
      return untouched(
        "skipped",
        `incumbent authorisation already runs to ${storedExpiresAt}, past the chain bound ` +
          `${chain.effective} — not cancelling a live hold to place one that would outlive the rental`
      );
    }
  }

  if (chain.stale) {
    // Diagnostic only — the decision above already used the recomputed value.
    // The write itself rides along on the claim below so it stays inside the
    // CAS and cannot stamp a row somebody else owns.
    console.log(
      chain.stored === null
        ? `${log} ${rentalId}: chain bound SEEDED from end_date -> ${chain.effective} ` +
          `(row carried no bound; it was previously unbounded)`
        : `${log} ${rentalId}: chain bound re-derived forward ` +
          `${chain.stored} -> ${chain.effective} (rental end date moved)`
    );
  }

  // ── Everything below the claim can write to the row. Everything ABOVE it must
  //    not (defect 2). The tenants lookup and getConnectAccountId used to throw
  //    into the one catch that wrote terminal 'expired', so a single missing
  //    tenant row or an incomplete Stripe connection poisoned every hold that
  //    tenant had, in one pass, permanently. ───────────────────────────────────
  const tenantId = rental.tenant_id as string;
  let tenant = opts.tenantCache?.get(tenantId) ?? null;
  if (!opts.tenantCache?.has(tenantId)) {
    const { data, error } = await supabase
      .from("tenants")
      .select(`${TENANT_STRIPE_COLUMNS}, currency_code`)
      .eq("id", tenantId)
      .maybeSingle();
    if (error) {
      return untouched("config_unavailable", `tenant lookup failed (${error.message}) — row left untouched`);
    }
    tenant = (data as Record<string, unknown> | null) ?? null;
    opts.tenantCache?.set(tenantId, tenant);
  }
  if (!tenant) {
    return untouched("config_unavailable", `tenant ${tenantId} not found — row left untouched`);
  }

  // ── I3: anchor Stripe context to the RECORD, not to the tenant's CURRENT row.
  //    The UK->UAE migration moves accounts, modes and even currency underneath
  //    live rentals; an existing hold's replacement must land on the SAME
  //    account, in the SAME mode and the SAME currency as the authorization it
  //    supersedes. Today's derivation is only a fallback for legacy rows
  //    written before these columns existed. ─────────────────────────────────
  let stripe: Stripe;
  let connectAccountId: string | null;
  let stripeMode: StripeMode;
  let currency: string;
  let resolvedPlatform: string;
  try {
    stripeMode = ((rental.deposit_hold_stripe_mode as StripeMode | null) ??
      ((tenant as Record<string, unknown>).stripe_mode as StripeMode) ??
      "test") as StripeMode;
    // The PLATFORM anchor must be honoured the same way the MODE anchor above
    // already is. This block used to read `rental.platform_account` while
    // trusting `deposit_hold_stripe_mode` — half-anchored, which is worse than
    // either extreme because it pairs the hold's KEYS with the rental's
    // ACCOUNT.
    //
    // Caught live: a hold anchored to `uae` on acct_1SqMGnB9wIYWaRK0, sitting on
    // a rental whose platform_account still said `uk`, resolved the UK test key
    // and Stripe answered `account_invalid` — "the provided key does not have
    // access to that account". Every link of every chained hold would fail this
    // way for the duration of the UK->UAE migration, on the ONE function that
    // runs unattended.
    const anchoredPlatform =
      rental.deposit_hold_platform_account === "uk" || rental.deposit_hold_platform_account === "uae"
        ? (rental.deposit_hold_platform_account as string)
        : null;
    resolvedPlatform = anchoredPlatform ?? (rental.platform_account === "uae" ? "uae" : "uk");
    stripe = getStripeClientForRecord({ platform_account: resolvedPlatform }, stripeMode);
    connectAccountId =
      (rental.deposit_hold_connect_account_id as string | null) ??
      getConnectAccountId({
        // deno-lint-ignore no-explicit-any
        ...(tenant as any),
        stripe_mode: stripeMode,
        payment_model: resolvedPlatform === "uae" ? "own" : "managed",
      });
    currency = String(
      (rental.deposit_hold_currency as string | null) ??
        ((tenant as Record<string, unknown>).currency_code as string | null) ??
        "usd"
    ).toLowerCase();
  } catch (configErr) {
    // getConnectAccountId THROWS for a live payment_model='own' tenant with no
    // connected account. That is a configuration problem, not a hold problem.
    return untouched(
      "config_unavailable",
      `Stripe context unresolvable (${configErr instanceof Error ? configErr.message : String(configErr)}) — row left untouched`
    );
  }
  const stripeOptions: StripeOptions = connectAccountId ? { stripeAccount: connectAccountId } : undefined;
  // Anchor-resolved above. This value is stamped onto the ledger rows and the
  // replacement PaymentIntent's metadata, so it must describe where the money
  // ACTUALLY is, not what the rental row happens to say today.
  const platformAccount = resolvedPlatform;

  // ── A 'held' row with no PaymentIntent behind it cannot be proven dead, and
  //    authorizing on the strength of a status field alone is exactly the
  //    fail-OPEN move this workstream exists to prevent. 'failed' rows legitimately
  //    carry no PI (we clear it when a replacement never got placed), and those
  //    ARE the retry path. ────────────────────────────────────────────────────
  if (!incumbentPi && startingStatus === "held") {
    let flagged = false;
    try {
      flagged = await casUpdate(
        supabase,
        rentalId,
        {
          deposit_hold_status: "needs_review",
          deposit_hold_last_error: "Hold recorded as 'held' with no PaymentIntent — cannot prove the authorization state",
          deposit_hold_last_error_code: "missing_payment_intent",
        },
        { status: "held", paymentIntentId: null }
      );
    } catch (dbErr) {
      return untouched(
        "config_unavailable",
        `could not flag a PaymentIntent-less hold (${dbErr instanceof Error ? dbErr.message : String(dbErr)})`
      );
    }
    if (flagged) {
      // ALERT — exit 1 of 3 that does NOT go through finish(). This one is
      // above the claim (the row was never taken to 'refreshing'), so it cannot
      // use the shared closure defined further down and calls the helper
      // directly. A `needs_review` written here is otherwise invisible: the
      // driver only re-selects 'held' and 'failed'.
      await notifyDepositHoldFailure({
        rental,
        result: "needs_review",
        status: "needs_review",
        message: "held with no PaymentIntent — flagged for review rather than authorizing blind",
        errorCode: "missing_payment_intent",
        errorMessage:
          "Hold recorded as 'held' with no PaymentIntent — cannot prove the authorization state",
        // The whole point of this branch is that we CANNOT prove the
        // authorization state: there is no PaymentIntent to ask Stripe about.
        // So the alert says nothing at all about the renter's money.
        moneyState: "unknown",
        // The attempt sequence is deliberately NOT advanced here — the row was
        // never claimed, and nothing was attempted. Keying the dedupe on the seq
        // the row actually carries means this static condition rings once and
        // then stays quiet until something genuinely changes, which is right:
        // re-stating it every night would train staff to ignore the channel.
        attemptSeq: Number(rental.deposit_hold_attempt_seq ?? 0),
        maxAttempts: MAX_HOLD_ATTEMPTS,
        currency: (rental.deposit_hold_currency as string | null) ?? null,
        source: actor,
        supabase,
      });
    }
    return {
      rentalId,
      result: flagged ? "needs_review" : "lost_race",
      message: "held with no PaymentIntent — flagged for review rather than authorizing blind",
      untouched: !flagged,
    };
  }

  // ── Is there a REAL prior authorization to chain FROM? ────────────────────
  //    The driver enforces the same thing in SQL (HOLD_HISTORY_PREDICATE); this
  //    is the belt to that braces, because refreshOneHold is also called
  //    directly by the sandbox and could be called by anything later.
  //
  //    A 'failed' row written by stripe-webhook-{live,test} when the FIRST
  //    auto-placement failed carries no PaymentIntent, no deposit_hold_amount
  //    and no deposit_hold_placed_at. It means "we never took this renter's
  //    deposit" — the opposite of what this engine is for. Left ungated it fell
  //    into the release branch below (amountCents 0 from a NULL amount) and
  //    silently rewrote fleet-wide 'failed' into 'released'.
  const hasHoldHistory = !!incumbentPi || !!(rental.deposit_hold_placed_at as string | null);
  if (!hasHoldHistory) {
    return untouched(
      "skipped",
      `hold status '${startingStatus}' with no PaymentIntent and no deposit_hold_placed_at — ` +
        "this rental never carried an authorization, so there is no chain to extend " +
        "(placing a first hold is place-deposit-hold's job, not the refresher's)"
    );
  }

  // A NULL deposit_hold_amount is UNKNOWN, not zero. Coercing it to 0 turned
  // "we cannot read the amount" into "there is nothing left to hold", which the
  // release branch then acted on destructively. `amountKnown` keeps the two
  // apart; a genuine 0 (e.g. capture-deposit-hold's multicapture remainder) is
  // still a legitimate release.
  const rawAmount = rental.deposit_hold_amount;
  const amountKnown =
    rawAmount !== null && rawAmount !== undefined && Number.isFinite(Number(rawAmount));
  const amountCents = amountKnown ? Math.round(Number(rawAmount) * 100) : 0;
  const attemptSeq = Number(rental.deposit_hold_attempt_seq ?? 0) + 1;
  const priorFailures = Number(rental.deposit_hold_failure_count ?? 0);

  // ── OPERATOR ALERTING ─────────────────────────────────────────────────────
  // A chain that dies on day 45 of a 90-day rental used to say nothing until
  // the car came back. Every exit that leaves the row in 'failed',
  // 'requires_action' or 'needs_review' raises exactly one bell; every healthy
  // or intended outcome ('refreshed', 'released', 'skipped', 'lost_race',
  // 'chain_expired') raises none. The helper is contractually non-throwing, so
  // this can sit on money paths and inside catch blocks.
  //
  // Called from finish() (which covers every row-writing exit) plus the two
  // exits that bypass it — the PaymentIntent-less 'held' flag above, and the
  // stranded-at-'refreshing' return in the outer catch.

  /**
   * What is true of the renter's money on the paths that have NOT yet cancelled
   * the incumbent — ASKED OF STRIPE, never read off the row.
   *
   * This used to be a pure row inference: 'held' + a PaymentIntent id + a stored
   * `deposit_hold_expires_at` in the future => "still live". Every one of those
   * three is unreliable evidence:
   *
   *   * the stored deadline is frequently an ADMITTED GUESS — readHoldWindow
   *     writes `deposit_hold_expiry_source = 'fallback'` when Stripe published
   *     no `capture_before` — and HOLD_REFRESH_COLUMNS selects neither the
   *     source nor `deposit_hold_verified_at`, so the inference could not even
   *     tell a verified deadline from a fabricated one;
   *   * 'held' is written by several paths and is exactly the status a lapsed,
   *     captured or disputed authorization keeps until somebody looks;
   *   * worst, the `customer_missing` exit below is reached PRECISELY when the
   *     Stripe customer does not exist on the anchored account — i.e. the best
   *     evidence in the whole engine that this record is anchored at the wrong
   *     account — and the inference answered that with "the deposit is still
   *     live". Compare the `resource_missing` exit, which correctly refuses to
   *     claim anything.
   *
   * So: one `paymentIntents.retrieve` on the account the record is anchored to,
   * and 'live' ONLY for a PaymentIntent Stripe itself reports as
   * `requires_capture` with a capture deadline that has not passed. Everything
   * else — no PaymentIntent, a retrieve that failed, any other status, a
   * `capture_before` in the past — is 'unknown', and 'unknown' prints NO claim
   * about the money at all.
   *
   * Deliberately NOT 'unsecured' on a canceled/failed PaymentIntent either: an
   * untracked orphan from an earlier attempt can be holding the renter's funds
   * (that is why findLiveDepositIntent exists), and telling an operator to
   * re-place a hold on a card that is already authorized is the mirror harm.
   *
   * Called ONLY from the pre-cancel failure exits, so the extra Stripe call is
   * paid on the rare bad path and never on a healthy refresh. Memoised because
   * an exit could in principle ask twice; non-throwing by construction.
   */
  let incumbentProbe: DepositHoldMoneyState | null = null;
  const confirmIncumbentLive = async (): Promise<DepositHoldMoneyState> => {
    if (incumbentProbe !== null) return incumbentProbe;
    incumbentProbe = "unknown";
    if (!incumbentPi) return incumbentProbe;
    try {
      const pi = await stripe.paymentIntents.retrieve(
        incumbentPi,
        { expand: ["latest_charge"] },
        stripeOptions
      );
      if (String(pi?.status) === "requires_capture") {
        // deno-lint-ignore no-explicit-any
        const charge: any = (pi as any)?.latest_charge;
        const captureBefore = typeof charge === "object"
          ? charge?.payment_method_details?.card?.capture_before
          : null;
        const deadlinePassed = typeof captureBefore === "number" &&
          captureBefore > 0 &&
          captureBefore * 1000 <= now.getTime();
        // A `requires_capture` PaymentIntent whose capture window has already
        // closed is not money anybody can take; Stripe's status lags the
        // network here. Say nothing rather than "still live".
        if (!deadlinePassed) incumbentProbe = "live";
      }
    } catch (probeErr) {
      // Never throws, never changes the outcome — the alert simply makes no
      // claim about the money. Reaching here on `resource_missing` is itself
      // meaningful (the id is not on this account), and 'unknown' is the honest
      // answer to that too.
      console.warn(
        `${log} ${rentalId}: could not confirm incumbent ${incumbentPi} at Stripe ` +
          `(${stripeErrorCode(probeErr)}) — the alert will make no claim about the deposit`
      );
    }
    return incumbentProbe;
  };

  /** One bell, at most, per call of refreshOneHold. */
  const alertFailure = async (args: {
    patch?: Record<string, unknown> | null;
    result: RefreshResult;
    message: string;
    status?: string;
    moneyState: DepositHoldMoneyState;
    moneyStatement?: string | null;
    detail?: string | null;
    failureClass?: FailureClass | null;
    /**
     * Only needed by callers that pass NO patch: without one the helper would
     * fall back to the row's `deposit_hold_last_error*` / `_failure_count`,
     * which on those paths are the PREVIOUS attempt's values and would describe
     * the wrong failure.
     */
    errorCode?: string | null;
    errorMessage?: string | null;
    failureCount?: number | null;
  }): Promise<void> => {
    await notifyDepositHoldFailure({
      rental,
      patch: args.patch ?? null,
      status: args.status ?? null,
      result: args.result,
      message: args.message,
      failureClass: args.failureClass ?? null,
      errorCode: args.errorCode ?? null,
      errorMessage: args.errorMessage ?? null,
      failureCount: args.failureCount ?? null,
      moneyState: args.moneyState,
      moneyStatement: args.moneyStatement ?? null,
      detail: args.detail ?? null,
      attemptSeq,
      // `amountCents` is 0 when the amount is UNKNOWN, and a bare 0 would print
      // "$0.00 deposit" in the deposit-amount-unknown review bell.
      amountCents: amountKnown ? amountCents : null,
      currency,
      maxAttempts: MAX_HOLD_ATTEMPTS,
      source: actor,
      supabase,
    });
  };

  // ── CLAIM. From here on we own the row and every exit path must write a
  //    non-'refreshing' status (or explicitly hand the row back). A DB failure
  //    on the claim itself leaves the row exactly as we found it. ─────────────
  let claimed = false;
  try {
    claimed = await casUpdate(
      supabase,
      rentalId,
      {
        deposit_hold_status: "refreshing",
        deposit_hold_attempt_seq: attemptSeq,
        // Refresh the cache from the recomputation we just did. It rides on the
        // claim so it inherits the CAS (never stamps a row another worker owns)
        // and costs no extra statement. FORWARD ONLY — `stale` is only ever true
        // when the live bound is LATER — which keeps this in step with
        // verify-deposit-hold's re-stamp and can never shorten a live chain.
        ...(chain.stale ? { deposit_hold_chain_expires_at: chain.effective } : {}),
      },
      { status: startingStatus, paymentIntentId: incumbentPi, requireRefreshableRental: true }
    );
  } catch (dbErr) {
    return untouched(
      "config_unavailable",
      `could not claim the hold (${dbErr instanceof Error ? dbErr.message : String(dbErr)}) — row left untouched`
    );
  }
  if (!claimed) {
    return untouched(
      "lost_race",
      "another worker (or a status/lifecycle change) owns this rental — skipped without touching Stripe"
    );
  }

  /**
   * Hand the row back to a recoverable state. Always CAS'd from 'refreshing'.
   *
   * This is also the alerting funnel for every row-writing exit. Two properties
   * matter and both are load-bearing:
   *
   *   * the bell is raised AFTER the CAS and only when it APPLIED. A lost race
   *     means somebody else's state is on the row now, and alerting on a patch
   *     that was never written would describe a rental that does not exist.
   *   * `money` is a FACT THE CALLER ASSERTS, never inferred from the patch. The
   *     3DS and non-capturable-replacement exits both record a PaymentIntent id
   *     while holding none of the renter's money; an inference from the id told
   *     operators they were secured on precisely those two paths.
   */
  const finish = async (
    patch: Record<string, unknown>,
    result: RefreshResult,
    message: string,
    extra: {
      paymentIntentId?: string | null;
      expiresAt?: string | null;
      /** REQUIRED thinking, optional syntax: omitted means 'unknown' (no claim). */
      money?: DepositHoldMoneyState;
      /** Verbatim money sentence, for facts the three-value state cannot carry. */
      moneyStatement?: string | null;
      /** One extra sentence for the bell only. */
      alertDetail?: string | null;
      failureClass?: FailureClass | null;
    } = {}
  ): Promise<RefreshOutcome> => {
    // Alert-only fields must not leak into RefreshOutcome.
    const { money, moneyStatement, alertDetail, failureClass, ...outcomeExtra } = extra;
    const applied = await casUpdate(supabase, rentalId, patch, {
      status: "refreshing",
      paymentIntentId: incumbentPi,
    });
    if (!applied) {
      console.warn(`${log} ${rentalId}: row moved while we held it as 'refreshing' — leaving the winner's state alone`);
      return { rentalId, result: "lost_race", message: `${message} (but the row moved under us)`, untouched: false };
    }
    // Silent for every healthy/intended result — the helper decides from the
    // status this patch just wrote, so 'captured', 'released' and 'held' say
    // nothing while 'failed' / 'requires_action' / 'needs_review' ring once.
    await alertFailure({
      patch,
      result,
      message,
      moneyState: money ?? "unknown",
      moneyStatement,
      detail: alertDetail,
      failureClass,
    });
    return { rentalId, result, message, untouched: false, ...outcomeExtra };
  };

  /**
   * A replacement authorization that exists at Stripe but that we have not
   * managed to record. It MUST NOT be left alive: nothing in the product could
   * find it, so the renter's money would be frozen with no way to release it.
   * Set the moment Stripe returns a PaymentIntent, cleared the moment the id is
   * safely persisted on the rental.
   */
  let unrecordedIntentId: string | null = null;

  /**
   * WHY the compensating cancel did not happen, in the operator's words.
   *
   * `cancelUnrecorded` returning true covers two genuinely different situations
   * and the human who has to go and look needs to know which: we could not
   * CONFIRM the id was still unrecorded (so it may be perfectly fine — the
   * winner may have recorded this very authorization), versus we confirmed it
   * was unrecorded and the cancel itself failed (so it is almost certainly
   * sitting on the renter's card). Set by cancelUnrecorded, read by the orphan
   * bell below.
   */
  let unrecordedCleanupFailure: string | null = null;

  /**
   * The id we could not clean up. `unrecordedIntentId` is cleared the moment
   * cancelUnrecorded runs, so without this the outer catch — which only sees the
   * boolean — could tell an operator that "a replacement could not be cancelled"
   * without being able to say WHICH one, which is an alert nobody can act on.
   */
  let strandedIntentId: string | null = null;

  const cancelUnrecorded = async (reason: string): Promise<boolean> => {
    if (!unrecordedIntentId) return false;
    const id = unrecordedIntentId;
    unrecordedIntentId = null;

    // NEVER cancel an authorization the rental now points at. We only get here
    // because the row moved out from under us, and one of the things that could
    // have moved it is somebody RECORDING this very PaymentIntent (a webhook, a
    // reconciler pass, or — for an adopted orphan — a path that found the same
    // untracked authorization). Cancelling then would leave the renter
    // unsecured, which is worse than the orphan we are trying to clean up.
    //
    // If we cannot read the row, do NOT cancel: stampLinkIntent has already put
    // this id on the ledger, so the reconciler can still resolve it, whereas a
    // wrongly-cancelled live hold is unrecoverable. Report it as orphaned so
    // the rental is flagged for review.
    try {
      const { data, error } = await supabase
        .from("rentals")
        .select("deposit_hold_payment_intent_id")
        .eq("id", rentalId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (data?.deposit_hold_payment_intent_id === id) {
        console.warn(`${log} ${rentalId}: ${id} is now recorded on the rental — NOT cancelling (${reason})`);
        return false;
      }
    } catch (probeErr) {
      console.error(
        `${log} ${rentalId}: could not confirm ${id} is unrecorded (${reason}); leaving it for the reconciler rather than risking a live hold:`,
        probeErr
      );
      unrecordedCleanupFailure =
        "we could not re-read the rental to confirm the authorization was unclaimed, so it was left " +
        "alone rather than risk cancelling a hold somebody else had just recorded";
      strandedIntentId = id;
      return true;
    }

    try {
      await stripe.paymentIntents.cancel(id, stripeOptions);
      console.warn(`${log} ${rentalId}: cancelled unrecorded authorization ${id} (${reason})`);
      return false;
    } catch (err) {
      console.error(`${log} ${rentalId}: ORPHANED authorization ${id} — ${reason}; cancel failed:`, err);
      unrecordedCleanupFailure = `cancelling it at Stripe failed (${stripeErrorCode(err)})`;
      strandedIntentId = id;
      return true;
    }
  };

  /**
   * THE BELL FOR THE WORST OUTCOME IN THE ENGINE.
   *
   * A replacement authorization exists at Stripe, the rental does not point at
   * it, and the compensating cancel did not happen. Nothing downstream can find
   * it: the ledger link is closed 'orphaned', so reconcile-deposit-holds' stale
   * sweep (which selects `outcome = 'pending'`) skips it, and its
   * `superseded_pi_id` sweep cannot see it either — this orphan is the
   * REPLACEMENT, carried in `payment_intent_id`. So the renter's funds can sit
   * frozen indefinitely with nobody told.
   *
   * Both `lost_race` exits that can produce this used to return in silence. The
   * driver does not help: it classifies `lost_race` as a correct outcome, so it
   * is neither counted in `failed` nor pushed into `errors[]`, and the only
   * trace was a console.error nobody reads.
   *
   * Alerting ONLY — this writes no `deposit_hold_status`, on purpose: the row
   * belongs to whoever won the race and their state is the correct one.
   * Non-throwing, like everything else on this path.
   */
  const alertOrphanedAuthorization = async (intentId: string, reason: string): Promise<void> => {
    await notifyDepositHoldOrphanedAuthorization({
      rental,
      paymentIntentId: intentId,
      reason,
      cleanupFailure: unrecordedCleanupFailure,
      amountCents: amountKnown ? amountCents : null,
      currency,
      connectAccountId,
      stripeMode,
      attemptSeq,
      result: "lost_race",
      source: actor,
      supabase,
    });
  };

  /** finish() for an outcome that CARRIES the new PaymentIntent id. */
  const finishWithIntent = async (
    patch: Record<string, unknown>,
    result: RefreshResult,
    message: string,
    intentId: string,
    extra: {
      expiresAt?: string | null;
      money?: DepositHoldMoneyState;
      moneyStatement?: string | null;
      alertDetail?: string | null;
      failureClass?: FailureClass | null;
    } = {}
  ): Promise<RefreshOutcome> => {
    const outcome = await finish(patch, result, message, { paymentIntentId: intentId, ...extra });
    if (outcome.result !== "lost_race") {
      unrecordedIntentId = null;
      return outcome;
    }
    // The row moved, so the id we just created landed nowhere.
    const orphaned = await cancelUnrecorded("row changed owner before the replacement could be recorded");
    if (orphaned) {
      // A LIVE authorization on a real card that no rental, no screen and no
      // reconciler sweep points at. This used to return in silence.
      await alertOrphanedAuthorization(
        intentId,
        "another worker took the rental before the authorization could be recorded"
      );
    }
    return {
      ...outcome,
      message: orphaned
        ? `${outcome.message}; replacement ${intentId} could NOT be cancelled — needs manual cancellation`
        : `${outcome.message}; replacement ${intentId} cancelled`,
    };
  };

  try {
    // ── Item 7 / defect 6: the "release instead of refresh" decision happens
    //    BEFORE the cancel. Under the old order this branch ran AFTER an
    //    unconditional cancel — i.e. "destroy the hold, then record that we
    //    released it", with no way to abort in between. ─────────────────────
    //
    // AUTO-EXTEND rentals must NOT carry a deposit (renewal pricing replaces it
    // — RevTek/Jeffrey incident). Manually-EXTENDED rentals are deliberately NOT
    // excluded: they are normal rentals whose deposit must stay alive, and
    // operators on network-default accounts (GMT) depend on this chain. The
    // Jun-25 blanket ban conflated the two and cancelled their live holds
    // (GMT incident, Jul 2026).
    //
    // Every arm below is reachable only for a rental with real hold history
    // (see the hasHoldHistory gate above), and the amount arms additionally
    // require the amount to be READABLE. "Release" is a destructive, one-way
    // statement about the renter's money; it must never be the answer to "we
    // could not read this row".
    const releaseReason: string | null = rental.auto_extend_enabled === true
      ? "auto-extend rental — renewal pricing replaces the deposit"
      : !amountKnown
      ? null
      : amountCents <= 0
      ? "deposit amount is zero"
      : amountCents < 50
      ? `deposit amount ${amountCents} minor units is below the network minimum — cannot be re-authorized`
      : null;

    // Unknown amount on a rental that DOES carry a chain. We can neither size a
    // replacement nor honestly call the deposit released, and cancelling the
    // incumbent would leave the renter unsecured on a guess. Park it for a
    // human without touching Stripe — the incumbent stays live.
    if (!releaseReason && !amountKnown) {
      return await finish(
        {
          deposit_hold_status: "needs_review",
          deposit_hold_last_error:
            "deposit_hold_amount is NULL on a rental with an existing hold — cannot size a replacement authorization",
          deposit_hold_last_error_code: "deposit_amount_unknown",
          deposit_hold_next_retry_at: null,
        },
        "needs_review",
        "deposit amount unknown — incumbent left alone and flagged for review",
        // Nothing here cancelled anything, so the incumbent stands as Stripe
        // reports it — which is the only thing we will repeat. The row's own
        // 'held' + stored expiry is not evidence (see confirmIncumbentLive).
        { money: await confirmIncumbentLive() }
      );
    }

    if (releaseReason) {
      const link = await openLink(supabase, {
        rental_id: rentalId,
        tenant_id: tenantId,
        attempt_seq: attemptSeq,
        action: "release",
        superseded_pi_id: incumbentPi,
        platform_account: platformAccount,
        connect_account_id: connectAccountId,
        stripe_mode: stripeMode,
        amount_cents: amountCents,
        currency,
        actor,
      });

      let cancelError: string | null = null;
      if (incumbentPi) {
        try {
          await stripe.paymentIntents.cancel(incumbentPi, stripeOptions);
        } catch (err) {
          const code = stripeErrorCode(err);
          // Already captured/canceled/gone — the money is not ours to release.
          if (code !== "payment_intent_unexpected_state" && code !== "resource_missing") throw err;
          cancelError = code;
        }
      }

      // The WHY lives on the ledger row, not on the rental. A release is an
      // intended, correct outcome; parking its reason in
      // `deposit_hold_last_error` made it render as a failure in the operator
      // UI and left a stale "error" on the row indefinitely.
      await closeLink(link, {
        outcome: cancelError ? "orphaned" : "succeeded",
        error_code: cancelError,
        error_message: cancelError
          ? `${releaseReason}; incumbent could not be cancelled: ${cancelError}`
          : releaseReason,
      });

      // I6: never null the payment-method / customer columns on release — the
      // next placement (and any later damage settlement) needs the card anchor.
      return await finish(
        {
          deposit_hold_status: "released",
          deposit_hold_payment_intent_id: null,
          deposit_hold_expires_at: null,
          deposit_hold_next_retry_at: null,
          deposit_hold_last_error: null,
          deposit_hold_last_error_code: null,
        },
        "released",
        `released instead of refreshed — ${releaseReason}`
      );
    }

    // ── Re-resolve the Stripe customer, then the card (defect 3). ───────────
    // validateStripeCustomerId returns null ONLY for a missing/deleted customer
    // and rethrows network/auth problems — those belong to the classifier, not
    // to a "re-mint the customer" branch.
    let customerId: string | null = await validateStripeCustomerId(
      stripe,
      rental.deposit_hold_stripe_customer_id as string | null,
      stripeOptions
    );
    if (!customerId) {
      // EC-73: five separate call sites re-mint customers.stripe_customer_id and
      // leave the rental pointing at a dead object. Prefer the customer row's
      // current id before declaring the chain unrecoverable.
      const { data: customerRow } = await supabase
        .from("customers")
        .select("stripe_customer_id")
        .eq("id", rental.customer_id)
        .maybeSingle();
      const candidate = (customerRow?.stripe_customer_id as string | null) ?? null;
      customerId = candidate ? await validateStripeCustomerId(stripe, candidate, stripeOptions) : null;
    }
    if (!customerId) {
      return await finish(
        {
          deposit_hold_status: "needs_review",
          deposit_hold_last_error: "No usable Stripe customer for this rental on the anchored account",
          deposit_hold_last_error_code: "customer_missing",
          deposit_hold_failure_count: priorFailures + 1,
          deposit_hold_next_retry_at: null,
        },
        "needs_review",
        "no usable Stripe customer on the anchored account",
        // Pre-cancel: the incumbent has not been touched. But this exit is
        // reached BECAUSE the customer is missing on the anchored account, which
        // is the strongest hint in the engine that the record is anchored wrong
        // — so the row's own claim of a live hold is worth nothing here. Ask
        // Stripe on that same account: if the PaymentIntent is not there either,
        // the probe fails and the bell says nothing, which is correct.
        { money: await confirmIncumbentLive() }
      );
    }

    const triedPaymentMethods = new Set<string>();
    const firstCard = await resolvePaymentMethod(
      stripe,
      customerId,
      stripeOptions,
      rental.deposit_hold_payment_method_id as string | null,
      triedPaymentMethods,
      now
    );
    if (!firstCard) {
      // Nothing chargeable on file. There is no server-side fix — the renter has
      // to add a card — so this waits for a human rather than burning attempts.
      return await finish(
        {
          deposit_hold_status: "requires_action",
          deposit_hold_stripe_customer_id: customerId,
          deposit_hold_last_error: "No usable card on file — the customer must add a valid payment method",
          deposit_hold_last_error_code: "no_payment_method",
          deposit_hold_failure_count: priorFailures + 1,
          deposit_hold_next_retry_at: null,
        },
        "requires_action",
        "no usable card on file — customer action required",
        // Pre-cancel: we never reached the incumbent, so it stands as STRIPE
        // reports it — "as recorded" was the bug.
        { money: await confirmIncumbentLive() }
      );
    }
    // Non-null from here; reassigned only when a dead card forces one
    // re-resolution below.
    let card: ResolvedCard = firstCard;

    // ── The authorization ledger row goes in BEFORE Stripe is touched, so a
    //    crashed attempt is still discoverable (I1). ────────────────────────
    //
    // Idempotency key carries deposit_hold_attempt_seq (defect 2 / EC-18/EC-19):
    // the old key embedded the OLD PaymentIntent id, which the failure path
    // never updated, so every retry inside Stripe's 24h window replayed the
    // cached decline verbatim — and a rebased amount on the same key returns
    // `idempotency_error`, which the card-feature ladder does not match, so it
    // rethrew straight into terminal 'expired'.
    const idempotencyKey = `deposit-refresh-${rentalId}-${attemptSeq}-${amountCents}`;
    const link = await openLink(supabase, {
      rental_id: rentalId,
      tenant_id: tenantId,
      attempt_seq: attemptSeq,
      action: "refresh",
      superseded_pi_id: incumbentPi,
      platform_account: platformAccount,
      connect_account_id: connectAccountId,
      stripe_mode: stripeMode,
      amount_cents: amountCents,
      currency,
      idempotency_key: idempotencyKey,
      actor,
    });

    // ── Cancel the incumbent. EC-09: `payment_intent_unexpected_state` is NOT
    //    benign — the old code shrugged and placed a fresh full-amount hold on
    //    top of whatever the PI had actually become. Re-read and decide. ─────
    if (incumbentPi) {
      try {
        await stripe.paymentIntents.cancel(incumbentPi, stripeOptions);
        console.log(`${log} ${rentalId}: incumbent ${incumbentPi} cancelled`);
      } catch (cancelErr) {
        const code = stripeErrorCode(cancelErr);

        if (code === "resource_missing") {
          // The PI does not exist on the anchored account. We cannot prove the
          // renter's funds are free, so we must not authorize again.
          await closeLink(link, { outcome: "failed", error_code: code, error_message: "incumbent not found on the anchored account" });
          return await finish(
            {
              deposit_hold_status: "needs_review",
              deposit_hold_last_error: `Incumbent PaymentIntent ${incumbentPi} not found on ${connectAccountId ?? "the platform account"}`,
              deposit_hold_last_error_code: code,
              deposit_hold_failure_count: priorFailures + 1,
              deposit_hold_next_retry_at: null,
            },
            "needs_review",
            "incumbent PaymentIntent not found on the anchored account — not re-authorizing",
            // The id we hold does not exist on this account. That is neither
            // proof the renter is secured nor proof they are not (the
            // authorization may live on another account entirely, which is what
            // the UK->UAE move makes possible), so the bell makes no claim.
            { money: "unknown" }
          );
        }

        if (code !== "payment_intent_unexpected_state") throw cancelErr;

        // Unexpected state: find out WHICH state before doing anything.
        const probe = await stripe.paymentIntents.retrieve(incumbentPi, stripeOptions);
        const piStatus = String(probe.status);
        if (piStatus === "succeeded") {
          // Somebody captured the deposit while we were mid-flight. Placing a
          // replacement would authorize the card a second time for money that
          // has already been taken.
          await closeLink(link, { outcome: "failed", error_code: "already_captured", error_message: "incumbent was captured mid-refresh" });
          return await finish(
            { deposit_hold_status: "captured", deposit_hold_expires_at: null, deposit_hold_next_retry_at: null },
            "skipped",
            "incumbent was captured mid-refresh — recorded as captured, no replacement placed"
          );
        }
        if (piStatus === "requires_action" || piStatus === "processing" || piStatus === "requires_confirmation") {
          // Still in motion. It may yet become a live authorization; a second
          // one on the same card is the outcome we refuse to risk.
          await closeLink(link, { outcome: "failed", error_code: "incumbent_in_motion", error_message: `incumbent is ${piStatus}` });
          return await finish(
            {
              deposit_hold_status: "needs_review",
              deposit_hold_last_error: `Incumbent PaymentIntent is ${piStatus}; refusing to place a second authorization`,
              deposit_hold_last_error_code: "incumbent_in_motion",
              deposit_hold_next_retry_at: null,
            },
            "needs_review",
            `incumbent is ${piStatus} — refusing to place a second authorization`,
            // In motion: not capturable right now, but it may yet become a live
            // authorization. Both "secured" and "unsecured" would be a guess.
            { money: "unknown" }
          );
        }
        // canceled / requires_payment_method — already dead, carry on.
        console.warn(`${log} ${rentalId}: incumbent already ${piStatus}, continuing to the replacement`);
      }
    }

    /** One replacement-authorization attempt on a given card. */
    const createReplacement = async (paymentMethodId: string, key: string, pmReplaced: boolean) =>
      await createDepositHoldIntentWithFallback(
        stripe,
        {
          amount: amountCents,
          currency,
          customer: customerId,
          payment_method: paymentMethodId,
          capture_method: "manual",
          confirm: true,
          off_session: true,
          description: `Security deposit hold (refreshed) for rental ${rentalId.substring(0, 8).toUpperCase()}`,
          expand: ["latest_charge"],
          metadata: {
            rental_id: rentalId,
            tenant_id: tenantId,
            type: "deposit_hold",
            refreshed: "true",
            attempt_seq: String(attemptSeq),
            superseded_pi: incumbentPi ?? "",
            ...(pmReplaced ? { pm_replaced: "true" } : {}),
          },
        },
        { ...(stripeOptions ?? {}), idempotencyKey: key }
      );

    const recordFailure = async (
      // deno-lint-ignore no-explicit-any
      err: any,
      note?: string,
      alertOpts: {
        /**
         * Overrides the per-error derivation below. Pass 'unknown' from any site
         * that reached here WITHOUT ruling out a live authorization.
         */
        money?: DepositHoldMoneyState;
        /**
         * One extra sentence on the bell only, and DELIBERATELY only on the
         * dead-end arms — the auto-recovering arm ('failed' with a scheduled
         * retry) says "no action needed", and appending "go and check Stripe"
         * to that both contradicts it and asks staff to do work the next
         * attempt's orphan sweep does by itself.
         */
        alertDetail?: string | null;
      } = {}
    ): Promise<RefreshOutcome> => {
      const failureClass = classifyStripeFailure(err);
      const code = stripeErrorCode(err);
      const message = `${String(err?.message ?? err)}${note ? ` (${note})` : ""}`;
      const failureCount = priorFailures + 1;
      await closeLink(link, { outcome: "failed", error_code: code, error_message: message.slice(0, 500) });

      // The incumbent is already cancelled at this point, so the renter is
      // UNSECURED. We clear the PaymentIntent id and expiry to say so honestly:
      // a NULL expiry sorts to the head of the driver's queue, and leaving the
      // dead id in place would let the reconciler overwrite this recoverable
      // 'failed' with terminal 'expired' and end the chain for good.
      const base: Record<string, unknown> = {
        deposit_hold_payment_intent_id: null,
        deposit_hold_expires_at: null,
        deposit_hold_failure_count: failureCount,
        deposit_hold_last_error: message.slice(0, 500),
        deposit_hold_last_error_code: code,
        deposit_hold_payment_method_id: card.id,
        deposit_hold_stripe_customer_id: customerId,
      };

      // ── What we may SAY about the money. Per call site, not per family. ────
      //
      // This was a flat 'unsecured' for the whole family, on the reasoning that
      // every exit here is post-cancel and `base` nulls the PaymentIntent. The
      // first half is true; the second is about the ROW, not about Stripe. Two
      // shapes of arrival leave a live authorization we cannot see:
      //
      //   * the orphan probe THREW — we came here precisely because we could
      //     NOT rule out an untracked live authorization (it passes 'unknown');
      //   * a create that failed WITHOUT a decision from Stripe — a connection
      //     reset, a timeout, a 5xx. That is the lost-response case this engine
      //     documents at findLiveDepositIntent: Stripe may well have accepted
      //     the create and be holding the renter's funds under an id we never
      //     received.
      //
      // 'unsecured' is therefore claimed ONLY when the issuer/Stripe gave us an
      // actual verdict on the card — a decline, a dead card, an SCA demand. In
      // all of those no authorization was created, so the renter genuinely is
      // uncovered and saying so is what gets the deposit re-placed.
      //
      // This matters because the ambiguous / exhausted arms below tell staff to
      // "re-place the hold on a working card": doing that on a card that is
      // already authorized double-authorizes a real renter, which is the harm
      // this helper's own docblock names.
      const money: DepositHoldMoneyState = alertOpts.money ??
        (failureClass === "transient" || failureClass === "ambiguous"
          ? "unknown"
          : "unsecured");
      // Only for the DEAD-END arms. The auto-recovering arm deliberately gets
      // no such note: it comes straight back, and the next attempt runs the
      // orphan sweep (findLiveDepositIntent, gated on priorFailures > 0) which
      // adopts exactly the authorization we are unsure about. Sending staff to
      // audit Stripe for something the engine is about to reconcile itself is
      // how an alert channel earns its mute.
      const unknownMoneyNote = alertOpts.alertDetail ??
        (money === "unknown"
          ? "We could not confirm with Stripe whether an authorization was created for this attempt, " +
            "so this alert makes no claim about the renter's deposit — check the rental against Stripe " +
            "before placing another hold on their card."
          : null);

      // SCA cannot be solved server-side: an off-session authorization needs the
      // cardholder present. Straight to 'requires_action', no attempts burned.
      if (failureClass === "sca") {
        return await finish(
          { ...base, deposit_hold_status: "requires_action", deposit_hold_next_retry_at: null },
          "requires_action",
          `authentication required — ${message}`,
          { money, failureClass, alertDetail: unknownMoneyNote }
        );
      }
      if (failureClass === "dead_card") {
        return await finish(
          { ...base, deposit_hold_status: "requires_action", deposit_hold_next_retry_at: null },
          "requires_action",
          `card unusable (${code}) — ${message}`,
          { money, failureClass, alertDetail: unknownMoneyNote }
        );
      }
      if (failureClass === "ambiguous") {
        return await finish(
          { ...base, deposit_hold_status: "needs_review", deposit_hold_next_retry_at: null },
          "needs_review",
          `unclassified Stripe failure (${code}) — ${message}`,
          { money, failureClass, alertDetail: unknownMoneyNote }
        );
      }
      if (failureCount >= MAX_HOLD_ATTEMPTS) {
        // Stripe: "We recommend a maximum of eight retries… issuers might see
        // additional retries as potential fraud."
        return await finish(
          { ...base, deposit_hold_status: "needs_review", deposit_hold_next_retry_at: null },
          "needs_review",
          `gave up after ${failureCount} attempts (${code}) — ${message}`,
          { money, failureClass, alertDetail: unknownMoneyNote }
        );
      }
      const retryAt = computeRetryAt(failureClass, priorFailures, storedExpiresAt, now);
      // The only AUTO-RECOVERING exit in this family: 'failed' WITH a scheduled
      // retry. The alert is a warning that names the retry time and says no
      // action is needed — the distinction that keeps the channel worth reading.
      return await finish(
        { ...base, deposit_hold_status: "failed", deposit_hold_next_retry_at: retryAt },
        "failed",
        `${failureClass} failure (${code}); retrying after ${retryAt} — ${message}`,
        { money, failureClass }
      );
    };

    // ── ORPHAN RECONCILIATION, before we create anything. ──────────────────
    //    A prior attempt that failed AFTER Stripe accepted the create leaves a
    //    live authorization nothing can see (see findLiveDepositIntent). The
    //    only moment we can catch it is here, because the attempt_seq-keyed
    //    idempotency key guarantees the create below will NOT replay it.
    //
    //    Gated on priorFailures > 0: a clean first attempt has no lost response
    //    to reconcile, and this costs a Stripe list call.
    // deno-lint-ignore no-explicit-any
    let newIntent: any = null;
    let adoptedOrphan = false;

    if (priorFailures > 0) {
      const sweepCustomers = [
        customerId,
        (rental.deposit_hold_stripe_customer_id as string | null) ?? null,
      ].filter((c, i, arr): c is string => !!c && arr.indexOf(c) === i);

      // deno-lint-ignore no-explicit-any
      let orphan: any = null;
      try {
        orphan = await findLiveDepositIntent(
          stripe,
          rentalId,
          sweepCustomers,
          stripeOptions,
          new Set(incumbentPi ? [incumbentPi] : []),
          now
        );
      } catch (probeErr) {
        // FAIL SAFE, NEVER OPEN: we could not rule out a live orphan, so we do
        // NOT create a second authorization. The retry ladder brings us back.
        //
        // And the bell must say the same thing the code just said. "We could not
        // rule out a live authorization" and "the renter is unsecured" cannot
        // both be true; the earlier flat 'unsecured' printed the second while
        // the branch existed only because of the first.
        return await recordFailure(
          probeErr,
          "could not check Stripe for an untracked authorization — refusing to create a second one",
          {
            money: "unknown",
            alertDetail:
              "We could not reach Stripe to check whether an earlier attempt already left a live " +
              "authorization on this card, so no replacement was placed and this alert makes no claim " +
              "about the deposit. Check the renter's card at Stripe before placing another hold.",
          }
        );
      }

      if (orphan) {
        const sameMoney =
          Number(orphan.amount) === amountCents &&
          String(orphan.currency ?? "").toLowerCase() === currency;
        if (sameMoney) {
          // Adopt it. The renter's card is already authorized for exactly this
          // deposit; creating another would double-authorize them.
          console.warn(
            `${log} ${rentalId}: ADOPTING untracked authorization ${orphan.id} from attempt ` +
              `${orphan.metadata?.attempt_seq ?? "?"} instead of creating a second one`
          );
          newIntent = orphan;
          adoptedOrphan = true;
          // The orphan was authorized on whatever card THAT attempt resolved,
          // which need not be the one we just resolved. Record the truth, not
          // our intention.
          const orphanPm = typeof orphan.payment_method === "string"
            ? orphan.payment_method
            : (orphan.payment_method?.id as string | undefined) ?? null;
          if (orphanPm && orphanPm !== card.id) {
            try {
              card = toResolvedCard(await stripe.paymentMethods.retrieve(orphanPm, stripeOptions), "stored");
            } catch {
              // Keep the id (it is what the authorization is actually on) but
              // do not carry the other card's expiry across with it.
              card = { ...card, id: orphanPm, expMonth: null, expYear: null };
            }
          }
        } else {
          // A live deposit authorization for this rental in a DIFFERENT amount.
          // Creating another would stack two holds on the renter; cancelling
          // this one blind could destroy an authorization somebody else placed
          // deliberately (a rebase, a manual placement). A human decides.
          await closeLink(link, {
            outcome: "failed",
            payment_intent_id: orphan.id,
            error_code: "orphan_amount_mismatch",
            error_message: `untracked live authorization ${orphan.id} for ${orphan.amount} ${orphan.currency} vs expected ${amountCents} ${currency}`,
          });
          return await finish(
            {
              deposit_hold_status: "needs_review",
              // Point the rental at the authorization that is ACTUALLY holding
              // the renter's money. The incumbent this row still names was
              // cancelled a moment ago, so leaving it there would hide live
              // funds behind a dead id — the exact invisibility we are fixing.
              // The expiry is cleared because the stored one belonged to the
              // cancelled incumbent and nothing should trust it.
              deposit_hold_payment_intent_id: orphan.id,
              deposit_hold_expires_at: null,
              deposit_hold_last_error:
                `Untracked live authorization ${orphan.id} exists for this rental in a different amount ` +
                `(${orphan.amount} ${String(orphan.currency ?? "").toUpperCase()} vs ${amountCents} ${currency.toUpperCase()}) — not placing a second one`,
              deposit_hold_last_error_code: "orphan_amount_mismatch",
              deposit_hold_failure_count: priorFailures + 1,
              deposit_hold_next_retry_at: null,
            },
            "needs_review",
            `untracked live authorization ${orphan.id} in a different amount — refusing to double-authorize`,
            {
              paymentIntentId: orphan.id,
              // A CONFIRMED capturable authorization — findLiveDepositIntent
              // only ever returns 'requires_capture' — but for a different
              // amount than this rental's deposit. Both "secured" and
              // "unsecured" would mislead, so the sentence is written out.
              money: "live",
              moneyStatement:
                `The renter's card IS still authorized, under ${orphan.id}, but for ` +
                `${(Number(orphan.amount) / 100).toFixed(2)} ${String(orphan.currency ?? "").toUpperCase()} — ` +
                `not this rental's ${(amountCents / 100).toFixed(2)} ${currency.toUpperCase()} deposit. ` +
                `The previous authorization is gone and this rental now points at the one actually holding ` +
                `funds; no second hold was placed.`,
            }
          );
        }
      }
    }

    // ── Place the replacement (unless we just adopted one). ────────────────
    if (!newIntent) {
      try {
        newIntent = await createReplacement(card.id, idempotencyKey, false);
      } catch (createErr) {
        // Dead card: re-resolve ONCE, excluding the card that just failed.
        // Across 90 days a card expiring or being reissued after fraud is a
        // base-rate event, and the issuer has usually already given the renter a
        // replacement that is sitting on the Stripe customer already.
        //
        // No `money` override on any of the three recordFailure calls in this
        // block: it derives the claim from THIS error. A decline (funds /
        // dead_card / sca) is Stripe telling us it created nothing, so
        // 'unsecured' is a fact worth acting on; a connection reset or a 5xx is
        // the lost-response case — Stripe may be holding the renter's funds
        // under an id we never received — so the bell says nothing.
        if (classifyStripeFailure(createErr) !== "dead_card") {
          return await recordFailure(createErr);
        }
        triedPaymentMethods.add(card.id);
        const replacement = await resolvePaymentMethod(
          stripe,
          customerId,
          stripeOptions,
          null,
          triedPaymentMethods,
          now
        );
        if (!replacement) {
          return await recordFailure(createErr, "no alternative card on file");
        }
        console.warn(
          `${log} ${rentalId}: ${stripeErrorCode(createErr)} on ${card.id}, retrying on ${replacement.id}`
        );
        card = replacement;
        try {
          // A different card is a different request, so the idempotency key must
          // move with it or Stripe replays the first card's decline.
          newIntent = await createReplacement(card.id, `${idempotencyKey}-pm2`, true);
        } catch (retryErr) {
          return await recordFailure(retryErr, "the replacement card also failed");
        }
      }
    }
    // Live at Stripe from here until we persist its id — record it on the
    // ledger row FIRST so the reconciler can find it if we die in between.
    // (An adopted orphan is in exactly the same position: live at Stripe, not
    // yet recorded anywhere that can find it.)
    unrecordedIntentId = newIntent.id;
    await stampLinkIntent(link, newIntent.id);

    const piStatus = String(newIntent.status);

    if (piStatus === "requires_action") {
      // EC-17: keep the PaymentIntent — an on-session confirm screen can still
      // rescue it. NEVER store client_secret; it is re-fetched server-side.
      await closeLink(link, {
        outcome: "failed",
        payment_intent_id: newIntent.id,
        error_code: "authentication_required",
        error_message: "replacement authorization needs cardholder verification",
      });
      return await finishWithIntent(
        {
          deposit_hold_status: "requires_action",
          deposit_hold_payment_intent_id: newIntent.id,
          deposit_hold_expires_at: null,
          deposit_hold_payment_method_id: card.id,
          deposit_hold_stripe_customer_id: customerId,
          deposit_hold_last_error: "Replacement authorization needs cardholder verification (3DS)",
          deposit_hold_last_error_code: "authentication_required",
          deposit_hold_failure_count: priorFailures + 1,
          deposit_hold_next_retry_at: null,
        },
        "requires_action",
        "replacement needs cardholder verification (3DS)",
        newIntent.id,
        {
          // THE INVERSION THE REVIEW CAUGHT. This patch records
          // `deposit_hold_payment_intent_id` — but that PaymentIntent is
          // 'requires_action' and is holding NOTHING, while the incumbent was
          // cancelled a few lines above. Deriving "secured" from the presence of
          // that id told the operator their renter was covered at the exact
          // moment they were not.
          money: "unsecured",
          failureClass: "sca",
        }
      );
    }

    if (piStatus !== "requires_capture") {
      // Still in motion ('processing', 'requires_confirmation') or dead
      // ('requires_payment_method'). Either way we persist the id so nothing is
      // orphaned, and refuse to guess: 'held' would be a lie the capture path
      // could act on, and a terminal status would end a chain that might still
      // succeed. The reconciler resolves it against Stripe.
      // deno-lint-ignore no-explicit-any
      const lastError = (newIntent as any)?.last_payment_error;
      const code = lastError ? stripeErrorCode(lastError) : `unexpected_status_${piStatus}`;
      await closeLink(link, {
        outcome: "failed",
        payment_intent_id: newIntent.id,
        error_code: code,
        error_message: `replacement PaymentIntent is ${piStatus}`,
      });
      return await finishWithIntent(
        {
          deposit_hold_status: "needs_review",
          deposit_hold_payment_intent_id: newIntent.id,
          deposit_hold_expires_at: null,
          deposit_hold_payment_method_id: card.id,
          deposit_hold_stripe_customer_id: customerId,
          deposit_hold_last_error: `Replacement PaymentIntent is ${piStatus}${lastError?.message ? `: ${lastError.message}` : ""}`.slice(0, 500),
          deposit_hold_last_error_code: code,
          deposit_hold_failure_count: priorFailures + 1,
          deposit_hold_next_retry_at: null,
        },
        "needs_review",
        `replacement PaymentIntent is ${piStatus} — flagged for review`,
        newIntent.id,
        {
          // Same inversion as the 3DS exit: an id is recorded, no funds are
          // held. 'requires_payment_method' is dead — the renter is definitely
          // unsecured. 'processing' / 'requires_confirmation' may still become a
          // live authorization, so we refuse to characterise it either way and
          // let the reconciler settle it against Stripe.
          money: piStatus === "requires_payment_method" ? "unsecured" : "unknown",
          alertDetail:
            piStatus === "requires_payment_method"
              ? null
              : `The replacement is still ${piStatus} at Stripe; it may yet settle, so check the rental before re-placing a hold.`,
        }
      );
    }

    // ── Success. Record the REAL window and its provenance. ────────────────
    const window = await readHoldWindow(stripe, newIntent, stripeOptions, now);
    const verifiedFromStripe = window.source === "stripe_capture_before";
    // An adopted orphan was authorized on an earlier attempt; its placement
    // time is Stripe's, not ours.
    const placedAt = adoptedOrphan && typeof newIntent.created === "number"
      ? new Date(newIntent.created * 1000).toISOString()
      : now.toISOString();

    const applied = await casUpdate(
      supabase,
      rentalId,
      {
        deposit_hold_status: "held",
        deposit_hold_payment_intent_id: newIntent.id,
        deposit_hold_placed_at: placedAt,
        deposit_hold_expires_at: window.expiresAt,
        deposit_hold_expiry_source: window.source,
        deposit_hold_window_seconds: window.windowSeconds,
        // Tri-state, NOT a boolean-with-a-default. `null` means "Stripe did not
        // tell us", which is a different fact from "the network said no" —
        // HoldExpiryFacts in _shared/stripe-client.ts makes the same
        // distinction ("null when unknown (never assume)"). Writing `false` on
        // the fallback path claimed knowledge we do not have.
        deposit_hold_extended_auth:
          window.extendedAuthStatus === null ? null : window.extendedAuthStatus === "enabled",
        // Only stamp "verified" when Stripe actually published the deadline. On
        // the fallback path the expiry is an admitted guess
        // (deposit_hold_expiry_source = 'fallback'); stamping it verified would
        // let a downstream "verified recently?" check trust a value nothing
        // verified. Left untouched so the previous genuine verification (or
        // NULL) stands.
        ...(verifiedFromStripe ? { deposit_hold_verified_at: now.toISOString() } : {}),
        deposit_hold_payment_method_id: card.id,
        deposit_hold_stripe_customer_id: customerId,
        deposit_hold_card_brand: window.cardBrand ?? card.brand,
        deposit_hold_card_last4: window.cardLast4 ?? card.last4,
        deposit_hold_card_exp_month: card.expMonth,
        deposit_hold_card_exp_year: card.expYear,
        deposit_hold_card_funding: window.cardFunding ?? card.funding,
        // Anchor legacy rows so the NEXT link never has to re-derive any of this.
        deposit_hold_connect_account_id: connectAccountId,
        deposit_hold_stripe_mode: stripeMode,
        deposit_hold_currency: currency,
        deposit_hold_failure_count: 0,
        deposit_hold_next_retry_at: null,
        deposit_hold_last_error: null,
        deposit_hold_last_error_code: null,
      },
      { status: "refreshing", paymentIntentId: incumbentPi }
    );

    if (!applied) {
      // Somebody else owns the row (release, capture, a competing worker). The
      // authorization we just created belongs to nobody, so cancel it rather
      // than leave a live hold on the renter's card that nothing can find.
      const orphaned = await cancelUnrecorded("row changed owner mid-refresh");
      await closeLink(link, {
        outcome: orphaned ? "orphaned" : "failed",
        payment_intent_id: newIntent.id,
        error_code: "lost_race",
        error_message: orphaned
          ? "row changed owner mid-refresh; replacement authorization could NOT be cancelled"
          : "row changed owner mid-refresh; replacement authorization cancelled",
      });
      if (orphaned) {
        // The single worst state the engine can produce: the authorization is
        // live at Stripe, the rental points elsewhere, and closing the link as
        // 'orphaned' puts it outside every reconciler sweep. Ring the bell with
        // the id in it — a human in the Stripe dashboard is the only route back.
        await alertOrphanedAuthorization(
          newIntent.id,
          "another worker took the rental after the replacement authorization had been created"
        );
      }
      return {
        rentalId,
        result: "lost_race",
        message: orphaned
          ? `row changed owner mid-refresh and the replacement ${newIntent.id} could NOT be cancelled — needs manual cancellation`
          : "row changed owner mid-refresh; replacement authorization cancelled",
        untouched: false,
        paymentIntentId: newIntent.id,
      };
    }

    // Safely recorded — it is the rental's hold now, not an orphan candidate.
    unrecordedIntentId = null;

    const how = adoptedOrphan ? "adopted" : "refreshed";

    await closeLink(link, {
      outcome: "succeeded",
      payment_intent_id: newIntent.id,
      capture_before: window.captureBefore,
      extended_auth_status: window.extendedAuthStatus,
      card_funding: window.cardFunding ?? card.funding,
      ...(adoptedOrphan
        ? {
            error_message:
              "adopted an untracked authorization from a previous attempt instead of creating a second one",
          }
        : {}),
    });

    console.log(
      `${log} ${rentalId}: ${how} ${incumbentPi ?? "(none)"} -> ${newIntent.id}`,
      `expires ${window.expiresAt} (${window.source})`,
      `card ${card.source}:${card.brand ?? "?"}••${card.last4 ?? "??"}`
    );
    return {
      rentalId,
      result: "refreshed",
      message: `${how} to ${newIntent.id}, capturable until ${window.expiresAt} (${window.source})`,
      paymentIntentId: newIntent.id,
      expiresAt: window.expiresAt,
      untouched: false,
    };
  } catch (err) {
    // Anything that escaped the classified paths above. The row is still ours
    // at 'refreshing', so hand it back as RECOVERABLE — never as terminal
    // 'expired', which is what ended chains silently.
    const failureClass = classifyStripeFailure(err);
    const code = stripeErrorCode(err);
    const message = String((err as Error)?.message ?? err).slice(0, 500);
    const failureCount = priorFailures + 1;
    console.error(`${log} ${rentalId}: unhandled refresh failure (${failureClass}/${code}):`, err);

    // If we got as far as creating a replacement but never recorded it (e.g. the
    // success write itself failed), it is invisible to the whole product and
    // must not be left holding the renter's money.
    const orphaned = await cancelUnrecorded("unhandled failure after the replacement was created");

    const terminalReview = failureClass === "ambiguous" || orphaned || failureCount >= MAX_HOLD_ATTEMPTS;
    try {
      const outcome = await finish(
        {
          deposit_hold_status: terminalReview ? "needs_review" : "failed",
          deposit_hold_failure_count: failureCount,
          deposit_hold_last_error: message,
          deposit_hold_last_error_code: code,
          deposit_hold_next_retry_at: terminalReview
            ? null
            : computeRetryAt(failureClass, priorFailures, storedExpiresAt, now),
        },
        terminalReview ? "needs_review" : "failed",
        `unhandled failure (${code}): ${message}`,
        {
          // This catch can be reached from BOTH sides of the cancel — a throw in
          // the pre-cancel section leaves the incumbent live, a throw after it
          // leaves nothing. We cannot tell which from here, so we make no claim
          // about the renter's money at all.
          money: "unknown",
          failureClass,
          // NAME THE PaymentIntent. "A replacement could not be cancelled" is
          // not an actionable sentence — the only route back to that money is
          // somebody opening that id in the Stripe dashboard.
          alertDetail: orphaned
            ? `A replacement authorization${strandedIntentId ? ` (${strandedIntentId})` : ""} was created at ` +
              `Stripe and could NOT be cancelled` +
              `${unrecordedCleanupFailure ? ` — ${unrecordedCleanupFailure}` : ""}. ` +
              `It is not linked to this rental, so nothing in the portal can find, capture or release it: ` +
              `open it in the Stripe dashboard and cancel it by hand, and check it before placing another ` +
              `hold on this renter's card.`
            : null,
        }
      );
      // finish() stays SILENT when its CAS did not apply — correct, because the
      // row then carries the winner's state and describing our patch would
      // describe a rental that does not exist. But the stranded authorization is
      // ours either way and is nobody's state: it needs its own bell, or losing
      // the race a second time hides it completely.
      // Read into a const first: `strandedIntentId` is assigned inside a nested
      // closure, so this is the one form that both narrows and cannot change
      // between the guard and the call.
      const stranded = strandedIntentId;
      if (orphaned && outcome.result === "lost_race" && stranded) {
        await alertOrphanedAuthorization(
          stranded,
          "the refresh failed after the authorization was created, and the rental then changed owner"
        );
      }
      return outcome;
    } catch (writeErr) {
      // The database is the thing that is broken. The row stays 'refreshing';
      // say so loudly rather than pretending we settled it.
      console.error(`${log} ${rentalId}: could not record the failure — row left at 'refreshing':`, writeErr);
      // ALERT — exit 2 of 3 that does NOT go through finish(), and the worst
      // state in the engine: the row is stranded at 'refreshing', which is NOT
      // in REFRESHABLE_HOLD_STATUSES, so the nightly driver will never look at
      // this rental again. Only reconcile-deposit-holds un-strands it, and that
      // has no alerting of its own. If this bell does not ring, nothing does.
      await alertFailure({
        result: "needs_review",
        // The DB status is 'refreshing' — we deliberately do NOT pass a patch,
        // and assert the alerting status explicitly, so the helper describes the
        // situation rather than a status write that never landed.
        status: "needs_review",
        message: `unhandled failure (${code}): ${message}`,
        moneyState: "unknown",
        failureClass,
        errorCode: code,
        errorMessage: message,
        failureCount,
        detail:
          `The status write ALSO failed, so this rental is stuck at 'refreshing': the nightly refresh ` +
          `will not pick it up again until the hold status is reset.` +
          (orphaned
            ? ` A replacement authorization${strandedIntentId ? ` (${strandedIntentId})` : ""} was also ` +
              `created at Stripe and could NOT be cancelled — cancel it by hand.`
            : ""),
      });
      return {
        rentalId,
        result: "needs_review",
        message: `unhandled failure (${code}): ${message}; the status write also failed, row is stuck at 'refreshing'`,
        untouched: false,
      };
    }
  }
}
