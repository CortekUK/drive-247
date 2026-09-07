"use client";

/**
 * Developer billing states — the ones you cannot reach by clicking.
 *
 * ── why this is needed at all ───────────────────────────────────────────────
 *
 * `past_due` arrives from a Stripe webhook after a card has actually failed,
 * and grace expiry is a pure CLOCK event: nothing in the database changes when
 * a window closes. To see the blocked screen honestly you would have to fail a
 * real payment and then wait out the configured number of days, once. So the
 * states nobody can reach are precisely the ones nobody has ever reviewed —
 * which is how the ugliest screen in a product ships unseen.
 *
 * ── what it does and does not touch ─────────────────────────────────────────
 *
 * It replaces what `use-tenant-subscription` DERIVES — is this tenant past due,
 * is the window open, has it closed — and nothing it FETCHES. The subscription
 * query, the invoice query and the grace-days config all keep running exactly
 * as they do in production; the override is applied to the finished object on
 * the way out of the hook. Nothing is written, no Stripe call is made, and
 * turning it off restores the true state on the very next render.
 *
 * Because it goes through the same values the real states produce, what is
 * being reviewed is the production UI — the sidebar chip, the Billing warning,
 * the blocking dialog — driven by believable inputs, not a mock screen built
 * beside it.
 *
 * ── three gates, and the order matters ──────────────────────────────────────
 *
 * 1. `process.env.NODE_ENV === "development"`, written as a literal comparison
 *    so a production bundle folds it to a constant and drops the branch.
 * 2. `isLeanTenant(tenant.slug)` — the northwind canary, keyed on the SLUG and
 *    never the id (northwind has different primary keys in production and on
 *    staging).
 * 3. a scenario actually selected in `/dev`.
 *
 * A key planted on a live operator's browser therefore does nothing: gate 1 is
 * already folded away, and gate 2 fails anyway.
 *
 * ── it never grants access ──────────────────────────────────────────────────
 *
 * Every scenario that changes access does so in the RESTRICTIVE direction, or
 * restores what was already true. "recovered" and "active" hand back a healthy
 * subscription, which is only reachable behind the two gates above and only in
 * `next dev` — it cannot be used to walk past a real paywall in production,
 * because in production this function returns its argument unchanged.
 */

import { useSyncExternalStore } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { isLeanTenant } from "@/lib/lean-areas";
import {
  readBillingScenario,
  subscribeDevOverrides,
  type BillingScenarioId,
} from "@/lib/dev-overrides";

/** The shape this override rewrites — the dunning half of the hook's result. */
type Overridable = {
  isSubscribed: boolean;
  hasExpiredSubscription: boolean;
  isPastDue: boolean;
  isInGracePeriod: boolean;
  isGraceExpired: boolean;
  graceDaysRemaining: number;
  graceSeverity: "none" | "warning" | "critical";
  graceEndsAt: number | null;
  owesOutstandingInvoice: boolean;
  isResolved: boolean;
  [key: string]: unknown;
};

/** What each scenario asserts. Everything else on the object is left alone. */
function patchFor(scenario: Exclude<BillingScenarioId, "off">): Partial<Overridable> {
  /* A window that is open but whose exact end is never shown to anybody — the
     product deliberately has no countdown, so the number here only decides
     `graceSeverity`, which changes the tone of the warning and nothing else. */
  const day = 86_400_000;

  switch (scenario) {
    /* Healthy. Also the "after they paid" half of the recovery check: select
       a failure, watch the app block, select this, watch it come back. */
    case "active":
    case "recovered":
      return {
        isSubscribed: true,
        hasExpiredSubscription: false,
        isPastDue: false,
        isInGracePeriod: false,
        isGraceExpired: false,
        graceDaysRemaining: 0,
        graceSeverity: "none",
        graceEndsAt: null,
        owesOutstandingInvoice: false,
        isResolved: true,
      };

    /* A card declined. Stripe has moved the subscription to past_due and is
       still retrying; the operator keeps full access and sees the warning. */
    case "payment_failed":
    /* The due date passed with nothing paid. The spec treats this and a failed
       card as the SAME user problem — the payment was missed — so they produce
       the same state deliberately, rather than two warnings saying one thing. */
    case "overdue":
      return {
        isSubscribed: true,
        hasExpiredSubscription: false,
        isPastDue: true,
        isInGracePeriod: true,
        isGraceExpired: false,
        graceDaysRemaining: 5,
        graceSeverity: "warning",
        graceEndsAt: Date.now() + 5 * day,
        owesOutstandingInvoice: true,
        isResolved: true,
      };

    /* Same window, near its end. Nothing counts down on screen; the warning
       simply carries more weight. */
    case "grace_expiring":
      return {
        isSubscribed: true,
        hasExpiredSubscription: false,
        isPastDue: true,
        isInGracePeriod: true,
        isGraceExpired: false,
        graceDaysRemaining: 1,
        graceSeverity: "critical",
        graceEndsAt: Date.now() + day,
        owesOutstandingInvoice: true,
        isResolved: true,
      };

    /* The window has closed: the app blocks. This is the state that is
       otherwise unreachable without failing a real payment and waiting. */
    case "grace_expired":
      return {
        isSubscribed: false,
        hasExpiredSubscription: true,
        isPastDue: true,
        isInGracePeriod: false,
        isGraceExpired: true,
        graceDaysRemaining: 0,
        graceSeverity: "none",
        graceEndsAt: Date.now() - day,
        owesOutstandingInvoice: true,
        isResolved: true,
      };
  }
}

/**
 * The gate and the patch, as one pure function — so the guarantee that matters
 * can actually be asserted rather than reasoned about.
 *
 * THAT GUARANTEE: with no scenario selected, or on any tenant but the canary,
 * this returns the CALLER'S OWN OBJECT — the same reference, not a copy of it.
 * Real billing behaviour is then untouched by definition, and the test proves
 * identity rather than equality so a future "harmless" spread cannot creep in.
 */
export function applyBillingScenario<T extends Overridable>(
  real: T,
  scenario: BillingScenarioId,
  tenantSlug: string | null | undefined,
): T {
  if (scenario === "off") return real;
  if (!tenantSlug || !isLeanTenant(tenantSlug)) return real;
  return { ...real, ...patchFor(scenario) };
}

export function useBillingScenarioOverride<T extends Overridable>(real: T): T {
  const { tenant } = useTenant();

  /* Subscribed rather than read once: selecting a state in another tab, or in
     the /dev page itself, has to move this screen without a reload. The server
     snapshot is "off" so SSR and the first client render agree. */
  const scenario = useSyncExternalStore(
    subscribeDevOverrides,
    () => readBillingScenario(),
    () => "off" as BillingScenarioId,
  );

  /* GATE 1 is inside `readBillingScenario` (a NODE_ENV literal, folded away in
     a production build). GATES 2 and 3 are in `applyBillingScenario`, which is
     why a planted key on a live operator's browser cannot do anything even if
     the first somehow passed. */
  return applyBillingScenario(real, scenario, tenant?.slug);
}
