/**
 * useDepositHoldAlerts — "is any car out on the road with no deposit behind it?"
 *
 * WHY THIS EXISTS
 * On 14 Aug 2026 GMT had FOUR active rentals carrying zero live authorisations.
 * Nothing on screen said so. The only signal was an in-app notification
 * (`notifications.type = 'deposit_hold_failure'`) that nobody opened, because a
 * notification is a thing you go and look at and this is a thing that has to
 * come and find you. This hook is the data layer for the top-of-app banner that
 * does the finding.
 *
 * ONE QUERY, EVERY PAGE
 * The banner mounts in the dashboard layout, so this runs everywhere. It is a
 * single PostgREST round trip against `rentals`, narrowed server-side to rows
 * that could possibly be a problem, then classified in TS. React Query dedupes
 * on the shared key, so N banner components still cost one request.
 *
 * WHAT IT REFUSES TO ALARM ABOUT — the false positives matter as much as the
 * true ones, because a banner that cries wolf gets dismissed forever on day two:
 *   - a released/expired hold on a FINISHED rental. That is the system working.
 *     Terminal rental statuses are a DENY list lifted from
 *     `_shared/deposit-hold-refresh.ts` (TERMINAL_RENTAL_STATUSES), not an allow
 *     list, so a lifecycle status nobody enumerated keeps the rental in scope
 *     rather than silently dropping it.
 *   - a hold a human deliberately let go. `deposit_hold_release_requested_at` is
 *     positive evidence an operator asked; `reconcile-deposit-holds` treats it
 *     the same way when it decides released-vs-expired.
 *   - a rental that never wanted a deposit. A NULL hold status is only a problem
 *     when a deposit was actually EXPECTED — see resolveExpectedDeposit, which
 *     mirrors `_shared/deposit-amount.ts`. An explicit
 *     `deposit_amount_override = 0` means the operator opted this rental out.
 *   - a future-dated rental. The hold is placed at start, so a Pending rental
 *     that has not begun is not yet unsecured.
 *   - `processing` / `refreshing` / `capturing`. Mid-flight and owned by another
 *     worker — unless it has been sitting there over an hour, which is the same
 *     stuck-row condition the refresh driver already counts.
 *
 * AND THE THING IT SAYS INSTEAD OF PANICKING
 * A `failed` row with `deposit_hold_next_retry_at` in the future is ALREADY
 * being retried on a backoff by the nightly driver. The tenant does not need to
 * do anything, and telling them to act would be wrong. Those come back with
 * `isSelfHealing: true` so the banner can say "we're retrying this automatically"
 * instead of shouting. Once `deposit_hold_failure_count >= MAX_HOLD_ATTEMPTS`
 * the retries are spent and a human genuinely is the next step.
 *
 * @see supabase/functions/_shared/deposit-hold-refresh.ts — the chain engine
 * @see supabase/functions/_shared/deposit-amount.ts — expected-amount resolution
 * @see supabase/functions/reconcile-deposit-holds/index.ts — the 6-hourly sweep
 */
"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

// ---------------------------------------------------------------------------
// Constants mirrored from the edge layer
// ---------------------------------------------------------------------------

/**
 * Rental lifecycle states that END a deposit chain. Verbatim from
 * `_shared/deposit-hold-refresh.ts`. A DENY list on purpose: an unknown status
 * keeps the rental visible to this hook, where the worst case is a banner the
 * operator dismisses. An allow list would make it invisible, which is the exact
 * silent-death mode the deposit workstream exists to kill.
 */
export const TERMINAL_RENTAL_STATUSES = [
  "Closed",
  "Completed",
  "Cancelled",
  // Both spellings are treated as terminal elsewhere in the codebase, so both
  // exist in somebody's data.
  "Canceled",
  "Rejected",
] as const;

/** Retry ceiling in `_shared/deposit-hold-refresh.ts`. Past this, backoff is spent. */
const MAX_HOLD_ATTEMPTS = 8;

/**
 * Tenants whose per-vehicle `deposit_mode` is actually honoured when placing a
 * hold. Mirrors PER_VEHICLE_DEPOSIT_TENANT_IDS in `_shared/deposit-amount.ts`.
 *
 * This is duplicated rather than imported because the edge module is Deno and
 * this is the Next bundle. It is here at all because getting it wrong SUPPRESSES
 * alarms: for a `per_vehicle` tenant NOT in this set the real placement path
 * falls through to the tenant global, so reading a vehicle's own figure would
 * make us expect a deposit that was never going to be placed (noise) — or, with
 * the polarity flipped, ignore one that was (silence). Keep in step with the
 * edge constant.
 */
