"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useTenantSubscription,
  TenantSubscriptionInvoice,
} from "@/hooks/use-tenant-subscription";
import { useSubscriptionPlans } from "@/hooks/use-subscription-plans";
import { useTenant } from "@/contexts/TenantContext";
import { isLeanTenant } from "@/lib/lean-areas";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PricingCard } from "@/components/subscription/pricing-card";
import { CreditsPanel } from "@/components/billing/credits-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
// Shared with Settings so both surfaces render the same billing history and the
// same Stripe-style receipt, instead of drifting into two implementations.
import { UsageDashboard } from "@/components/settings/usage-dashboard";
import { LocalInvoiceView } from "@/components/settings/subscription-settings";
import { CardBrandIcon, CardOnFile } from "@/components/subscription/card-brand-icon";
// Canary-only sample billing data. See the header of billing-preview.tsx for
// why the gate is written on the SLUG and not as a `V2Area`.
import {
  useIsBillingPreviewTenant,
  useBillingPreview,
  usePreviewInvoices,
  usePreviewSubscription,
  PreviewDataPill,
  PreviewDataNotice,
  PreviewDisabledNote,
} from "@/components/billing/billing-preview";
import {
  CreditCard,
  Download,
  ExternalLink,
  Loader2,
  CalendarDays,
  RefreshCw,
  Crown,
  Shield,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "\u2014";
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "active" || status === "paid"
      ? "default"
      : status === "trialing"
        ? "secondary"
        : status === "past_due" || status === "open"
          ? "destructive"
          : "outline";

  return (
    <Badge variant={variant} className="capitalize">
      {status.replace("_", " ")}
    </Badge>
  );
}

