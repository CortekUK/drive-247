"use client";

// ── Premium integrations on the board (integration-billing tenant only) ───────
//
// docs/integration-billing/build-spec.md, D9 and D10. Everything here renders
// only when `useIntegrationBilling()` is true (northwind); every other tenant's
// board never mounts it and never issues its queries.
//
// THE DIALOG, top to bottom, for a premium integration nobody has subscribed to:
//   1. the premium block — price, "first month free" when it applies, and a
//      Subscribe button, directly under the header so it is on screen the
//      moment the dialog opens ("make sure ki scroll na karna pade");
//   2. the panel, READ-ONLY: the operator can read everything about the
//      integration (that is the point — "wo khol ke iske baare mein padh
//      sakega") but cannot connect it until they subscribe.
// Subscribe swaps the whole body for a compact confirm step — price, free
// month, next bill date, card on file — so paying happens inside the same
// dialog, again with nothing to scroll. There is no card to type: the charge
// rides on the platform bill, paid with the card that bill already uses.
//
// NOTHING IS CHARGED TODAY. The integration is added to the platform
// subscription with no proration: the days until the next billing date are
// Drive247's to absorb, and the copy says exactly that — "$20 will be added to
// your next bill".

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Crown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { useTenantSubscription } from "@/hooks/use-tenant-subscription";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import {
  confirmSentence,
  formatBillDate,
  formatMoney,
  isPreviewOnly,
  onYourBillSentence,
  premiumPitch,
  premiumPriceLabel,
  subscribedSentence,
  type CatalogEntry,
} from "@/lib/integration-billing/catalog";
import { PLAN_STATE_COPY, nextBillAt, planStateOf } from "@/lib/integration-billing/plan";
import {
  useSubscribeToIntegration,
  type IntegrationSubscriptionRow,
} from "@/lib/integration-billing/hooks";
import type { SubscribeResult } from "@/lib/integration-billing/api-client";
import { PanelNote } from "./_panels/_kit";

/* ── marks ──────────────────────────────────────────────────────────────── */

/** The small crown on a premium card and beside its dialog title. */
export function PremiumCrown({ className, title = "Premium integration" }: { className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex shrink-0", className)}>
      <Crown aria-hidden className="size-4 fill-amber-400/30 text-amber-500" />
      <span className="sr-only">{title}</span>
    </span>
  );
}

/** The Beta flag. */
export function BetaPill({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border border-primary/30 bg-primary/10 px-1.5 py-px text-[10px] font-semibold uppercase leading-4 tracking-wide text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]",
        className,
      )}
    >
      Beta
    </span>
  );
}

/**
 * A panel the operator may read but not act on. `<fieldset disabled>` disables
 * every button and input inside it at once, whatever the panel is built from;
 * links (the provider's own "Learn more") still work, which is the point.
 */
export function ReadOnlyPanel({ children }: { children: ReactNode }) {
  return (
    <fieldset disabled aria-disabled="true" className="m-0 min-w-0 border-0 p-0 opacity-90">
      {children}
    </fieldset>
  );
}

/* ── the dialog body ────────────────────────────────────────────────────── */

const cardName = (brand: string | null | undefined) =>
  brand ? brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase() : "Card";

/**
 * Wraps a board panel with what the catalog says about it. A free, available
 * integration renders its panel untouched.
 */
