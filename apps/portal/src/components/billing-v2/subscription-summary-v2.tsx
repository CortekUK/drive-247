"use client";

import { useState } from "react";
import type React from "react";
import { AutoSkeleton } from "@/components/skeleton-v2/auto-skeleton";
import { useSkeletonLoading } from "@/hooks/use-skeleton-loading";
import { useReferrals, type ReferralsData } from "@/hooks/use-referrals";
import { useUpcomingInvoice } from "@/lib/integration-billing/hooks";
import { formatBillDate, formatMoney } from "@/lib/integration-billing/catalog";
import type { UpcomingInvoice } from "@/lib/integration-billing/api-client";
import type { TenantSubscriptionInvoice } from "@/hooks/use-tenant-subscription";
import { PaymentHistoryDialogV2 } from "@/components/billing-v2/payment-history-dialog-v2";
import { PriceTrailDialogV2 } from "@/components/billing-v2/price-trail-dialog-v2";
import { RecentPaymentsV2 } from "@/components/billing-v2/recent-payments-v2";
import { useIntegrationSubscriptions } from "@/lib/integration-billing/hooks";
import { useRetentionOffer } from "@/hooks/use-retention-offer";
import { buildPriceTrail, type PremiumIntegration } from "@/lib/price-trail";
import { SAMPLE_INTEGRATIONS, SAMPLE_JOINED, SAMPLE_RETENTION } from "@/lib/price-trail-sample";
import type { PlanAction } from "@/components/billing-v2/manage-plan-dialog-v2";
import { CancelFlowDialogV2 } from "@/components/billing-v2/cancel-flow-dialog-v2";
import { UpgradeDialogV2 } from "@/components/billing-v2/upgrade-dialog-v2";

/**
 * The top of v2 Billing: ONE big number — what the operator pays each month:
 * the base subscription everyone has, minus whatever discounts are running on
 * it right now (the itemised breakdown was removed 2026-09-27; the discounts
 * still shape the number):
 *
 *   - their REFERRAL REWARD (a standing % off every bill, by how many operators
 *     they referred are still subscribed), and
 *   - the discount they JOINED WITH (a referral or promo code at signup, for a
 *     set number of bills).
 *
 * Where the numbers come from, best first:
 *   1. Stripe's upcoming invoice (integration-billing tenants with a real
 *      subscription) — its lines ARE the bill, discounts included, so nothing
 *      is worked out here.
 *   2. Otherwise: the base from the subscription row, and each discount worked
 *      out from the referral programme's own wording ("10% off every bill",
 *      "$20 off"). Each is taken off the base, and the result is labelled an
 *      estimate. A discount whose wording can't be read is still listed, just
 *      without an amount, and the big number then says it is before discounts.
 */

interface Row {
  key: string;
  label: string;
  detail?: string | null;
  /** Minor units, negative for a discount; null when it can't be worked out. */
  amount: number | null;
}

/** "10% off every bill" → 10%; "$20 off" → 2000c. Null when neither reads. */
function readDiscount(text: string | null | undefined): { percent: number } | { cents: number } | null {
  if (!text) return null;
  const pct = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pct) return { percent: Number(pct[1]) };
  const amt = text.match(/[$£€]\s?([\d,]+(?:\.\d+)?)/);
  if (amt) return { cents: Math.round(Number(amt[1].replace(/,/g, "")) * 100) };
  return null;
}

export function discountCents(text: string | null | undefined, base: number): number | null {
  const d = readDiscount(text);
  if (!d) return null;
  const off = "percent" in d ? Math.round((base * d.percent) / 100) : d.cents;
  return -Math.min(off, base);
}

function rowsFromReferrals(base: number, data: ReferralsData | undefined): Row[] {
  const rows: Row[] = [];
  if (!data?.enabled) return rows;
  const { standing, joinedWith } = data;
  if (standing.reward) {
    rows.push({
      key: "referral-reward",
      label: "Referral reward",
      detail: `${standing.reward} · ${standing.activeReferrals} subscribed referral${standing.activeReferrals === 1 ? "" : "s"}`,
      amount: discountCents(standing.reward, base),
    });
  }
  if (joinedWith?.active) {
    const who = joinedWith.code ? `Joined with ${joinedWith.code}` : "Signup discount";
    const left =
      joinedWith.billsLeft !== null
        ? `${joinedWith.billsLeft} bill${joinedWith.billsLeft === 1 ? "" : "s"} left`
        : joinedWith.endsAt
          ? `until ${formatBillDate(joinedWith.endsAt)}`
          : joinedWith.durationText;
    rows.push({
      key: "joined-with",
      label: who,
      detail: [joinedWith.discountText, left].filter(Boolean).join(" · "),
      amount: discountCents(joinedWith.discountText, base),
    });
  }
  return rows;
}

