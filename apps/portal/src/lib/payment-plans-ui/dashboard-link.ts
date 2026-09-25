/**
 * Where an attempt's money can be looked at in the provider's own dashboard.
 *
 * The lead asked for "the Stripe payment ID, and next to it a link that takes
 * you to that individual payment in the dashboard — so that they can
 * reconcile" (spec §5.2). This file decides, from RECORDED evidence only,
 * whether such a link can honestly be offered. It never guesses a URL.
 *
 * The rules are the ones TRAX support already applies to the same question —
 * `supabase/functions/trax-support/support/payment-routing.ts`
 * (`paymentActions`) — restated for a payment-plan attempt:
 *
 *   Standard account (the tenant's OWN Stripe, connected by OAuth)
 *     → `https://dashboard.stripe.com/{test/}payments/{pi_…}`. The account the
 *       attempt names must be the tenant's own account for that mode; the
 *       attempt's mode must be recorded; the reference must be a PaymentIntent.
 *   Express account (Drive247-managed)
 *     → no link. Stripe Express has no per-payment dashboard URL, so the
 *       reference is shown with a plain-English route to find it.
 *   Anything unproven — no account recorded, an account that is neither of
 *     the tenant's, the shared test account, no recorded mode, a Checkout
 *     Session with no PaymentIntent — the reference (if any) and why there is
 *     no link.
 *
 * NEVER a `/connect/accounts/…` URL: that is the PLATFORM's view of a connected
 * account and a tenant can't open it (pinned by
 * `__tests__/hooks/use-trax-support.test.tsx`, "a platform connected-account
 * page"). `isSafeDashboardHref` is the last gate every href passes through.
 */

export interface DashboardAccounts {
  /** `tenants.own_stripe_account_id` — the tenant's own (Standard) live account. */
  ownLive: string | null;
  /** `tenants.own_stripe_test_account_id` — the tenant's own test account. */
  ownTest: string | null;
  /** `tenants.stripe_account_id` — the Drive247-managed Express account. */
  managed: string | null;
  /** Drive247's shared test Connect account, when known. Never the tenant's. */
  sharedTest?: string | null;
}

export interface AttemptReference {
  provider: "stripe" | "square" | "manual" | "simulated";
  providerAccount: string | null;
  providerMode: "test" | "live" | null;
  providerRef: string | null;
  checkoutSessionId?: string | null;
}

export type ReferenceLink =
  /** A verified dashboard page for this exact payment. */
  | { kind: "link"; reference: string; href: string; label: "Open in Stripe"; note: string }
  /** A real reference, but no per-payment URL exists: how to find it by hand. */
  | { kind: "route"; reference: string; text: string }
  /** Nothing to open. `reference` is shown when one exists. */
  | { kind: "none"; reference: string | null; text: string };

const INTENT = /^pi_[A-Za-z0-9]+$/;
const SESSION = /^cs_(live|test)_[A-Za-z0-9]+$/;
const ACCOUNT = /^acct_[A-Za-z0-9]+$/;
const SAFE_HREF = /^https:\/\/dashboard\.stripe\.com\/(test\/)?payments\/pi_[A-Za-z0-9]+$/;

/** The only URL shape this module may ever hand out. */
export function isSafeDashboardHref(href: string): boolean {
  return SAFE_HREF.test(href) && !href.includes("/connect/");
}

const tail = (id: string) => id.slice(-4);

export const LINK_TEXT = {
  manual: "Recorded by hand — no provider record. Nothing outside Drive247 knows this money exists.",
  simulated: "Simulated in the Developer tab — no provider record.",
  square:
    "Taken through Square. Square gives no direct link to a single payment here: open your Square Dashboard, go to Transactions, and search for this reference.",
  noReference: "No provider reference was recorded for this attempt, so there is nothing to look up.",
  sessionOnly: "This checkout has no completed Stripe payment yet, so there is no transaction to open.",
  modeUnknown:
    "Drive247 did not record whether this used Stripe live or test mode, so no link is offered. Search your Stripe dashboard for this reference.",
  accountUnknown:
    "Drive247 cannot prove which Stripe account received this payment, so no link is offered. Search your Stripe dashboard for this reference.",
  sharedTest:
    "This is a test-mode payment on Drive247's shared test account, which is not your Stripe account, so it cannot be opened in your Stripe dashboard.",
  express:
    "This payment is in a Drive247-managed Stripe Express account. Stripe Express has no direct link to a single payment, so open Stripe from the Stripe card in Integrations and search for this reference.",
} as const;

export function dashboardLinkFor(attempt: AttemptReference, accounts: DashboardAccounts | null | undefined): ReferenceLink {
  const ref = attempt.providerRef?.trim() || null;

  if (attempt.provider === "manual") return { kind: "none", reference: null, text: LINK_TEXT.manual };
  if (attempt.provider === "simulated") return { kind: "none", reference: ref, text: LINK_TEXT.simulated };
  if (attempt.provider === "square") {
    return ref ? { kind: "route", reference: ref, text: LINK_TEXT.square } : { kind: "none", reference: null, text: LINK_TEXT.noReference };
  }

  // ── Stripe ──────────────────────────────────────────────────────────────
  const intent = ref && INTENT.test(ref) ? ref : null;
  const session =
    (ref && SESSION.test(ref) ? ref : null) ??
    (attempt.checkoutSessionId && SESSION.test(attempt.checkoutSessionId) ? attempt.checkoutSessionId : null);

  if (!intent) {
    if (session) return { kind: "none", reference: session, text: LINK_TEXT.sessionOnly };
    return ref ? { kind: "none", reference: ref, text: LINK_TEXT.accountUnknown } : { kind: "none", reference: null, text: LINK_TEXT.noReference };
  }

  // The environment must be RECORDED, never inferred — except from a Checkout
  // Session's own prefix, which is Stripe's record of it.
  const sessionMode = session ? (SESSION.exec(session)![1] as "live" | "test") : null;
  const mode = attempt.providerMode ?? sessionMode;
  if (mode !== "live" && mode !== "test") return { kind: "route", reference: intent, text: LINK_TEXT.modeUnknown };
  if (sessionMode && attempt.providerMode && sessionMode !== attempt.providerMode) {
    return { kind: "route", reference: intent, text: LINK_TEXT.accountUnknown };
  }

  const account = attempt.providerAccount && ACCOUNT.test(attempt.providerAccount) ? attempt.providerAccount : null;
  if (!account) return { kind: "route", reference: intent, text: LINK_TEXT.accountUnknown };

  const a = accounts ?? { ownLive: null, ownTest: null, managed: null };
  if (a.sharedTest && account === a.sharedTest) return { kind: "route", reference: intent, text: LINK_TEXT.sharedTest };

  const own = mode === "live" ? a.ownLive : a.ownTest;
  if (own && account === own) {
    const href = `https://dashboard.stripe.com/${mode === "test" ? "test/" : ""}payments/${intent}`;
    if (!isSafeDashboardHref(href)) return { kind: "route", reference: intent, text: LINK_TEXT.accountUnknown };
    return {
      kind: "link",
      reference: intent,
      href,
      label: "Open in Stripe",
      note: `Sign in to your Stripe account ending ${tail(account)}${mode === "test" ? " with test mode on" : ""}.`,
    };
  }

  if (a.managed && account === a.managed) {
    // Managed test-mode charges ran on the shared test account, not this one;
    // an Express live charge has no per-payment URL either way.
    return { kind: "route", reference: intent, text: mode === "test" ? LINK_TEXT.sharedTest : LINK_TEXT.express };
  }

  return { kind: "route", reference: intent, text: LINK_TEXT.accountUnknown };
}