const PER_VEHICLE_DEPOSIT_TENANT_IDS: ReadonlySet<string> = new Set([
  "ada84c6f-eb17-43b6-a14d-d16518165349", // globalmotiontransport (GMT)
]);

/** How close to the Stripe deadline before we start warning. */
const EXPIRY_WARNING_DAYS = 3;

/**
 * How long after a rental's end date we keep raising deposit alarms.
 *
 * Every alarm here means "the car is out and uncovered", which stops being true
 * once it is back. But a late return is exactly when a live deposit still
 * matters, so we do not go silent at the stroke of the end date.
 */
const FINISHED_RENTAL_GRACE_MS = 24 * 60 * 60 * 1000;

/** How long a mid-flight status may sit before it is considered stuck. */
const STALL_THRESHOLD_MS = 60 * 60 * 1000;

/**
 * Payload guard. A tenant with deposits enabled and no holds ever placed would
 * otherwise pull every non-terminal rental. Nobody reads a banner listing 200
 * rentals, and this runs on every page.
 */
const MAX_ROWS = 200;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DepositHoldIssueKind =
  /** No live authorisation and the car is out. The money is not ringfenced. */
  | "unsecured"
  /** SCA — only the CARDHOLDER can clear this. Staff cannot fix it themselves. */
  | "action_required"
  /** Dead end. A human has to look at it. */
  | "needs_review"
  /** Still held, but the authorisation deadline is close. */
  | "expiring"
  /** A worker started something and never finished. */
  | "stalled";

export type DepositHoldSeverity = "critical" | "warning" | "info";

export interface DepositHoldIssue {
  rentalId: string;
  /** Human-facing reference, e.g. "R-161fe1". Falls back to a short id. */
  rentalNumber: string;
  rentalStatus: string | null;
  customerId: string | null;
  customerName: string | null;
  /** "Tesla Model 3 · AB12 CDE", best-effort. */
  vehicleLabel: string | null;

  holdStatus: string | null;
  /** Amount actually held, or the amount that SHOULD have been. Major units. */
  amount: number;
  currency: string;
  expiresAt: string | null;
  startDate: string;
  endDate: string | null;

  kind: DepositHoldIssueKind;
  severity: DepositHoldSeverity;
  /** One short sentence naming what happened, in the operator's language. */
  headline: string;
  /** One sentence saying what happens next. Never blames the operator. */
  detail: string;

  /** True when the nightly driver will retry this without anyone doing anything. */
  isSelfHealing: boolean;
  nextRetryAt: string | null;
  failureCount: number;
  /** Backoff is spent — retries will not resolve this on their own. */
  retriesExhausted: boolean;

  lastError: string | null;
  lastErrorCode: string | null;
  hasPaymentIntent: boolean;

  /** Deep link straight to the rental that has the problem. */
  href: string;
}

export interface DepositHoldAlerts {
  issues: DepositHoldIssue[];
  total: number;
  /** Counts per kind, for a banner that wants "3 unsecured, 1 needs you". */
  counts: Record<DepositHoldIssueKind, number>;
  /** Number of rentals with no live authorisation at all — the headline number. */
  unsecuredCount: number;
  /** Highest severity present, or null when everything is fine. */
  severity: DepositHoldSeverity | null;
  /** The single worst issue — what a one-line banner should describe. */
  worst: DepositHoldIssue | null;
  /**
   * Set ONLY when there is exactly one issue, so the banner can deep-link to
   * that rental. Null when there are several — then link to `href` instead.
   */
  singleRental: DepositHoldIssue | null;
  /** The one rental when there is one, otherwise the rentals list. */
  href: string;
  /** Every issue is self-healing — the banner should be calm, not red. */
  allSelfHealing: boolean;
  /** Hit MAX_ROWS; counts are a floor, not a total. */
  truncated: boolean;
}