function rowsFromInvoice(inv: UpcomingInvoice): Row[] {
  return inv.lines.map((l, i) => ({
    key: `${l.kind}-${l.integrationKey ?? ""}-${i}`,
    label: l.label,
    amount: l.amount,
  }));
}

export function SubscriptionSummaryV2({
  baseCents,
  currency,
  interval,
  nextBillAt,
  periodStart,
  cardOnFile,
  endsAt,
  useStripeInvoice,
  invoices,
  onViewInvoice,
  payDisabled,
  planName,
  readOnly,
  card,
}: {
  /** The base subscription, per interval, in minor units. Null for custom pricing. */
  baseCents: number | null;
  currency: string;
  interval: string;
  nextBillAt: string | null;
  /** Start of the current billing period, for the upgrade's day-based figures. */
  periodStart?: string | null;
  /** The primary card, for the upgrade's demo checkout. */
  cardOnFile?: { brand: string | null; last4: string } | null;
  /** Set when the subscription is scheduled to end: then there is no next bill. */
  endsAt: string | null;
  /** Read Stripe's upcoming invoice (real subscription on integration billing). */
  useStripeInvoice: boolean;
  /** For Payment history. */
  invoices: TenantSubscriptionInvoice[];
  onViewInvoice: (inv: TenantSubscriptionInvoice) => void;
  /** Sample data: money actions are switched off. */
  payDisabled: boolean;
  /** For Manage plan: the plan they are on, so Upgrade lists the others. */
  planName: string | null;
  /** Viewers / managers without edit on Subscription can't file a cancellation. */
  readOnly: boolean;
  /** The card on file, in the right-hand column of this band. */
  card?: React.ReactNode;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [trailOpen, setTrailOpen] = useState(false);
  const [planAction, setPlanAction] = useState<PlanAction | null>(null);
  const referrals = useReferrals();
  const upcoming = useUpcomingInvoice({ enabled: useStripeInvoice });
  const invoice = useStripeInvoice ? upcoming.data ?? null : null;

  // Everything that shapes the price: premium integrations added, the stay
  // offer from the cancel flow, and (via referrals) codes and rewards.
  const integrationSubs = useIntegrationSubscriptions();
  const premium: PremiumIntegration[] = Object.values(integrationSubs.byKey)
    .filter((r) => (r.status === "active" || r.status === "pending") && r.monthly_price_cents > 0)
    .map((r) => ({ key: r.integration_key, monthlyCents: r.monthly_price_cents, since: r.subscribed_at }));
  const realRetention = useRetentionOffer(payDisabled).data ?? null;
  // The sample account (billing preview) gets a full set of sources to review;
  // only where it has none of its own, and never on a real account.
  const sampleTrail = payDisabled;
  const trailReferrals =
    sampleTrail && referrals.data?.enabled ? { ...referrals.data, joinedWith: referrals.data.joinedWith ?? SAMPLE_JOINED } : referrals.data;
  const trailIntegrations = sampleTrail && premium.length === 0 ? SAMPLE_INTEGRATIONS : premium;
  const retention = realRetention ?? (sampleTrail ? SAMPLE_RETENTION : null);
  const trail = baseCents != null ? buildPriceTrail(baseCents, trailReferrals, trailIntegrations, retention) : null;

  const loading = useSkeletonLoading(referrals.isLoading || (useStripeInvoice && upcoming.isLoading));

  let rows: Row[];
  let total: number | null;
  let estimate = false;
  let beforeDiscounts = false;

  if (invoice) {
    rows = rowsFromInvoice(invoice);
    total = invoice.total;
  } else if (baseCents != null) {
    const discounts = rowsFromReferrals(baseCents, referrals.data);
    rows = [{ key: "base", label: "Base subscription", amount: baseCents }, ...discounts];
    beforeDiscounts = discounts.some((d) => d.amount === null);
    // The same calculation as the Price breakdown, so the two always agree.
    total = trail ? trail.todayCents : baseCents + discounts.reduce((sum, d) => sum + (d.amount ?? 0), 0);
    estimate = discounts.length > 0 && !beforeDiscounts;
  } else {
    rows = rowsFromReferrals(0, referrals.data).map((r) => ({ ...r, amount: null }));
    total = null;
  }

  const saving = invoice
    ? -invoice.lines.filter((l) => l.amount < 0).reduce((s, l) => s + l.amount, 0)
    : baseCents != null && total != null
      ? baseCents - total
      : 0;
  const cur = invoice?.currency ?? currency;
  const per = interval === "year" ? "year" : "month";
  const billLine = endsAt
    ? `Access ends ${formatBillDate(endsAt)}`
    : formatBillDate(invoice?.date ?? nextBillAt)
      ? `Next bill ${formatBillDate(invoice?.date ?? nextBillAt)}`
      : null;

  return (
    /* Band 1 — the subscription: what you pay and your payments on the left,
       the card on file on the right. The left column is `h-0 min-h-full`, so
       it takes the card's height without adding to it, and the payment list
       scrolls inside what's left. Phones: one column, card last. */
    <section
      aria-label="Your subscription"
      className="grid gap-8 md:min-h-0 md:flex-1 md:grid-cols-[minmax(0,1fr)_360px] md:grid-rows-[minmax(0,1fr)] md:gap-12 lg:grid-cols-[minmax(0,1fr)_400px]"
    >
      <div className="flex min-h-0 flex-col gap-6 md:h-0 md:min-h-full">
      <div>
        {/* While the discounts load, the real figure (the base price so far)
            renders under <AutoSkeleton>, so the bone is the figure's own size. */}
        <AutoSkeleton loading={loading}>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-5xl font-bold tracking-tighter">
              {total != null ? formatMoney(total, cur) : "Custom"}
            </span>
            {total != null && <span className="text-base text-muted-foreground">/ {per}</span>}
            {/* Plan actions: one word each, no icons, sitting on the baseline of
                "/ month", centred over the payment list's actions column (its
                11rem, inset by the rows' px-4). Upgrade in the accent; Cancel
                a faint red.
                Cancel is a request to the team, never a one-click cancel. */}
            <span className="ml-auto flex items-baseline gap-2">
              <button
                type="button"
                onClick={() => setPlanAction("upgrade")}
                className="inline-flex h-8 items-center rounded-lg border border-primary bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-opacity duration-200 ease-out hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 motion-reduce:transition-none"
              >
                Upgrade
              </button>
              <button
                type="button"
                onClick={() => setPlanAction("cancel")}
                className="inline-flex h-8 items-center rounded-lg border border-red-100 bg-red-50/60 px-3.5 text-sm font-medium text-red-600 transition-colors duration-200 ease-out hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200 motion-reduce:transition-none dark:border-red-400/20 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/15"
              >
                Cancel
              </button>
            </span>
          </div>
        </AutoSkeleton>
      </div>

      <RecentPaymentsV2
        invoices={invoices}
        upcoming={endsAt ? null : { date: invoice?.date ?? nextBillAt, amount: total, currency: cur }}
        onViewInvoice={onViewInvoice}
        payDisabled={payDisabled}
        onExplainPrice={baseCents != null ? () => setTrailOpen(true) : undefined}
      />
      </div>

      {card && <div className="min-h-0">{card}</div>}


      <UpgradeDialogV2
        open={planAction === "upgrade"}
        onOpenChange={(o) => !o && setPlanAction(null)}
        currentPlanName={planName}
        currentAmountCents={baseCents}
        currency={cur}
        periodStart={periodStart ?? null}
        periodEnd={nextBillAt}
        readOnly={readOnly}
        sample={payDisabled}
        cardOnFile={cardOnFile ?? null}
      />
      <CancelFlowDialogV2
        open={planAction === "cancel"}
        onOpenChange={(o) => !o && setPlanAction(null)}
        monthlyCents={total}
        currency={cur}
        accessEnds={endsAt ?? nextBillAt}
        planName={planName}
        readOnly={readOnly}
        sample={payDisabled}
      />
      <PriceTrailDialogV2
        open={trailOpen}
        onOpenChange={setTrailOpen}
        steps={trail?.steps ?? null}
        currency={cur}
        interval={interval}
        todayCents={total}
        exact={!!invoice}
      />
      <PaymentHistoryDialogV2
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        invoices={invoices}
        upcoming={endsAt ? null : { date: invoice?.date ?? nextBillAt, amount: total, currency: cur, estimated: !invoice && estimate }}
        onViewInvoice={(inv) => {
          setHistoryOpen(false);
          onViewInvoice(inv);
        }}
        payDisabled={payDisabled}
      />
    </section>
  );
}