export default function SubscriptionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    subscription,
    isSubscribed,
    isGraceExpired,
    owesOutstandingInvoice,
    outstandingInvoiceUrl,
    isLoading,
    invoices,
    invoicesLoading,
    createCheckoutSession,
    createPortalSession,
    refetch,
  } = useTenantSubscription();
  const { data: plans, isLoading: plansLoading } = useSubscriptionPlans();
  const { tenant } = useTenant();

  const [subscribingPlanId, setSubscribingPlanId] = useState<string | null>(null);
  const [viewingInvoice, setViewingInvoice] = useState<TenantSubscriptionInvoice | null>(null);

  // ── Preview mode (canary tenant only) ──────────────────────────────────────
  //
  // Only ONE of this page's three render paths draws the product — the Plan /
  // Invoices / Credits tab strip below, which sits behind `isSubscribed`. The
  // canary has no subscription, so it lands on the "no plans available" dead end
  // and the screens being built cannot be reviewed. On that tenant, and only
  // while there is nothing real to show, render the subscribed layout against
  // sample data instead.
  //
  // `hasRealData` includes `invoicesLoading` so a real invoice arriving a beat
  // after the subscription query can never flash sample data first, and the
  // whole thing switches itself off the moment northwind has a real
  // subscription or a real invoice — truth always wins.
  const isPreviewTenant = useIsBillingPreviewTenant();
  const previewActive = useBillingPreview(
    !!subscription || invoices.length > 0 || invoicesLoading,
  );
  const previewSubscription = usePreviewSubscription(previewActive);
  const previewInvoices = usePreviewInvoices(previewActive);

  /** What the subscribed layout below renders — real data unless it is absent. */
  const shownSubscription = previewActive ? previewSubscription : subscription;
  const shownInvoices = previewActive ? previewInvoices : invoices;

  // No tab state: the page is one column now. `?tab=credits` links that
  // predate this still resolve — they land on the same page, and the Credits
  // section is simply further down it rather than behind a click.

  /**
   * Billing history + receipt viewer, shared by every branch of this page and
   * identical to Settings. Replaces a bespoke table that mapped the FULL invoice
   * list with no 3-row limit and no receipt view, so the "last three
   * transactions, styled like Stripe" requirement was met on one surface only.
   *
   * Renders nothing when there are no invoices.
   */
  const billingHistory =
    shownInvoices.length > 0 ? (
      <>
        <UsageDashboard
          invoices={shownInvoices}
          invoicesLoading={previewActive ? false : invoicesLoading}
          onViewInvoice={setViewingInvoice}
        />
        <LocalInvoiceView
          invoice={viewingInvoice}
          tenantName={tenant?.company_name || "Tenant"}
          cardBrand={shownSubscription?.card_brand}
          cardLast4={shownSubscription?.card_last4}
          open={!!viewingInvoice}
          onClose={() => setViewingInvoice(null)}
        />
      </>
    ) : null;

  // Handle return from Stripe Checkout AND from the Billing Portal.
  //
  // Both return before their webhook has necessarily landed, so a single fetch
  // races Stripe. The portal return previously carried no marker at all, so an
  // updated card could keep showing the OLD brand/last4 indefinitely
  // (refetchOnWindowFocus is disabled globally). Mirrors subscription-settings.tsx.
  useEffect(() => {
    const status = searchParams.get("status");
    if (status !== "success" && status !== "payment-updated") return;

    toast.success(
      status === "success"
        ? "Subscription activated successfully!"
        : "Payment method updated",
    );
    const interval = setInterval(() => {
      refetch();
    }, 2000);
    const timeout = setTimeout(() => clearInterval(interval), 15000);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [searchParams]);

  const handleSubscribe = async (
    planId: string,
    consent?: { termsAccepted: boolean },
  ) => {
    setSubscribingPlanId(planId);
    try {
      const origin = window.location.origin;
      const result = await createCheckoutSession.mutateAsync({
        planId,
        successUrl: `${origin}/subscription?status=success`,
        cancelUrl: `${origin}/subscription?status=canceled`,
        termsAccepted: consent?.termsAccepted === true,
      });

      if (result?.url) {
        window.location.href = result.url;
      }
    } finally {
      setSubscribingPlanId(null);
    }
  };

  const handleManagePayment = async () => {
    // Belt and braces: the buttons are disabled in preview, but this opens a
    // real Stripe Billing Portal session against a subscription that does not
    // exist, so it must not be reachable by any path while previewing.
    if (previewActive) return;
    // Explicit marker so the poll above runs on return; window.location.href
    // carried none, so the card change raced the webhook and often never showed.
    const origin = window.location.origin;
    const result = await createPortalSession.mutateAsync({
      returnUrl: `${origin}/subscription?status=payment-updated`,
    });

    if (result?.url) {
      window.location.href = result.url;
    }
  };

  // The extra `invoicesLoading` wait applies to the canary ONLY, so no other
  // tenant's first paint is held up by a query this page did not previously
  // block on. It exists so the preview decision is made once, against settled
  // data, instead of rendering "choose your plan" for a frame and then swapping.
  if (isLoading || plansLoading || (isPreviewTenant && invoicesLoading)) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[400px] w-full max-w-sm mx-auto rounded-2xl" />
      </div>
    );
  }

  // Payment required — MUST come before the !isSubscribed branch below.
  //
  // A grace-expired tenant has isSubscribed === false while their Stripe
  // subscription is still past_due. Without this branch they fell through to
  // "Choose your plan" — and create-subscription-checkout rejects them with 409
  // "Tenant already has an active subscription", so every Subscribe click could
  // only ever produce an error toast. This page is BOTH the route the hard
  // paywall whitelists and the one its "pay" links point at, so that dead end
  // was hit by exactly the tenants trying to give us money.
  //
  // Mirrors the same branch in subscription-settings.tsx.
  // Also fires when the subscription is already CANCELED but an invoice is still
  // open. Stripe's default at the end of dunning is to cancel, which moves the
  // row off past_due — so a debtor stopped matching either condition here and
  // fell through to the pricing cards, free to buy a SECOND subscription while
  // the original debt sat unpaid and unmentioned. This page is the one the hard
  // paywall whitelists, so that is exactly where they land.
  //
  // `!previewActive` is defensive rather than load-bearing: preview requires no
  // real subscription AND no real invoices, and each of these three conditions
  // requires one or the other, so they are already mutually exclusive. Written
  // explicitly so a later change to either side cannot quietly put a fabricated
  // "payment required" screen in front of an operator.
  if (
    !previewActive &&
    (isGraceExpired || subscription?.status === "past_due" || owesOutstandingInvoice)
  ) {
    return (
      <div className="p-6 space-y-6">
        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Payment required
            </CardTitle>
            <CardDescription>
              Your last subscription payment did not go through.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {isGraceExpired
                ? "Your subscription has expired, and your access has been canceled. Please pay your pending invoice to restore access."
                : "Please settle your outstanding invoice to keep your subscription active."}
            </p>
            {outstandingInvoiceUrl && (
              <Button asChild>
                <a href={outstandingInvoiceUrl} target="_blank" rel="noopener noreferrer">
                  <CreditCard className="mr-2 h-4 w-4" />
                  Pay your pending invoice
                </a>
              </Button>
            )}
            {/* Paying is NOT enough on its own — settling a hosted invoice
                clears that one invoice but leaves the same declined card as the
                subscription's default, so the next cycle fails again. The 7-day
                grace window exists so the operator can FIX THE CARD, and this
                branch is the only screen reachable while past_due (every other
                "Update payment method" control lives in the subscribed branch
                that this early-return skips). Mirrors subscription-settings.tsx. */}
            <Button
              variant={outstandingInvoiceUrl ? "outline" : "default"}
              onClick={handleManagePayment}
              disabled={createPortalSession.isPending}
            >
              {createPortalSession.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CreditCard className="mr-2 h-4 w-4" />
              )}
              Update payment method
            </Button>
            {!outstandingInvoiceUrl && (
              <p className="text-sm">
                We could not load your invoice link. Please contact{" "}
                <a
                  href="mailto:support@drive-247.com"
                  className="font-medium text-primary hover:underline"
                >
                  support@drive-247.com
                </a>{" "}
                to settle it.
              </p>
            )}
          </CardContent>
        </Card>
        {billingHistory}
      </div>
    );
  }

  // Unsubscribed state.
  //
  // This is the branch the canary hits, and the one that renders "No
  // subscription plans are available yet" for a tenant with no plans — i.e. the
  // dead end preview exists to step around. Every other tenant still lands here
  // exactly as before.
  if (!isSubscribed && !previewActive) {
    const hasPlans = plans && plans.length > 0;

    return (
      <div className="p-6">
        {/* Header */}
        <div className="mb-10 text-center max-w-2xl mx-auto">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <Crown className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            Choose your plan
          </h1>
          <p className="mt-2 text-muted-foreground text-base">
            Subscribe to unlock the full Drive247 platform and grow your rental business
          </p>
        </div>

        {hasPlans ? (
          <>
            <div className={`flex flex-wrap justify-center gap-8 ${plans.length === 1 ? '' : 'max-w-5xl mx-auto'}`}>
              {plans.map((plan) => (
                <PricingCard
                  key={plan.id}
                  plan={plan}
                  onSubscribe={handleSubscribe}
                  isLoading={subscribingPlanId === plan.id && createCheckoutSession.isPending}
                  billingAnchor={(tenant as { subscription_billing_anchor?: string | null } | null)?.subscription_billing_anchor}
                />
              ))}
            </div>

            {/* Trust signals */}
            <div className="mt-10 flex flex-wrap items-center justify-center gap-6 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5" />
                <span>Secure payment via Stripe</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CreditCard className="h-3.5 w-3.5" />
                <span>No hidden fees</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5" />
                <span>Cancel anytime</span>
              </div>
            </div>
          </>
        ) : (
          <div className="text-center py-12 max-w-md mx-auto">
            <p className="text-muted-foreground">
              No subscription plans are available yet. Please contact us to get started.
            </p>
            <a
              href="mailto:support@drive-247.com"
              className="mt-4 inline-block text-primary hover:underline"
            >
              support@drive-247.com
            </a>
          </div>
        )}
        {/* A cancelled tenant is unsubscribed but still needs their receipts.
            Mirrors subscription-settings.tsx. */}
        {billingHistory}
      </div>
    );
  }

  // Subscribed state
  return (
    <div className="container mx-auto p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {/* "Billing" is the canary's name for this screen, because on the
                canary it also holds Credits. The other 36 still get a page that
                is only the subscription, so renaming it for them would be a
                visible change to a shared screen for no reason. */}
            {isLeanTenant(tenant?.slug) ? "Billing" : "Subscription"}
          </h1>
            {/* Non-negotiable marker. A fabricated invoice that reads as real is
                worse than an empty page, so the label sits next to the title,
                above the fold, on every tab. */}
            {previewActive && <PreviewDataPill />}
          </div>
          {previewActive ? (
            <PreviewDataNotice className="mt-1.5 max-w-xl" />
          ) : (
            <p className="mt-1 truncate text-muted-foreground">
              Manage your {subscription?.plan_name || "subscription"}
            </p>
          )}
        </div>
        {/* Refetching is harmless, but in preview it would refresh queries whose
            answers this screen is not showing — an inert control that looks
            live. Disabled instead. */}
        <Button
          variant="outline"
          size="sm"
          onClick={refetch}
          disabled={previewActive}
          title={previewActive ? "Not available while previewing sample data" : undefined}
          className="shrink-0"
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* CANARY GETS ONE PAGE; EVERYONE ELSE KEEPS THEIR TABS.
          Plan / Invoices / Credits used to sit behind a tab strip for every
          tenant. Billing reads better top to bottom — what you are on, what you
          have been charged, what you have left — and the strip hid two thirds of
          that behind a click.

          But that is a visible change to a shared screen, and the other 36
          tenants are not part of this work. They render exactly the layout they
          rendered yesterday. The bodies below are shared, so the two layouts
          cannot drift apart. */}
      {isLeanTenant(tenant?.slug) ? (
        <div className="space-y-10">
          <section className="mt-6">
          <div className="grid gap-6 md:grid-cols-2">
            {/* Plan Details */}
            <div className="rounded-lg border bg-card p-6">
              <h2 className="text-lg font-semibold mb-4">Plan Details</h2>
              <div className="space-y-4">
                {/* No invented plan, price or status. Pricing is custom per
                    tenant (agreed on a sales call), so "Pro" / "$0.00" / a
                    hardcoded "active" badge state facts this tenant may never
                    have agreed to, on the screen they check their billing on.
                    Mirrors subscription-settings.tsx.

                    The ONE exception is `previewActive` on the canary, where
                    these values come from billing-preview.tsx — and that state
                    announces itself with the "Preview data" pill in the header
                    and disables every money action on the page. */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Plan</span>
                  <span className="font-medium capitalize">
                    {shownSubscription?.plan_name || "—"}
                  </span>
                </div>
                {shownSubscription?.status && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Status</span>
                    <StatusBadge status={shownSubscription.status} />
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Amount</span>
                  <span className="font-medium">
                    {shownSubscription?.amount != null
                      ? `${formatCurrency(shownSubscription.amount, shownSubscription.currency || "usd")}/${shownSubscription.interval || "month"}`
                      : "Custom pricing"}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span className="shrink-0 text-sm text-muted-foreground">
                    Current Period
                  </span>
                  {/* A full date range is the longest value in this card and was
                      the first thing to collide with its own label once the
                      grid dropped to one column. */}
                  <span className="min-w-0 text-right text-sm">
                    {formatDate(shownSubscription?.current_period_start ?? null)} –{" "}
                    {formatDate(shownSubscription?.current_period_end ?? null)}
                  </span>
                </div>
                {/* Never present the day access ENDS as the day they will be
                    charged again. A tenant who has cancelled is scheduled to
                    terminate on cancel_at, and labelling that "Next Payment" is
                    a support ticket (or a chargeback) waiting to happen.
                    Mirrors subscription-settings.tsx. */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {shownSubscription?.cancel_at || shownSubscription?.canceled_at
                      ? "Access Ends"
                      : "Next Payment"}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <CalendarDays className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">
                      {formatDate(
                        shownSubscription?.cancel_at ??
                          shownSubscription?.current_period_end ??
                          null,
                      )}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Payment Method */}
            <div className="rounded-lg border bg-card p-6">
              <h2 className="text-lg font-semibold mb-4">Payment Method</h2>
              {shownSubscription?.card_last4 ? (
                <div className="space-y-4">
                  {/* Real network artwork, and the same CardOnFile block Settings
                      renders, so the two billing surfaces cannot drift. The old
                      markup also printed a bare "Expires undefined/undefined"
                      whenever Stripe had not sent expiry back yet. */}
                  <CardOnFile
                    brand={shownSubscription.card_brand}
                    last4={shownSubscription.card_last4}
                    expMonth={shownSubscription.card_exp_month}
                    expYear={shownSubscription.card_exp_year}
                    className="rounded-lg bg-muted/50 p-3"
                  />
                  <Button
                    variant="outline"
                    onClick={handleManagePayment}
                    disabled={createPortalSession.isPending || previewActive}
                    className="w-full"
                  >
                    {createPortalSession.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Redirecting...
                      </>
                    ) : (
                      "Update Payment Method"
                    )}
                  </Button>
                  {previewActive && <PreviewDisabledNote />}
                </div>
              ) : (
                <div className="py-4 text-center">
                  <CardBrandIcon
                    brand={null}
                    className="mx-auto mb-3 h-10 w-[3.75rem] text-muted-foreground"
                  />
                  <p className="mb-3 text-sm text-muted-foreground">
                    No payment method on file
                  </p>
                  <Button
                    variant="outline"
                    onClick={handleManagePayment}
                    disabled={createPortalSession.isPending || previewActive}
                  >
                    Add Payment Method
                  </Button>
                  {previewActive && <PreviewDisabledNote className="mt-3" />}
                </div>
              )}

              <div className="mt-6 pt-4 border-t">
                <h3 className="text-sm font-medium mb-2">
                  Need to cancel?
                </h3>
                <p className="text-sm text-muted-foreground">
                  Please contact us at{" "}
                  <a
                    href="mailto:support@drive-247.com"
                    className="text-primary hover:underline"
                  >
                    support@drive-247.com
                  </a>{" "}
                  to discuss cancellation.
                </p>
              </div>
            </div>
          </div>
          </section>

          <section>
            <h2 className="mb-4 text-lg font-semibold tracking-tight">Invoices</h2>
          {/* Same component as Settings: last three transactions by default with
              a "Show all" escape hatch, a per-row download, and the Stripe-style
              receipt viewer. The bespoke table that used to live here mapped the
              FULL invoice list and had no receipt view. */}
          {invoicesLoading && !previewActive ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : shownInvoices.length === 0 ? (
            <div className="rounded-lg border bg-card px-6 py-8 text-center">
              <p className="text-sm text-muted-foreground">No invoices yet</p>
            </div>
          ) : (
            billingHistory
          )}
          </section>

          <section>
            <h2 className="mb-4 text-lg font-semibold tracking-tight">Credits</h2>
            <CreditsPanel />
          </section>
        </div>
      ) : (
        <Tabs defaultValue="plan">
          {/* Two tabs, exactly as before. Credits is deliberately NOT here:
              merging it into this screen is canary work, and `/credits` remains
              its own page in these tenants' sidebar, unchanged. */}
          <TabsList>
            <TabsTrigger value="plan">Plan</TabsTrigger>
            <TabsTrigger value="invoices">Invoices</TabsTrigger>
          </TabsList>

          <TabsContent value="plan" className="mt-6">
          <div className="grid gap-6 md:grid-cols-2">
            {/* Plan Details */}
            <div className="rounded-lg border bg-card p-6">
              <h2 className="text-lg font-semibold mb-4">Plan Details</h2>
              <div className="space-y-4">
                {/* No invented plan, price or status. Pricing is custom per
                    tenant (agreed on a sales call), so "Pro" / "$0.00" / a
                    hardcoded "active" badge state facts this tenant may never
                    have agreed to, on the screen they check their billing on.
                    Mirrors subscription-settings.tsx.

                    The ONE exception is `previewActive` on the canary, where
                    these values come from billing-preview.tsx — and that state
                    announces itself with the "Preview data" pill in the header
                    and disables every money action on the page. */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Plan</span>
                  <span className="font-medium capitalize">
                    {shownSubscription?.plan_name || "—"}
                  </span>
                </div>
                {shownSubscription?.status && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Status</span>
                    <StatusBadge status={shownSubscription.status} />
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Amount</span>
                  <span className="font-medium">
                    {shownSubscription?.amount != null
                      ? `${formatCurrency(shownSubscription.amount, shownSubscription.currency || "usd")}/${shownSubscription.interval || "month"}`
                      : "Custom pricing"}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span className="shrink-0 text-sm text-muted-foreground">
                    Current Period
                  </span>
                  {/* A full date range is the longest value in this card and was
                      the first thing to collide with its own label once the
                      grid dropped to one column. */}
                  <span className="min-w-0 text-right text-sm">
                    {formatDate(shownSubscription?.current_period_start ?? null)} –{" "}
                    {formatDate(shownSubscription?.current_period_end ?? null)}
                  </span>
                </div>
                {/* Never present the day access ENDS as the day they will be
                    charged again. A tenant who has cancelled is scheduled to
                    terminate on cancel_at, and labelling that "Next Payment" is
                    a support ticket (or a chargeback) waiting to happen.
                    Mirrors subscription-settings.tsx. */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {shownSubscription?.cancel_at || shownSubscription?.canceled_at
                      ? "Access Ends"
                      : "Next Payment"}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <CalendarDays className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">
                      {formatDate(
                        shownSubscription?.cancel_at ??
                          shownSubscription?.current_period_end ??
                          null,
                      )}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Payment Method */}
            <div className="rounded-lg border bg-card p-6">
              <h2 className="text-lg font-semibold mb-4">Payment Method</h2>
              {shownSubscription?.card_last4 ? (
                <div className="space-y-4">
                  {/* Real network artwork, and the same CardOnFile block Settings
                      renders, so the two billing surfaces cannot drift. The old
                      markup also printed a bare "Expires undefined/undefined"
                      whenever Stripe had not sent expiry back yet. */}
                  <CardOnFile
                    brand={shownSubscription.card_brand}
                    last4={shownSubscription.card_last4}
                    expMonth={shownSubscription.card_exp_month}
                    expYear={shownSubscription.card_exp_year}
                    className="rounded-lg bg-muted/50 p-3"
                  />
                  <Button
                    variant="outline"
                    onClick={handleManagePayment}
                    disabled={createPortalSession.isPending || previewActive}
                    className="w-full"
                  >
                    {createPortalSession.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Redirecting...
                      </>
                    ) : (
                      "Update Payment Method"
                    )}
                  </Button>
                  {previewActive && <PreviewDisabledNote />}
                </div>
              ) : (
                <div className="py-4 text-center">
                  <CardBrandIcon
                    brand={null}
                    className="mx-auto mb-3 h-10 w-[3.75rem] text-muted-foreground"
                  />
                  <p className="mb-3 text-sm text-muted-foreground">
                    No payment method on file
                  </p>
                  <Button
                    variant="outline"
                    onClick={handleManagePayment}
                    disabled={createPortalSession.isPending || previewActive}
                  >
                    Add Payment Method
                  </Button>
                  {previewActive && <PreviewDisabledNote className="mt-3" />}
                </div>
              )}

              <div className="mt-6 pt-4 border-t">
                <h3 className="text-sm font-medium mb-2">
                  Need to cancel?
                </h3>
                <p className="text-sm text-muted-foreground">
                  Please contact us at{" "}
                  <a
                    href="mailto:support@drive-247.com"
                    className="text-primary hover:underline"
                  >
                    support@drive-247.com
                  </a>{" "}
                  to discuss cancellation.
                </p>
              </div>
            </div>
          </div>
          </TabsContent>

          <TabsContent value="invoices" className="mt-6">
          {/* Same component as Settings: last three transactions by default with
              a "Show all" escape hatch, a per-row download, and the Stripe-style
              receipt viewer. The bespoke table that used to live here mapped the
              FULL invoice list and had no receipt view. */}
          {invoicesLoading && !previewActive ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : shownInvoices.length === 0 ? (
            <div className="rounded-lg border bg-card px-6 py-8 text-center">
              <p className="text-sm text-muted-foreground">No invoices yet</p>
            </div>
          ) : (
            billingHistory
          )}
          </TabsContent>

        </Tabs>
      )}
    </div>
  );
}