/** Shape of one row as it comes back from PostgREST. */
interface DepositHoldRow {
  id: string;
  rental_number: string | null;
  status: string | null;
  start_date: string;
  end_date: string | null;
  customer_id: string | null;
  vehicle_id: string | null;
  deposit_amount_override: number | null;
  deposit_hold_status: string | null;
  deposit_hold_status_changed_at: string | null;
  deposit_hold_amount: number | null;
  deposit_hold_currency: string | null;
  deposit_hold_expires_at: string | null;
  deposit_hold_placed_at: string | null;
  deposit_hold_release_requested_at: string | null;
  deposit_hold_last_error: string | null;
  deposit_hold_last_error_code: string | null;
  deposit_hold_next_retry_at: string | null;
  deposit_hold_failure_count: number | null;
  deposit_hold_payment_intent_id: string | null;
  customers: { name: string | null } | null;
  vehicles: {
    reg: string | null;
    make: string | null;
    model: string | null;
    security_deposit: number | null;
  } | null;
}

/**
 * Exactly the columns the classifier reads, and no more. Every field here is
 * used below — this is a banner on every page, not a rental detail view.
 */
const ALERT_COLUMNS = `
  id,
  rental_number,
  status,
  start_date,
  end_date,
  customer_id,
  vehicle_id,
  deposit_amount_override,
  deposit_hold_status,
  deposit_hold_status_changed_at,
  deposit_hold_amount,
  deposit_hold_currency,
  deposit_hold_expires_at,
  deposit_hold_placed_at,
  deposit_hold_release_requested_at,
  deposit_hold_last_error,
  deposit_hold_last_error_code,
  deposit_hold_next_retry_at,
  deposit_hold_failure_count,
  deposit_hold_payment_intent_id,
  customers!rentals_customer_id_fkey(name),
  vehicles!rentals_vehicle_id_fkey(reg, make, model, security_deposit)
`;

// ---------------------------------------------------------------------------
// Expected-deposit resolution
// ---------------------------------------------------------------------------

interface DepositConfig {
  tenantId: string;
  securityDepositEnabled: boolean;
  globalDepositAmount: number;
  depositMode: string | null;
}

/**
 * "Was a deposit ever going to be placed on this rental?"
 *
 * Mirrors `resolveDepositAmount` in `_shared/deposit-amount.ts`, minus the
 * async vehicle lookup — we already have the vehicle embedded.
 *
 *   1. `deposit_amount_override` when non-NULL, INCLUDING an explicit 0. Zero
 *      means the operator unchecked the deposit for this rental; treating it as
 *      "unset" is how a default hold used to get placed against someone who had
 *      opted out, and here it would be how they get nagged about it forever.
 *   2. `vehicles.security_deposit`, only for an allow-listed `per_vehicle` tenant
 *      carrying a non-NULL figure.
 *   3. `tenants.global_deposit_amount`.
 *
 * The base is resolved FIRST and the override only wins when it is a finite
 * number, which is the edge function's exact shape (`normalisedOverride`) and
 * not a stylistic choice. Collapsing it to `Number(override) || 0` maps a
 * non-finite override to 0, and 0 here means "no deposit was expected", which
 * SILENCES the banner on a rental that was in fact meant to carry one. Every
 * ambiguity on this path has to fall towards showing the operator something.
 */