export function IntegrationDialogBody({
  name,
  integrationKey,
  entry,
  subscription,
  everBilled,
  children,
}: {
  name: string;
  integrationKey: string;
  entry: CatalogEntry;
  subscription: IntegrationSubscriptionRow | undefined;
  everBilled: boolean;
  children: ReactNode;
}) {
  // Someone already paying keeps a working panel even if the integration is
  // later marked not available: that flag stops new subscribers, not old ones.
  const paying = entry.isPremium && !!subscription;
  if (entry.isUnavailable && !paying) {
    return (
      <div className="space-y-5">
        <PanelNote>
          {name} isn&rsquo;t available right now. You can still read about it below.
        </PanelNote>
        <ReadOnlyPanel>{children}</ReadOnlyPanel>
      </div>
    );
  }
  if (!entry.isPremium) return <>{children}</>;
  // Coming soon: the crown, the price (or "to be announced") and nothing to
  // buy yet. No billing data is read, because nothing here can be subscribed to.
  if (isPreviewOnly(integrationKey) && !subscription) {
    return (
      <div className="space-y-5">
        <div className="flex flex-col gap-3 rounded-xl border border-amber-300/60 bg-amber-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-amber-500/30 dark:bg-amber-500/10">
          <div className="flex min-w-0 items-start gap-3">
            <PremiumCrown className="mt-0.5" />
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium text-foreground">Premium &middot; {premiumPriceLabel(entry)}</p>
              <p className="text-xs leading-relaxed text-muted-foreground">{premiumPitch(entry)}</p>
              <p className="text-xs leading-relaxed text-foreground">
                {name} is coming soon. Nothing is charged unless you subscribe after it launches.
              </p>
            </div>
          </div>
          <Button className="shrink-0" disabled>
            Coming soon
          </Button>
        </div>
        <ReadOnlyPanel>{children}</ReadOnlyPanel>
      </div>
    );
  }
  return (
    <PremiumSection
      name={name}
      integrationKey={integrationKey}
      entry={entry}
      subscription={subscription}
      everBilled={everBilled}
    >
      {children}
    </PremiumSection>
  );
}

