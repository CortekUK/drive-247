"use client";

/**
 * Billing PREVIEW data — the canary tenant only.
 *
 * WHY THIS EXISTS
 * ---------------
 * `/subscription` ("Billing") has three mutually exclusive render paths and only
 * ONE of them draws the actual product: the Plan / Invoices / Credits tab strip.
 * That path is behind `isSubscribed`. The canary tenant `northwind` has no real
 * subscription, no invoices and an empty credit wallet, so the screen it renders
 * is the dead end — "No subscription plans are available yet." — and the design
 * of the thing being built cannot be reviewed at all.
 *
 * So on the canary, and ONLY when there is genuinely nothing real to show, we
 * render the subscribed layout against sample data. This is a review harness for
 * a screen, not a feature: nothing here is written anywhere, no network call is
 * made, and every money action on the screen is disabled while it is on.
 *
 * THE GATE IS ON THE SLUG, NOT THE TENANT ID
 * ------------------------------------------
 * `northwind` exists in production AND on the staging branch with DIFFERENT
 * primary keys (staging was seeded, not cloned), so an id-keyed gate silently
 * resolves to the wrong branch in whichever environment it was not written
 * against — no error, no failed build. See the long note on `NORTHWIND` in
 * `lib/v2.ts`.
 *
 * WHY NOT A `V2Area` IN `lib/v2.ts`
 * ---------------------------------
 * The `V2Area` union is the register of v2 SURFACES — screens that will be
 * widened to more tenants one step at a time and eventually to everyone. This is
 * the opposite of that: it is scaffolding that must never widen, and that must
 * disappear on the canary itself the moment real billing data exists. Adding it
 * to `V2_AREAS` would put it on the list of things someone widens by editing an
 * array, which is precisely the mistake to make impossible. It is also a file
 * another session is editing right now. So the comparison is written out here,
 * against the exported `NORTHWIND` constant, in one place.
 *
 * FAILS TO REAL
 * -------------
 * `useBillingPreview` takes `hasRealData` from the caller and returns false the
 * instant it is true. Truth always wins; preview only ever fills a hole.
 */

import { useMemo } from "react";
import { Eye } from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import { NORTHWIND } from "@/lib/v2";
import { cn } from "@/lib/utils";
import type {
  TenantSubscription,
  TenantSubscriptionInvoice,
} from "@/hooks/use-tenant-subscription";
import type {
  CreditCost,
  CreditTransaction,
  CreditWallet,
} from "@/hooks/use-credit-wallet";

// ── Gate ─────────────────────────────────────────────────────────────

/**
 * Is this the one tenant allowed to see sample billing data?
 *
 * Every other tenant — all ~32 paying operators — keeps today's behaviour
 * exactly, including the honest "no plans available yet" empty state when that
 * is genuinely where they are.
 */
export function useIsBillingPreviewTenant(): boolean {
  const { tenant } = useTenant();
  return tenant?.slug === NORTHWIND;
}

/**
 * Preview is on when this is the canary AND the caller has nothing real.
 *
 * `hasRealData` is deliberately the CALLER's judgement — the subscription page
 * and the credits panel look at different tables — and it should include the
 * relevant "still loading" flag, so a real subscription arriving a beat late
 * never flashes sample data first.
 */
export function useBillingPreview(hasRealData: boolean): boolean {
  return useIsBillingPreviewTenant() && !hasRealData;
}

// ── Markers ──────────────────────────────────────────────────────────

/**
 * The badge that makes this unmistakable.
 *
 * Non-negotiable: an invented invoice that reads as real is strictly worse than
 * an empty page. Amber, not indigo — this is not a state of the product.
 */
export function PreviewDataPill({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700",
        "dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400",
        className,
      )}
    >
      <Eye className="h-3.5 w-3.5" />
      Preview data
    </span>
  );
}

/** One plain sentence saying what the reader is looking at. */
export function PreviewDataNotice({ className }: { className?: string }) {
  return (
    <p className={cn("text-sm text-muted-foreground", className)}>
      Sample data, shown so the billing screens can be reviewed while this tenant
      has no subscription. None of it is real, and payment actions are switched
      off.
    </p>
  );
}