function resolveExpectedDeposit(row: DepositHoldRow, config: DepositConfig): number {
  let base = config.globalDepositAmount;

  if (
    config.depositMode === "per_vehicle" &&
    PER_VEHICLE_DEPOSIT_TENANT_IDS.has(config.tenantId) &&
    row.vehicles?.security_deposit != null
  ) {
    base = Number(row.vehicles.security_deposit) || 0;
  }

  const raw = row.deposit_amount_override;
  const override = raw !== null && raw !== undefined ? Number(raw) : null;

  return override !== null && Number.isFinite(override) ? override : base;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<DepositHoldSeverity, number> = {
  critical: 3,
  warning: 2,
  info: 1,
};

function vehicleLabel(row: DepositHoldRow): string | null {
  const v = row.vehicles;
  if (!v) return null;
  const name = [v.make, v.model].filter(Boolean).join(" ").trim();
  if (name && v.reg) return `${name} · ${v.reg}`;
  return name || v.reg || null;
}

function daysUntil(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((t - now) / 86_400_000);
}

/**
 * Turn one row into an issue, or null when it is not actually a problem.
 *
 * Every `return null` here is a false positive we are deliberately declining to
 * raise; each one is explained where it sits.
 */
function classify(
  row: DepositHoldRow,
  config: DepositConfig,
  fallbackCurrency: string,
  now: number,
): DepositHoldIssue | null {
  // ── The rental is over. Say nothing. ──────────────────────────────────────
  //
  // Every alarm below is a variation on "the car is out and uncovered", which
  // stops being true the moment the car comes back. The DB `status` column is
  // NOT sufficient to tell: it stays 'Active' until a human explicitly closes
  // the rental, while the portal itself derives "Completed" from end_date alone
  // (see getRentalStatus in @/lib/rental-utils). So a returned-but-not-closed
  // rental with a dead hold — which is the NORMAL end state, since the deposit
  // is released on handback — would otherwise raise a permanent red app-wide
  // banner that no action can ever clear.
  //
  // A false red alarm is not a small bug here. It is the mechanism by which
  // operators learn to ignore this banner, and the one real alarm then goes
  // unread with it. Grace: keep watching for a day past the end date, because a
  // late return is exactly when a live deposit still matters.
  const endMs = row.end_date ? Date.parse(row.end_date) : Number.NaN;
  if (Number.isFinite(endMs) && now > endMs + FINISHED_RENTAL_GRACE_MS) return null;

  const holdStatus = row.deposit_hold_status;
  const failureCount = Number(row.deposit_hold_failure_count) || 0;
  const nextRetryAt = row.deposit_hold_next_retry_at;
  const retryPending =
    !!nextRetryAt && !Number.isNaN(Date.parse(nextRetryAt)) && Date.parse(nextRetryAt) > now;
  const retriesExhausted = failureCount >= MAX_HOLD_ATTEMPTS;
  const expectedAmount = resolveExpectedDeposit(row, config);
  const heldAmount = Number(row.deposit_hold_amount) || 0;

  let kind: DepositHoldIssueKind;
  let severity: DepositHoldSeverity;
  let headline: string;
  let detail: string;

  switch (holdStatus) {
    // -- Never secured -----------------------------------------------------
    case null:
    case undefined: {
      // Mode 2: the initial hold was declined (or never attempted) and the car
      // went out anyway. Only a problem if a deposit was expected at all — for a
      // tenant who does not take deposits, or a rental the operator opted out of,
      // NULL is the correct and permanent state.
      if (expectedAmount <= 0) return null;
      kind = "unsecured";
      severity = "critical";
      headline = "No deposit was ever secured on this rental";
      detail =
        "The card was never successfully authorised, so nothing is ringfenced. Take a new hold from the rental page.";
      break;
    }

    // -- Failed ------------------------------------------------------------
    case "failed": {
      // Mode 1: a renewal was declined (insufficient_funds is the common one),
      // so the previous authorisation is gone and the replacement never landed.
      kind = "unsecured";
      severity = "critical";
      const everPlaced = !!row.deposit_hold_placed_at || !!row.deposit_hold_payment_intent_id;
      headline = everPlaced
        ? "A deposit hold could not be renewed"
        : "A deposit hold could not be placed";
      if (retriesExhausted) {
        detail =
          "We have retried as far as we can and the card keeps declining. This one needs you — try a different card or contact the customer.";
      } else if (retryPending) {
        // The anti-panic branch. Nothing is required of the operator here.
        detail = "We will retry this automatically. No action needed yet.";
        severity = "warning";
      } else {
        detail =
          "The card was declined, so no money is currently held. You can retry the hold from the rental page.";
      }
      break;
    }

    // -- Expired -----------------------------------------------------------
    case "expired": {
      // Stripe confirmed the authorisation is gone and the funds are back with
      // the renter, but the rental is still running.
      kind = "unsecured";
      severity = "critical";
      headline = "The deposit hold has expired";
      detail =
        "The authorisation ran out and the funds went back to the customer. Place a new hold to re-secure this rental.";
      break;
    }

    // -- Released ----------------------------------------------------------
    case "released": {
      // Mode 3. But a release someone ASKED for is not a fault —
      // `deposit_hold_release_requested_at` is the same positive evidence
      // reconcile-deposit-holds uses to tell a staff release apart from a
      // silent network expiry. Nagging an operator about a button they pressed
      // on purpose is how banners get ignored.
      if (row.deposit_hold_release_requested_at) return null;
      kind = "unsecured";
      severity = "critical";
      headline = "The deposit was released while the rental is still running";
      detail =
        "The hold came off before the car came back, so nothing is secured right now. Place a new hold if this was not intentional.";
      break;
    }

    // -- SCA ---------------------------------------------------------------
    case "requires_action": {
      // Mode 4. Worth its own kind because the resolution is NOT on this side of
      // the screen — no amount of clicking in the portal clears it.
      kind = "action_required";
      severity = "critical";
      headline = "The customer's bank needs them to confirm the deposit";
      detail =
        "Their card requires extra verification, which only the cardholder can complete. Send them the confirmation link from the rental page.";
      break;
    }

    // -- Dead ends ---------------------------------------------------------
    case "needs_review": {
      // Mode 5, including the reconciler's "held row with no PaymentIntent"
      // branch, which is honestly unknowable without a person.
      kind = "needs_review";
      severity = "warning";
      headline = "A deposit hold needs checking";
      detail =
        "We could not confirm the state of this hold automatically. Open the rental to see what happened.";
      break;
    }

    case "disputed": {
      kind = "needs_review";
      severity = "critical";
      headline = "The customer has disputed the deposit";
      detail =
        "The card issuer has opened a dispute on this authorisation. Open the rental for the details.";
      break;
    }

    // -- Healthy, or nearly ------------------------------------------------
    case "held": {
      // Mode 6, plus the NULL-expiry case. A `held` row with no known deadline
      // is not healthy: the driver sorts exactly those first as unsecured,
      // because `.lt()` against NULL yields NULL and they were invisible to the
      // due filter for a long time. Do not reintroduce that blind spot here.
      if (!row.deposit_hold_expires_at) {
        kind = "needs_review";
        severity = "warning";
        headline = "A deposit hold has no known expiry date";
        detail =
          "We are holding funds but cannot tell when the authorisation lapses. Open the rental so we can re-check it.";
        break;
      }
      const days = daysUntil(row.deposit_hold_expires_at, now);
      if (days === null || days > EXPIRY_WARNING_DAYS) return null;

      // ALREADY LAPSED. This branch used to fall through to the reassuring
      // "expires today / nothing to do" copy below, because a past deadline
      // gives a NEGATIVE day count which still satisfies `days <= 0`.
      //
      // That made the feature actively harmful: the card networks release a
      // hold on their own schedule and Stripe does not tell us, so a row can
      // sit at 'held' for days after the money has gone back. The operator
      // would have been shown "Nothing to do unless it fails" about a car that
      // was already uncovered — precisely the GMT failure this banner exists to
      // prevent, restated in a calmer voice.
      //
      // We cannot prove the funds are gone without asking Stripe, so the copy
      // says what we actually know: the deadline has passed and we can no
      // longer vouch for it.
      if (days < 0) {
        kind = "needs_review";
        severity = "critical";
        headline = "A deposit hold has passed its expiry date";
        detail =
          "The bank's hold on this card should have lapsed by now, so we can no longer confirm the deposit is in place. Open the rental to re-check it.";
        break;
      }

      kind = "expiring";
      severity = "info";
      headline =
        days === 0
          ? "A deposit hold expires today"
          : `A deposit hold expires in ${days} day${days === 1 ? "" : "s"}`;
      detail =
        "We renew these automatically before they lapse. Nothing to do unless it fails.";
      break;
    }

    // -- Mid-flight --------------------------------------------------------
    case "processing":
    case "refreshing":
    case "capturing": {
      // Owned by another worker and perfectly normal for a few seconds. Only a
      // problem once it has been sitting there for an hour — the same stuck-row
      // condition refresh-deposit-holds counts at the end of every run.
      const changedAt = row.deposit_hold_status_changed_at;
      const stalledSince = changedAt ? Date.parse(changedAt) : NaN;
      if (Number.isNaN(stalledSince) || now - stalledSince < STALL_THRESHOLD_MS) return null;
      kind = "stalled";
      severity = "warning";
      headline = "A deposit hold has been stuck mid-way";
      detail =
        "An update started but never finished. We will pick it up on the next run — open the rental if it stays this way.";
      break;
    }

    // -- Finished ----------------------------------------------------------
    case "captured":
      // The money was taken deliberately. Not a fault.
      return null;

    default:
      // An unrecognised status. Surface it quietly rather than dropping it —
      // the CHECK constraint has grown from 7 values to 11 once already, and
      // silently ignoring a twelfth is how the rental detail page ended up
      // telling operators "No hold placed" about four real broken states.
      kind = "needs_review";
      severity = "warning";
      headline = "A deposit hold is in an unexpected state";
      detail = "Open the rental so we can take a look at this one.";
      break;
  }

  return {
    rentalId: row.id,
    rentalNumber: row.rental_number || `#${row.id.slice(0, 8)}`,
    rentalStatus: row.status,
    customerId: row.customer_id,
    customerName: row.customers?.name ?? null,
    vehicleLabel: vehicleLabel(row),

    holdStatus: holdStatus ?? null,
    amount: heldAmount || expectedAmount,
    currency: row.deposit_hold_currency || fallbackCurrency,
    expiresAt: row.deposit_hold_expires_at,
    startDate: row.start_date,
    endDate: row.end_date,

    kind,
    severity,
    headline,
    detail,

    isSelfHealing: retryPending && !retriesExhausted,
    nextRetryAt: nextRetryAt ?? null,
    failureCount,
    retriesExhausted,

    lastError: row.deposit_hold_last_error,
    lastErrorCode: row.deposit_hold_last_error_code,
    hasPaymentIntent: !!row.deposit_hold_payment_intent_id,

    href: `/rentals/${row.id}`,
  };
}

const EMPTY_COUNTS: Record<DepositHoldIssueKind, number> = {
  unsecured: 0,
  action_required: 0,
  needs_review: 0,
  expiring: 0,
  stalled: 0,
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** Shared so mutations (place / release / capture / force refresh) can invalidate. */
export const depositHoldAlertsKey = (tenantId: string | undefined) =>
  ["deposit-hold-alerts", tenantId] as const;

export function useDepositHoldAlerts() {
  const { tenant } = useTenant();

  // Already loaded by TenantContext's single tenant select — no extra query.
  const tenantId = tenant?.id;
  const securityDepositEnabled = tenant?.security_deposit_enabled === true;
  const globalDepositAmount = Number(tenant?.global_deposit_amount) || 0;
  const depositMode = tenant?.deposit_mode ?? null;
  const currency = tenant?.currency_code || "USD";

  /**
   * Whether a MISSING hold can be a fault for this tenant at all.
   *
   * When deposits are switched off tenant-wide, a NULL status everywhere is the
   * correct state, and including that branch would pull every non-terminal
   * rental the tenant has for nothing. The already-broken statuses are still
   * checked either way — a hold that exists and failed is a fault regardless of
   * what the setting says today.
   */
  const canExpectDeposit =
    securityDepositEnabled && (globalDepositAmount > 0 || depositMode === "per_vehicle");

  const query = useQuery({
    queryKey: [...depositHoldAlertsKey(tenantId), canExpectDeposit],
    queryFn: async (): Promise<{ rows: DepositHoldRow[]; truncated: boolean }> => {
      if (!tenantId) return { rows: [], truncated: false };

      const now = Date.now();
      const expiryHorizon = new Date(now + EXPIRY_WARNING_DAYS * 86_400_000).toISOString();
      const stallBefore = new Date(now - STALL_THRESHOLD_MS).toISOString();
      // start_date is a DATE column, so compare with YYYY-MM-DD, not an ISO
      // timestamp — see the date-parity note in calculate-extension-price.ts.
      const today = new Date(now).toISOString().slice(0, 10);

      /**
       * The problem predicate. Kept to two levels of nesting, which is the depth
       * this repo already uses in `.or()` elsewhere (reminders-digest,
       * deposit-hold-refresh).
       */
      const branches = [
        // Broken or human-blocked states. `released` and `expired` are in here
        // because the rental is non-terminal — the rental filter below is what
        // makes them meaningful.
        "deposit_hold_status.in.(failed,requires_action,needs_review,disputed,expired,released)",
        // Still held but the deadline is close.
        `and(deposit_hold_status.eq.held,deposit_hold_expires_at.lt.${expiryHorizon})`,
        // Held with NO known deadline. A separate branch because `.lt()` against
        // NULL yields NULL, not true — the exact null-blindness that hid these
        // rows from the refresh driver's due filter.
        "and(deposit_hold_status.eq.held,deposit_hold_expires_at.is.null)",
        // Mid-flight for over an hour.
        `and(deposit_hold_status.in.(processing,refreshing,capturing),deposit_hold_status_changed_at.lt.${stallBefore})`,
      ];

      if (canExpectDeposit) {
        // Never secured — but only once the rental has actually started, since
        // the hold is placed at start and a future Pending rental is not late.
        branches.push(`and(deposit_hold_status.is.null,start_date.lte.${today})`);
      }

      const { data, error } = await supabase
        .from("rentals")
        .select(ALERT_COLUMNS)
        .eq("tenant_id", tenantId)
        // Terminal rentals are excluded, NULL-safely. `status NOT IN (...)`
        // evaluates to NULL for a NULL status and would drop the row — and
        // rentals.status is nullable. Two `.or()` calls are ANDed by PostgREST.
        .or(`status.is.null,status.not.in.(${TERMINAL_RENTAL_STATUSES.join(",")})`)
        .or(branches.join(","))
        // Oldest start first: the car that has been out longest with no deposit
        // behind it is the one to talk about.
        .order("start_date", { ascending: true })
        .limit(MAX_ROWS);

      if (error) throw error;

      const rows = (data ?? []) as unknown as DepositHoldRow[];
      return { rows, truncated: rows.length >= MAX_ROWS };
    },
    enabled: !!tenantId,

    // The global default is 60s; these rows move on a nightly cron and a
    // 6-hourly reconciler, so a slightly longer window costs nothing and this
    // query is mounted on every page.
    staleTime: 120_000,

    // A slow background poll, NOT realtime. `rentals` IS in the
    // supabase_realtime publication, but a per-tenant channel on it fires for
    // every mileage, charge and status write across the whole fleet — a lot of
    // socket traffic and cache invalidation on every page, to catch a value
    // that changes a couple of times a day.
    //
    // The poll cannot be dropped in favour of focus alone, because "expires
    // within 3 days" is a pure CLOCK event: the horizon is computed at query
    // time and NOTHING in the database changes when a rental crosses it. A tab
    // left open would never notice. Same reasoning as the grace-window poll in
    // use-tenant-subscription.ts.
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,

    // OVERRIDES the global refetchOnWindowFocus:false in providers.tsx, and it
    // is the one that matters most day to day. Deposit problems get resolved
    // somewhere ELSE — the Stripe dashboard, a phone call to the customer, the
    // customer completing SCA on their own device. The operator then switches
    // back to this tab expecting the warning to be gone. Without this they keep
    // staring at a banner about a problem they just fixed, which is precisely
    // how a banner earns a permanent dismissal.
    refetchOnWindowFocus: true,

    // A failure here must never take down the page it is mounted on.
    retry: 1,
  });

  const data = useMemo<DepositHoldAlerts>(() => {
    const rows = query.data?.rows ?? [];
    const truncated = query.data?.truncated ?? false;
    const now = Date.now();

    const config: DepositConfig = {
      tenantId: tenantId ?? "",
      securityDepositEnabled,
      globalDepositAmount,
      depositMode,
    };

    const issues = rows
      .map((row) => classify(row, config, currency, now))
      .filter((i): i is DepositHoldIssue => i !== null)
      // Worst first, then longest-suffering first, so `worst` and the head of
      // the list are the same rental.
      .sort((a, b) => {
        const bySeverity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
        if (bySeverity !== 0) return bySeverity;
        return a.startDate.localeCompare(b.startDate);
      });

    const counts = { ...EMPTY_COUNTS };
    for (const issue of issues) counts[issue.kind] += 1;

    const worst = issues[0] ?? null;
    const singleRental = issues.length === 1 ? issues[0] : null;

    return {
      issues,
      total: issues.length,
      counts,
      unsecuredCount: counts.unsecured,
      severity: worst?.severity ?? null,
      worst,
      singleRental,
      href: singleRental ? singleRental.href : "/rentals",
      allSelfHealing: issues.length > 0 && issues.every((i) => i.isSelfHealing),
      truncated,
    };
  }, [
    query.data,
    tenantId,
    securityDepositEnabled,
    globalDepositAmount,
    depositMode,
    currency,
  ]);

  return {
    ...query,
    data,
    /** Convenience for the banner's mount check. */
    hasIssues: data.total > 0,
  };
}

export default useDepositHoldAlerts;
