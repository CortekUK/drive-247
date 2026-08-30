/**
 * useDepositHoldBanners — the deposit-hold row in the app-wide banner stack.
 *
 * WHY THIS EXISTS
 * ---------------
 * GMT ran four active rentals with zero live deposit holds. Cars were out, no
 * money was ringfenced behind any of them, and the only signal was an in-app
 * notification nobody opened. This module is the loud half of the fix: it turns
 * the classified rows from `useDepositHoldAlerts` into ONE banner the operator
 * cannot miss on any page of the portal.
 *
 * THE TWO RULES THAT SHAPE EVERYTHING BELOW
 * -----------------------------------------
 * 1. AGGREGATE, NEVER PER-RENTAL. Six failed holds produce one banner reading
 *    "6 active rentals have no deposit held", never six bars. This file emits
 *    AT MOST ONE `AppBanner` no matter how many things are wrong, so the deposit
 *    feature can never crowd MaintenanceBanner or the Xero banner out of the
 *    host. The highest-precedence cohort gets the full bar; every other live
 *    cohort collapses into one compact chip row underneath, each chip deep-
 *    linking to its own filtered list. Nothing is hidden behind a timer.
 *
 * 2. "WE ARE ON IT" MUST NOT LOOK LIKE "NOBODY IS COMING". A declined renewal
 *    that already has a retry scheduled is the engine's ONLY self-recovering
 *    exit — `isSelfHealing` on the issue. It renders amber, with a ghost CTA and
 *    copy that says outright there is nothing to do. Collapsing it into the red
 *    "no deposit held" banner would make every transient decline look like an
 *    emergency, which is exactly how the original GMT notification got trained
 *    into invisibility.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT RENDER
 * -------------------------------------------
 * `kind === "expiring"` (a healthy hold whose authorisation deadline is near) is
 * a QUIET SIGNAL, not a banner. The chain renews these automatically; the hook
 * already grades them `info` with "Nothing to do unless it fails". Putting a bar
 * on the screen for the system working correctly is the fastest way to make the
 * operator stop reading the slot.
 */
"use client";

import { useMemo } from "react";
import Link from "next/link";

import { useTenant } from "@/contexts/TenantContext";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { formatCurrency } from "@/lib/format-utils";
import {
  useDepositHoldAlerts,
  type DepositHoldIssue,
  type DepositHoldSeverity,
} from "@/hooks/use-deposit-hold-alerts";
import { fingerprint, type AppBanner, type BannerSeverity } from "../banner-types";

// ---------------------------------------------------------------------------
// Cohorts
// ---------------------------------------------------------------------------

/**
 * A cohort is a group of rentals that share ONE fix and ONE person who has to
 * perform it. That is the axis a tenant-facing banner needs — the admin health
 * table sorts by how broken a row is, but an operator only ever wants to know
 * "what do I do, and is it even mine to do".
 */
export type DepositCohortKey =
  | "disputed"
  | "unsecured"
  | "needs_customer"
  | "unconfirmed"
  | "pre_handover"
  | "retrying";

/**
 * Cohorts that genuinely clear themselves, and are therefore the only ones safe
 * to dismiss permanently.
 *
 *  * retrying — the engine has a scheduled next attempt and will act on it.
 *  * pre_handover — the car has not gone out; there is nothing at risk yet.
 *
 * Everything else describes a vehicle without confirmed cover. Those snooze for
 * a day and come back, because nothing in the system will fix them unattended.
 */
const SELF_RESOLVING_COHORTS: ReadonlySet<DepositCohortKey> = new Set([
  "retrying",
  "pre_handover",
]);

/**
 * Precedence. Each rental lands in AT MOST ONE cohort, assigned by first match,
 * so the counts across the bar and the chips can never double-count the same
 * car. Ordered by how much money is exposed and how fast it walks away.
 */
const COHORT_PRECEDENCE: readonly DepositCohortKey[] = [
  "disputed",
  "unsecured",
  "needs_customer",
  "unconfirmed",
  "pre_handover",
  "retrying",
] as const;

const PRE_HANDOVER_WINDOW_MS = 48 * 60 * 60 * 1000;