function PremiumSection({
  name,
  integrationKey,
  entry,
  subscription,
  everBilled,
  children,
}: {
  name: string;
  integrationKey: string;
  entry: CatalogEntry;
  subscription: IntegrationSubscriptionRow | undefined;
  everBilled: boolean;
  children: ReactNode;
}) {
  const [step, setStep] = useState<"pitch" | "confirm">("pitch");
  const [done, setDone] = useState<SubscribeResult | null>(null);
  const { subscription: plan, isLoading: planLoading } = useTenantSubscription();
  const { canEditSettings } = useManagerPermissions();
  const subscribe = useSubscribeToIntegration();

  const cents = entry.monthlyPriceCents ?? 0;
  const price = formatMoney(cents, entry.currency);
  // Premium, but no price set yet: it wears the crown and cannot be bought.
  const unpriced = !entry.monthlyPriceCents;
  // The free month is for the first time only; the edge function decides, and
  // this says what it will decide.
  const freeMonth = entry.firstMonthFree && !everBilled;
  const planState = planStateOf(plan, planLoading, entry.currency);
  const canSubscribe = canEditSettings("subscription");
  // A "coming soon" preview shows its price but cannot be bought yet.
  const comingSoon = isPreviewOnly(integrationKey);
  const nextBill = nextBillAt(plan);

  /* Subscribed — now, or before this dialog opened. The panel is live. */
  if (done || subscription) {
    const monthly = done?.monthlyPriceCents ?? subscription?.monthly_price_cents ?? cents;
    const currency = done?.currency ?? subscription?.currency ?? entry.currency;
    return (
      <div className="space-y-5">
        <div className="flex items-start gap-3 rounded-xl border border-amber-300/60 bg-amber-50/60 px-4 py-3 dark:border-amber-500/30 dark:bg-amber-500/10">
          <PremiumCrown className="mt-0.5" />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-foreground">
              Subscribed &middot; {formatMoney(monthly, currency)}/month on your Drive247 bill
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {done
                ? subscribedSentence({
                    name,
                    monthlyPriceCents: done.monthlyPriceCents,
                    currency: done.currency,
                    firstMonthFree: done.firstMonthFree,
                    firstBillAt: done.firstBillAt,
                  })
                : subscription?.status === "pending"
                  ? Date.now() - new Date(subscription.subscribed_at).getTime() > 10 * 60_000
                    ? "This is taking longer than it should. Email support@drive-247.com and we will check it with Stripe."
                    : "Confirming with Stripe. This usually takes a few seconds."
                  : onYourBillSentence({ firstBillAt: subscription?.first_bill_at })}
            </p>
            <p className="text-xs text-muted-foreground">
              To stop it, email{" "}
              <a href="mailto:support@drive-247.com" className="font-medium text-primary hover:underline">
                support@drive-247.com
              </a>
              .
            </p>
          </div>
        </div>
        {children}
      </div>
    );
  }

  /* Confirm — the whole body, so there is nothing to scroll past. */
  if (step === "confirm") {
    const card = plan?.card_last4
      ? `${cardName(plan.card_brand)} •••• ${plan.card_last4}`
      : "The payment method your Drive247 plan uses";
    const nextBillText = formatBillDate(nextBill) ?? "Your next billing date";
    const rows: Array<[string, string]> = [
      [`${name} subscription`, `${price}/month`],
      ...(freeMonth ? ([["First month", "Free"]] as Array<[string, string]>) : []),
      ["Your next bill", nextBillText],
      ["Paid with", card],
    ];
    return (
      <div className="space-y-4 rounded-xl border bg-muted/20 p-5">
        <div className="flex items-center gap-2">
          <PremiumCrown />
          <h3 className="text-base font-semibold tracking-tight text-foreground">Subscribe to {name}</h3>
        </div>
        <dl className="divide-y divide-border/60">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-4 py-2">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="text-right text-sm font-medium text-foreground tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {confirmSentence({ monthlyPriceCents: cents, currency: entry.currency, firstMonthFree: freeMonth, nextBillAt: nextBill })}
        </p>
        {subscribe.error && <PanelNote tone="danger">{subscribe.error.message}</PanelNote>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => setStep("pitch")} disabled={subscribe.isPending}>
            Back
          </Button>
          <Button
            onClick={() =>
              subscribe.mutate(integrationKey, {
                onSuccess: (result) => setDone(result),
              })
            }
            disabled={subscribe.isPending}
          >
            {subscribe.isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Subscribing…
              </>
            ) : (
              `Subscribe for ${price}/month`
            )}
          </Button>
        </div>
      </div>
    );
  }

  /* Pitch — what it costs, and the button. The panel below is read-only. */
  const blocked = comingSoon
    ? `${name} is coming soon. Nothing is charged unless you subscribe after it launches.`
    : unpriced
      ? `${name} isn't on sale yet: its price hasn't been set.`
      : planState !== "ok" && planState !== "loading"
      ? PLAN_STATE_COPY[planState]
      : null;
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-xl border border-amber-300/60 bg-amber-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-amber-500/30 dark:bg-amber-500/10">
        <div className="flex min-w-0 items-start gap-3">
          <PremiumCrown className="mt-0.5" />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-foreground">Premium &middot; {premiumPriceLabel(entry)}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {premiumPitch({ monthlyPriceCents: entry.monthlyPriceCents, currency: entry.currency, firstMonthFree: freeMonth })}
            </p>
            {!blocked && canSubscribe && (
              <p className="text-xs text-foreground">Subscribe to unlock everything below.</p>
            )}
            {blocked && (
              <p className="text-xs leading-relaxed text-foreground">
                {blocked}{" "}
                {!comingSoon && !unpriced && planState !== "not_monthly" && planState !== "currency" && (
                  <Link href="/subscription" className="font-medium text-primary hover:underline">
                    Go to Billing
                  </Link>
                )}
              </p>
            )}
            {!blocked && !canSubscribe && (
              <p className="text-xs text-foreground">Only someone who can edit Billing can subscribe.</p>
            )}
          </div>
        </div>
        <Button
          className="shrink-0"
          onClick={() => {
            subscribe.reset();
            setStep("confirm");
          }}
          disabled={comingSoon || unpriced || planState !== "ok" || !canSubscribe}
        >
          {planState === "loading" && !comingSoon && !unpriced && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {comingSoon ? "Coming soon" : "Subscribe"}
        </Button>
      </div>
      <ReadOnlyPanel>{children}</ReadOnlyPanel>
    </div>
  );
}