/** Inline "why is this greyed out" label for a disabled money action. */
export function PreviewDisabledNote({ className }: { className?: string }) {
  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      Disabled while previewing — this would open a real Stripe checkout.
    </p>
  );
}

// ── Sample data ──────────────────────────────────────────────────────
//
// Built from `Date.now()` at call time so the periods always read as "now",
// and deliberately signposted: plan names carry "(sample)", invoice numbers are
// prefixed PREVIEW-, and the card is Stripe's own 4242 test number. Every
// invoice is PAID, so the screen never asks anyone to act on a debt that does
// not exist.

const DAY = 86_400_000;

function iso(msFromNow: number): string {
  return new Date(Date.now() + msFromNow).toISOString();
}

const PREVIEW_PLAN_NAME = "Growth (sample)";
const PREVIEW_AMOUNT_CENTS = 19_900;

export function buildPreviewSubscription(): TenantSubscription {
  return {
    id: "preview-subscription",
    tenant_id: "preview",
    stripe_subscription_id: "sub_preview_000000",
    stripe_customer_id: "cus_preview_000000",
    status: "active",
    plan_name: PREVIEW_PLAN_NAME,
    amount: PREVIEW_AMOUNT_CENTS,
    currency: "usd",
    interval: "month",
    current_period_start: iso(-12 * DAY),
    current_period_end: iso(18 * DAY),
    cancel_at: null,
    canceled_at: null,
    ended_at: null,
    card_brand: "visa",
    card_last4: "4242",
    card_exp_month: 12,
    card_exp_year: 2029,
    trial_end: null,
    created_at: iso(-135 * DAY),
    updated_at: iso(-12 * DAY),
  };
}

/**
 * Four settled monthly invoices, newest first — the order the real query
 * returns them in.
 *
 * Two carry a base/usage split so the Base and Usage columns of the shared
 * invoice table actually render (they are hidden when no invoice in the list has
 * a breakdown). No PDF or hosted URL: there is nothing to download and nothing
 * to pay, and a fabricated link would be a dead end at best.
 */
export function buildPreviewInvoices(): TenantSubscriptionInvoice[] {
  const rows: {
    monthsAgo: number;
    number: string;
    base: number | null;
    usage: number | null;
    usageQty: number | null;
  }[] = [
    { monthsAgo: 0, number: "PREVIEW-0004", base: PREVIEW_AMOUNT_CENTS, usage: 1_200, usageQty: 12 },
    { monthsAgo: 1, number: "PREVIEW-0003", base: PREVIEW_AMOUNT_CENTS, usage: 700, usageQty: 7 },
    { monthsAgo: 2, number: "PREVIEW-0002", base: null, usage: null, usageQty: null },
    { monthsAgo: 3, number: "PREVIEW-0001", base: null, usage: null, usageQty: null },
  ];

  return rows.map((r, i) => {
    const periodStart = iso(-(r.monthsAgo * 30 + 12) * DAY);
    const periodEnd = iso(-(r.monthsAgo * 30 - 18) * DAY);
    const paidAt = iso(-(r.monthsAgo * 30 + 12) * DAY);
    const total = PREVIEW_AMOUNT_CENTS + (r.usage ?? 0);

    return {
      id: `preview-invoice-${i}`,
      tenant_id: "preview",
      subscription_id: "preview-subscription",
      stripe_invoice_id: `in_preview_${i}`,
      stripe_invoice_pdf: null,
      stripe_hosted_invoice_url: null,
      status: "paid",
      amount_due: total,
      amount_paid: total,
      currency: "usd",
      period_start: periodStart,
      period_end: periodEnd,
      due_date: periodStart,
      paid_at: paidAt,
      invoice_number: r.number,
      base_amount: r.base,
      usage_amount: r.usage,
      usage_quantity: r.usageQty,
      attempt_count: 1,
      invoice_date: paidAt,
      amount_refunded: null,
      refunded_at: null,
      dispute_status: null,
      created_at: paidAt,
      updated_at: paidAt,
    };
  });
}