/** Safari-safe, and tolerant of both DATE and TIMESTAMP columns. */
function parseWhen(value: string | null): number | null {
  if (!value) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const ms = dateOnly
    ? new Date(
        Number(value.slice(0, 4)),
        Number(value.slice(5, 7)) - 1,
        Number(value.slice(8, 10)),
      ).getTime()
    : Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

const isPending = (issue: DepositHoldIssue) =>
  (issue.rentalStatus ?? "").toLowerCase() === "pending";

/**
 * Assign one issue to one cohort.
 *
 * The order of these checks encodes each state's own trigger, not just the
 * precedence list. B1 ("active rentals have no deposit held") and B3 both
 * require the rental to be Active, so a rental that has NOT started yet has to
 * be caught first — otherwise a Pending handover tomorrow gets described to the
 * operator as a car already out on the road, which is both wrong and panic-
 * inducing.
 */
export function cohortOf(issue: DepositHoldIssue, now: number): DepositCohortKey | null {
  // A dispute is live money against a bank deadline, at ANY rental status —
  // including a closed one. Missing the deadline forfeits the money outright,
  // so this outranks everything.
  if (issue.holdStatus === "disputed") return "disputed";

  // Only the cardholder can clear SCA or replace a dead card. Valid on Active
  // AND Pending rentals, which is why it sits above the pre-handover check.
  if (issue.kind === "action_required") return "needs_customer";

  // Not handed over yet: cheaper to fix at the counter than to chase later.
  if (isPending(issue)) {
    const startsAt = parseWhen(issue.startDate);
    if (startsAt !== null && startsAt - now <= PRE_HANDOVER_WINDOW_MS) return "pre_handover";
    // A Pending rental further out still falls through to its kind below rather
    // than being dropped. Silently having no cohort is the exact bug that made
    // GMT's rentals render nowhere; every issue the hook raises gets a home.
  }

  if (issue.kind === "unsecured") {
    // The single most important distinction in this file. A retry already on the
    // clock is not an emergency and must not be coloured like one.
    return issue.isSelfHealing ? "retrying" : "unsecured";
  }

  if (issue.kind === "needs_review" || issue.kind === "stalled") return "unconfirmed";

  // `expiring` — the chain renews it. Quiet signal, handled on the rental page.
  return null;
}

// ---------------------------------------------------------------------------
// Language
// ---------------------------------------------------------------------------

/** Counts above 99 render as "99+" so the bar cannot break its layout. */
const displayCount = (n: number) => (n > 99 ? "99+" : String(n));

/**
 * The hook never returns a null reference — it synthesises `#1a2b3c4d` from the
 * id when `rental_number` is null. A synthetic id is not a name an operator
 * recognises, so we fall back to "1 rental has…" exactly as the copy rules ask
 * rather than reading a UUID fragment out loud.
 */
const namedRef = (issue: DepositHoldIssue): string | null =>
  issue.rentalNumber && !issue.rentalNumber.startsWith("#") ? issue.rentalNumber : null;

/**
 * "Sep 12". Locale pinned to en-US to match the rest of the portal — the
 * rentals pages already format short dates this way, and one bar disagreeing
 * with every screen it links to reads as a bug.
 */
const formatDay = (value: string | null): string | null => {
  const ms = parseWhen(value);
  if (ms === null) return null;
  return new Date(ms).toLocaleDateString("en-US", { day: "numeric", month: "short" });
};

/**
 * "in about 4 hours" / "tomorrow morning".
 *
 * Deliberately approximate. A precise timestamp invites the operator to sit and
 * watch the clock over something that needs none of their attention.
 */
function approximateWhen(targetMs: number, now: number): string {
  const diff = targetMs - now;
  if (diff <= 0) return "due now";

  const hours = diff / 3_600_000;
  if (hours < 1) return "within the hour";
  if (hours < 1.5) return "in about an hour";
  if (hours < 24) return `in about ${Math.round(hours)} hours`;

  const target = new Date(targetMs);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const dayGap = Math.floor((target.getTime() - startOfToday.getTime()) / 86_400_000);

  if (dayGap === 1) return target.getHours() < 12 ? "tomorrow morning" : "tomorrow";
  return `in about ${Math.round(hours / 24)} days`;
}

/**
 * MONEY CLAUSE — silence beats a guess on a money path.
 *
 * Rendered only when EVERY rental in the cohort carries an amount and they all
 * share a currency. A total that is quietly short is worse than no total: the
 * operator budgets against it. Mirrors the deposit-hold-notify module's rule.
 */
function moneyClause(issues: DepositHoldIssue[], cohort: DepositCohortKey): string | null {
  // Suppressed wherever the total would CONTRADICT the sentence above it.
  //
  //  * unconfirmed — the copy says in its own words that we cannot confirm these
  //    holds, so printing a confident total underneath is self-defeating.
  //  * retrying — the copy says "we will try again automatically, nothing to do".
  //    Appending "that is $4,000 of cover you do not have" flatly negates it and
  //    is exactly the panic this banner was asked not to cause.
  //  * pre_handover — the car has not left the forecourt. There is no exposure
  //    yet, so a figure framed as money-at-risk is simply untrue.
  if (cohort === "unconfirmed" || cohort === "retrying" || cohort === "pre_handover") return null;
  if (issues.length === 0 || issues.some((i) => !(i.amount > 0))) return null;

  const currency = issues[0].currency;
  if (issues.some((i) => i.currency !== currency)) return null;

  const total = formatCurrency(
    issues.reduce((sum, i) => sum + i.amount, 0),
    currency,
    { maximumFractionDigits: 0, minimumFractionDigits: 0 },
  );

  return cohort === "disputed"
    ? `${total} is with the bank while it investigates.`
    : `That is ${total} of cover you do not have.`;
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

interface CohortCopy {
  lead: string;
  detail: string;
  ctaLabel: string;
  /** Ghost/secondary instead of a primary button. */
  lowEmphasis?: boolean;
}

/**
 * Copy is computed from the cohort AS A WHOLE. Only the count === 1 case may
 * quote a single row's fields — that is the one time naming a rental helps
 * rather than turning the bar into a list.
 */
export function buildCopy(
  cohort: DepositCohortKey,
  issues: DepositHoldIssue[],
  now: number,
): CohortCopy {
  const n = issues.length;
  const one = n === 1;
  const only = issues[0];
  const ref = one ? namedRef(only) : null;
  const count = displayCount(n);

  switch (cohort) {
    // -- B1 / B1a / B1b — cars out with nothing behind them -------------------
    case "unsecured": {
      if (one) {
        // B1a — the GMT incident itself: the very first attempt failed, so the
        // car left with no deposit at all.
        if (only.holdStatus === null) {
          return {
            lead: ref
              ? `The deposit on rental ${ref} was never taken.`
              : "The deposit on this rental was never taken.",
            detail:
              "The first attempt on the customer's card did not go through, so this car went out with no deposit at all. Place a hold now, or ask the customer for another card.",
            ctaLabel: "Review rental →",
          };
        }

        // B1b — a hold came off mid-hire. Operator-initiated releases never
        // reach us; the hook drops anything with a release_requested_at stamp.
        if (only.holdStatus === "released") {
          const due = formatDay(only.endDate);
          return {
            lead: "A deposit was given back while the car is still out.",
            detail:
              ref && due
                ? `Rental ${ref} is not due back until ${due} but no longer has a deposit behind it. Place a new hold if you still want cover for the rest of the hire.`
                : "This rental is not due back yet but no longer has a deposit behind it. Place a new hold if you still want cover for the rest of the hire.",
            ctaLabel: "Review rental →",
          };
        }

        return {
          lead: ref ? `Rental ${ref} has no deposit held.` : "1 rental has no deposit held.",
          detail:
            "This car is out and there is no deposit to fall back on. Open it to place a new hold on the customer's card.",
          ctaLabel: "Review rental →",
        };
      }

      return {
        lead: `${count} active rentals have no deposit held.`,
        detail:
          "These cars are out and there is no deposit to fall back on. Open each one to place a new hold on the customer's card.",
        ctaLabel: `Review ${count} rentals →`,
      };
    }

    // -- B2 — the cardholder is the only one who can act ----------------------
    case "needs_customer": {
      return {
        lead: one
          ? ref
            ? `Rental ${ref} needs the customer to confirm their card.`
            : "1 rental needs the customer to confirm their card."
          : `${count} rentals need the customer to confirm their card.`,
        // States outright that staff cannot fix it. The observed failure mode is
        // staff retrying a hold over and over that structurally requires the
        // cardholder, so this sentence is doing real work.
        detail:
          "Their bank wants them to approve the deposit, or the card on file can no longer be used — either way this one cannot be fixed from your side. Send them a secure link to confirm or update their card.",
        ctaLabel: one ? "Send card link →" : "Send card links →",
      };
    }

    // -- B3 — our records and reality may have drifted apart ------------------
    case "unconfirmed": {
      return {
        lead: one
          ? ref
            ? `We cannot confirm the deposit on rental ${ref}.`
            : "We cannot confirm the deposit on 1 rental."
          : `We cannot confirm the deposit on ${count} rentals.`,
        detail: one
          ? "Our records say this hold is active, but we have not been able to check it recently. Open the rental and choose 'Check with Stripe' to see where it really stands."
          : "Our records say these holds are active, but we have not been able to check them recently. Open each rental and choose 'Check with Stripe' to see where they really stand.",
        ctaLabel: one ? "Check this rental →" : "Check these rentals →",
      };
    }

    // -- B5 — still fixable at the counter ------------------------------------
    case "pre_handover": {
      return {
        lead: one
          ? ref
            ? `Rental ${ref} starts within 48 hours without a deposit.`
            : "1 rental starts within 48 hours without a deposit."
          : `${count} rentals start within 48 hours without a deposit.`,
        detail:
          "The card did not go through when we tried. Sorting it before you hand over the keys is far easier than chasing it once the car has gone.",
        ctaLabel: "Fix before handover →",
      };
    }

    // -- B4 — the anti-panic state --------------------------------------------
    case "retrying": {
      // Soonest retry across the cohort, and only when EVERY row has one. A
      // single missing time makes the promise untrue for that rental, so the
      // clause is dropped rather than hedged.
      const retryTimes = issues.map((i) => parseWhen(i.nextRetryAt));
      const allKnown = retryTimes.every((t): t is number => t !== null);
      const soonest = allKnown ? Math.min(...retryTimes) : null;
      const when = soonest !== null ? approximateWhen(soonest, now) : null;

      return {
        lead: one
          ? ref
            ? `A deposit renewal did not go through on rental ${ref}.`
            : "A deposit renewal did not go through on 1 rental."
          : `A deposit renewal did not go through on ${count} rentals.`,
        detail: when
          ? `The card was declined, most often because the funds were not available on the day. We will try again automatically — the next attempt is ${when}. Nothing to do unless it keeps failing.`
          : "The card was declined, most often because the funds were not available on the day. We will try again automatically. Nothing to do unless it keeps failing.",
        ctaLabel: "View rentals",
        // A loud CTA here would contradict the copy. Nobody has to do anything.
        lowEmphasis: true,
      };
    }

    // -- B8 — a chargeback against a deposit ----------------------------------
    case "disputed": {
      return {
        lead: one
          ? ref
            ? `A customer has disputed the deposit on rental ${ref}.`
            : "A customer has disputed a deposit charge."
          : `${count} customers have disputed a deposit charge.`,
        detail: one
          ? "Their bank has pulled the money back while it investigates, and deposit actions on this rental are paused until it is settled. You will need to respond in Stripe with the rental agreement and any supporting evidence."
          : "Their banks have pulled the money back while they investigate, and deposit actions on these rentals are paused until they are settled. You will need to respond in Stripe with the rental agreement and any supporting evidence.",
        ctaLabel: one ? "View rental →" : "View rentals →",
      };
    }
  }
}

/** Chip labels for the "Also:" row. Short enough to sit several to a line. */
function chipLabel(cohort: DepositCohortKey, n: number): string {
  const c = displayCount(n);
  switch (cohort) {
    case "disputed":
      return `${c} disputed`;
    case "unsecured":
      return `${c} with no deposit`;
    case "needs_customer":
      return n === 1 ? "1 needs the customer" : `${c} need the customer`;
    case "unconfirmed":
      return n === 1 ? "1 unconfirmed" : `${c} unconfirmed`;
    case "pre_handover":
      return `${c} before handover`;
    case "retrying":
      return `${c} retrying`;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Record<DepositHoldSeverity, number> = {
  critical: 3,
  warning: 2,
  info: 1,
};

const toBannerSeverity = (s: DepositHoldSeverity): BannerSeverity =>
  s === "critical" ? "critical" : s === "warning" ? "warning" : "info";

/** Deep link for a cohort. Mirrors the existing ?bonzahStatus= precedent. */
const cohortHref = (cohort: DepositCohortKey) => `/rentals?depositHold=${cohort}`;

/**
 * Returns AT MOST ONE banner. See the file header for why that cap is the whole
 * point rather than a limitation.
 */
export function useDepositHoldBanners(): AppBanner[] {
  const { tenant } = useTenant();
  const { data, isSuccess } = useDepositHoldAlerts();

  /**
   * PERMISSION GATE, enforced here rather than left to the stack.
   *
   * Every banner this hook emits links into the rentals list or a single rental
   * page. A manager whose permissions exclude the rentals tab cannot open
   * either, so showing them a red money alarm gives them something alarming to
   * look at and no way to act on it — the worst combination.
   *
   * `requiresTab` was set on the banner object for a registry to enforce, but
   * BannerStack only reads `scope` and `hideOnPathPrefix`, so nothing was
   * checking it. Short-circuit at the source instead: a hook that returns no
   * banners cannot leak one through any renderer.
   */
  const { canView } = useManagerPermissions();
  const canOpenRentals = canView("rentals");

  /**
   * TENANT GATE. Without it, every operator who does not take deposits gets a
   * permanent false alarm.
   *
   * `per_vehicle` is included on purpose: those tenants can carry a zero global
   * amount while still taking a real deposit per car. Gating on
   * `global_deposit_amount > 0` alone would silence the banner for the exact
   * tenant shape the incident came from.
   */
  const depositsInUse =
    tenant?.security_deposit_enabled === true &&
    ((Number(tenant?.global_deposit_amount) || 0) > 0 || tenant?.deposit_mode === "per_vehicle");

  return useMemo<AppBanner[]>(() => {
    if (!isSuccess || !depositsInUse || !canOpenRentals || data.total === 0) return [];

    const now = Date.now();

    // Bucket every issue into exactly one cohort.
    const buckets = new Map<DepositCohortKey, DepositHoldIssue[]>();
    for (const issue of data.issues) {
      const cohort = cohortOf(issue, now);
      if (!cohort) continue;
      const bucket = buckets.get(cohort);
      if (bucket) bucket.push(issue);
      else buckets.set(cohort, [issue]);
    }

    const live = COHORT_PRECEDENCE.filter((c) => (buckets.get(c)?.length ?? 0) > 0);
    // Everything the hook raised was a quiet signal (expiring holds). Correct
    // outcome: no bar.
    if (live.length === 0) return [];

    const winner = live[0];
    const winnerIssues = buckets.get(winner)!;
    const others = live.slice(1);

    const copy = buildCopy(winner, winnerIssues, now);
    const money = moneyClause(winnerIssues, winner);

    // Severity of the rendered bar = the max severity WITHIN the winning cohort.
    // A cohort of self-healing retries is amber even though it sits in the same
    // slot that renders red for an unsecured car.
    const severity = toBannerSeverity(
      winnerIssues.reduce<DepositHoldSeverity>(
        (worst, i) => (SEVERITY_ORDER[i.severity] > SEVERITY_ORDER[worst] ? i.severity : worst),
        "info",
      ),
    );

    // Exactly one rental → straight to it. Anything more → the filtered list.
    const single = winnerIssues.length === 1 ? winnerIssues[0] : null;
    const href = single ? single.href : cohortHref(winner);

    const action = { label: copy.ctaLabel, href };

    /**
     * FINGERPRINT — what makes a dismissed banner come back.
     *
     * Built ONLY from stable identity: the winning cohort, its severity, and the
     * sorted rental-id/status pairs across every live cohort. Sorted so row
     * order out of PostgREST cannot flip it.
     *
     * Explicitly excluded: `nextRetryAt`, `failureCount`, `lastError`, and every
     * timestamp. Those churn on each cron tick; feeding one in would re-show the
     * bar every few minutes and the operator would mute the feature at the
     * browser level, which is strictly worse than it never having existed.
     */
    const fp = fingerprint(
      winner,
      severity,
      ...live
        .flatMap((c) => buckets.get(c) ?? [])
        .map((i) => `${i.rentalId}:${i.holdStatus ?? "none"}`)
        .sort(),
    );

    const plainTitle = money ? `${copy.lead} ${money}` : copy.lead;

    const banner: AppBanner = {
      // Stable id: one dismissal key per tenant, forever. The winning cohort
      // lives in the fingerprint instead, so an escalation from "retrying" to
      // "no deposit held" forces a dismissed bar back into view.
      id: "deposit-hold.problems",
      severity,
      // Deposit trouble is money already out of the door — it outranks an
      // expired API token sharing the critical band.
      weight: 100,
      // A manager without the rentals tab cannot open any of these, and every
      // CTA below would dead-end.
      requiresTab: "rentals",

      title: copy.lead,
      plainTitle,
      description: (
        <>
          {copy.detail}
          {money ? ` ${money}` : ""}
          {data.truncated ? " There may be more than shown here." : ""}
          {others.length > 0 && (
            <span className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs opacity-90">
              <span className="font-medium">Also:</span>
              {others.map((cohort, index) => (
                <span key={cohort} className="inline-flex items-center gap-x-1.5">
                  {index > 0 && <span aria-hidden>·</span>}
                  <Link
                    href={cohortHref(cohort)}
                    className="underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-1 rounded-sm"
                  >
                    {chipLabel(cohort, buckets.get(cohort)!.length)}
                  </Link>
                </span>
              ))}
            </span>
          )}
        </>
      ),

      // B4 is the one state where nobody has to do anything, so its link is a
      // ghost rather than a button.
      ...(copy.lowEmphasis ? { secondaryAction: action } : { action }),

      dismissal: {
        fingerprint: fp,
        /**
         * critical → 24h. A car out with no deposit must never be silenceable
         * forever with one click; it comes back tomorrow if still unresolved.
         * Disputes ride this same 24h rule on purpose — they carry a bank
         * deadline, and missing it forfeits the money automatically.
         *
         * warning / info → dismiss-until-changed. No timer: the bar stays hidden
         * while the same rentals are in the same state and returns the moment
         * one joins, leaves, or escalates. Fixing things must not nag.
         */
        /**
         * Keyed on the COHORT, not on the rendered colour.
         *
         * This was `severity === "critical" ? 24h : Infinity`, which let a
         * genuinely unresolved problem be silenced forever: `unconfirmed`
         * renders amber, and a needs-review hold is by construction a dead end
         * that never changes on its own — so one click buried it permanently.
         *
         * Anything that describes a car without confirmed cover snoozes for a
         * day and comes back. Only the states that truly resolve themselves, or
         * that carry no exposure, may be dismissed for good.
         */
        ttlMs: SELF_RESOLVING_COHORTS.has(winner)
          ? Number.POSITIVE_INFINITY
          : 24 * 60 * 60 * 1000,
        // A bare implies "handled". Wherever the alarm is coming back, say so
        // on the control itself — gated on the same cohort rule as the TTL above,
        // not on colour, so an amber-but-unresolved bar is labelled honestly too.
        ...(SELF_RESOLVING_COHORTS.has(winner)
          ? {}
          : {
              label: "Snooze 24h",
              tooltip: "This comes back tomorrow if it is still unresolved.",
            }),
      },
    };

    return [banner];
  }, [isSuccess, depositsInUse, canOpenRentals, data]);
}

export default useDepositHoldBanners;