export function buildPreviewWallet(): CreditWallet {
  return {
    id: "preview-wallet",
    tenant_id: "preview",
    balance: 128,
    test_balance: 250,
    lifetime_purchased: 400,
    lifetime_used: 272,
    test_lifetime_purchased: 300,
    test_lifetime_used: 50,
    low_balance_threshold: 10,
    auto_refill_enabled: false,
    auto_refill_threshold: 10,
    auto_refill_amount: 50,
    auto_refill_package_id: null,
    stripe_payment_method_id: null,
    created_at: iso(-135 * DAY),
    updated_at: iso(-2 * DAY),
  };
}

/**
 * A believable ledger: a couple of top-ups, day-to-day usage across the three
 * billed services, one refund and one goodwill gift.
 *
 * Usage rows are spread back over five months on purpose — the Usage History
 * chart defaults to a 6-month window and plots live `usage` rows only, so a
 * ledger bunched into today would draw one bar and four empty months.
 */
export function buildPreviewTransactions(): CreditTransaction[] {
  const spec: {
    days: number;
    type: CreditTransaction["type"];
    amount: number;
    category: string | null;
    description: string;
    test?: boolean;
  }[] = [
    { days: 1, type: "usage", amount: -3, category: "esign", description: "Rental agreement sent for signature" },
    { days: 2, type: "usage", amount: -1, category: "twilio", description: "SMS to customer" },
    { days: 3, type: "usage", amount: -5, category: "verification", description: "Driver licence check" },
    { days: 5, type: "purchase", amount: 100, category: null, description: "Credit top-up" },
    { days: 9, type: "usage", amount: -3, category: "esign", description: "Rental agreement sent for signature" },
    { days: 14, type: "refund", amount: 5, category: "verification", description: "Failed check refunded" },
    { days: 21, type: "usage", amount: -1, category: "twilio", description: "SMS to customer" },
    { days: 34, type: "usage", amount: -3, category: "esign", description: "Rental agreement sent for signature" },
    { days: 48, type: "usage", amount: -5, category: "verification", description: "Driver licence check" },
    { days: 63, type: "usage", amount: -3, category: "esign", description: "Rental agreement sent for signature" },
    { days: 77, type: "gift", amount: 25, category: null, description: "Welcome credits" },
    { days: 95, type: "usage", amount: -1, category: "twilio", description: "SMS to customer" },
    { days: 120, type: "purchase", amount: 300, category: null, description: "Credit top-up" },
    { days: 121, type: "usage", amount: -2, category: "esign", description: "Sandbox agreement", test: true },
  ];

  // Walk the ledger backwards from today's balance so `balance_after` reads
  // consistently down the column instead of being 14 unrelated numbers.
  let running = 128;
  return spec.map((s, i) => {
    const balanceAfter = running;
    if (!s.test) running -= s.amount;
    return {
      id: `preview-tx-${i}`,
      tenant_id: "preview",
      wallet_id: "preview-wallet",
      type: s.type,
      amount: s.amount,
      balance_after: balanceAfter,
      category: s.category,
      description: s.description,
      reference_id: null,
      reference_type: null,
      package_id: null,
      stripe_payment_id: null,
      performed_by: null,
      is_test_mode: s.test === true,
      created_at: iso(-s.days * DAY),
    };
  });
}

/**
 * Service costs are PLATFORM-wide (`credit_costs` is not tenant-scoped), so
 * these are only substituted when that table returns nothing at all. If real
 * rates exist, the real rates are what get shown even in preview.
 */
export function buildPreviewCosts(): CreditCost[] {
  return [
    { id: "preview-cost-esign", category: "esign", cost_credits: 3, label: "E-signature", description: null, is_active: true },
    { id: "preview-cost-twilio", category: "twilio", cost_credits: 1, label: "SMS message", description: null, is_active: true },
    { id: "preview-cost-verification", category: "verification", cost_credits: 5, label: "Driver verification", description: null, is_active: true },
  ];
}

// ── Convenience hooks ────────────────────────────────────────────────
// Built once per mount rather than on every render, so the relative dates do
// not shift underneath a chart or a table mid-interaction.

export function usePreviewSubscription(active: boolean): TenantSubscription | null {
  return useMemo(() => (active ? buildPreviewSubscription() : null), [active]);
}

export function usePreviewInvoices(active: boolean): TenantSubscriptionInvoice[] {
  return useMemo(() => (active ? buildPreviewInvoices() : []), [active]);
}
