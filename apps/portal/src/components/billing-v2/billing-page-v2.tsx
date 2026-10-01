"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import {
  useTenantSubscription,
  TenantSubscription,
  TenantSubscriptionInvoice,
} from "@/hooks/use-tenant-subscription";
import { useSubscriptionPlans } from "@/hooks/use-subscription-plans";
import { useTenant } from "@/contexts/TenantContext";
import { PricingCard } from "@/components/subscription/pricing-card";
import { Button } from "@/components/ui/button";
import { AutoSkeleton } from "@/components/skeleton-v2/auto-skeleton";
import { useSkeletonLoading } from "@/hooks/use-skeleton-loading";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { UsageDashboard } from "@/components/settings/usage-dashboard";
import { ReceiptDialogV2 } from "@/components/billing-v2/receipt-dialog-v2";
import type { SavedCard } from "@/components/subscription/payment-methods";
import { PaymentCard3D } from "@/components/billing-v2/payment-card-3d";
import { SubscriptionSummaryV2 } from "@/components/billing-v2/subscription-summary-v2";
import { ReferralTileV2 } from "@/components/billing-v2/referral-tile-v2";
import { ReferralSummaryV2 } from "@/components/billing-v2/referral-summary-v2";
import { CardManagerDialogV2, type WalletCard } from "@/components/billing-v2/card-manager-dialog-v2";
import {
  useIsBillingPreviewTenant,
  useBillingPreview,
  usePreviewInvoices,
  usePreviewSubscription,
} from "@/components/billing/billing-preview";
import {
  CreditCard,
  Loader2,
  CalendarDays,
  RefreshCw,
  Crown,
  Shield,
  AlertTriangle,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  SettingsEmptyState,
  SettingsLoadError,
  SettingsReadOnlyFieldset,
  SettingsReadOnlyNotice,
} from "@/components/settings-v2/section-states";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { BILLING_READ_ONLY_COPY } from "@/components/settings-v2/billing-states-v2";
import { useIntegrationBilling, useInvoiceLines } from "@/lib/integration-billing/hooks";
import { NextInvoiceCard } from "@/components/integration-billing/next-invoice-card";

/**
 * Billing, v2 (v2-chrome tenants only — the route picks this or the untouched
 * v1 page in `app/(dashboard)/subscription/page.tsx`).
 *
 * Forked from the v2 paths of that page, minus what v2 no longer has:
 *   - no Credits. Credits are not used; the only checkout that returns here is
 *     a subscription checkout, so the "which checkout was it" guess is gone.
 *   - no tab strip. v2 has no sub-tabs anywhere; billing is one column.
 */

/**
 * The placeholder subscription the skeleton renders through the subscribed
 * layout (the common case): only its shape is ever seen.
 */
const SKELETON_SUBSCRIPTION = {
  status: "active",
  plan_name: "xxxxxxxx",
  amount: 14900,
  currency: "usd",
  interval: "month",
  current_period_end: "2026-02-15T10:00:00.000Z",
  cancel_at: null,
  card_brand: "visa",
  card_last4: "4242",
  card_exp_month: 12,
  card_exp_year: 2030,
} as unknown as TenantSubscription;

export function BillingPageV2() {
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
    subscriptionError,
    invoicesError,
    createCheckoutSession,
    createPortalSession,
    refetch,
  } = useTenantSubscription();
  const {
    data: plans,
    isLoading: plansLoading,
    error: plansError,
    refetch: refetchPlans,
    isFetching: plansFetching,
  } = useSubscriptionPlans();
  const { tenant } = useTenant();
  // Referrals is open to every tenant (no v2 area since 30 Sep 2026).
  const referralsOn = true;

  const [subscribingPlanId, setSubscribingPlanId] = useState<string | null>(null);
  const [viewingInvoice, setViewingInvoice] = useState<TenantSubscriptionInvoice | null>(null);
  const [methodsOpen, setMethodsOpen] = useState(false);

  /* Back from Stripe Checkout, the webhook has not necessarily landed. Say it
     is confirming, say "active" only once the subscription row does, and after
     the 15s poll say it is slow. */
  const [checkoutPhase, setCheckoutPhase] = useState<"idle" | "confirming" | "slow">("idle");

  /* A viewer, or a manager without an editor grant on Settings › Subscription,
     reads everything here and cannot subscribe, change cards or cancel. */
  const { canEditSettings } = useManagerPermissions();
  const readOnly = !canEditSettings("subscription");
  const readOnlyWrap = (node: ReactNode) => (
    <SettingsReadOnlyFieldset readOnly={readOnly}>{node}</SettingsReadOnlyFieldset>
  );

  // ── Preview mode (canary tenant only) — see billing-preview.tsx ──────────
  const isPreviewTenant = useIsBillingPreviewTenant();
  const previewActive = useBillingPreview(
    !!subscription || invoices.length > 0 || invoicesLoading,
  );
  const previewSubscription = usePreviewSubscription(previewActive);
  const previewInvoices = usePreviewInvoices(previewActive);

  // While billing loads, the subscribed layout renders a placeholder
  // subscription and <AutoSkeleton> turns it into the skeleton.
  const pageLoading = useSkeletonLoading(isLoading || plansLoading || (isPreviewTenant && invoicesLoading));
  const shownSubscription = pageLoading
    ? SKELETON_SUBSCRIPTION
    : previewActive
      ? previewSubscription
      : subscription;

  const savedCards: SavedCard[] = shownSubscription?.card_last4
    ? [
        {
          brand: shownSubscription.card_brand,
          last4: shownSubscription.card_last4,
          expMonth: shownSubscription.card_exp_month,
          expYear: shownSubscription.card_exp_year,
          isPrimary: true,
        },
      ]
    : [];
  const shownInvoices = previewActive ? previewInvoices : invoices;

  /* The wallet: every card, as the page and the Cards dialog both see it.
     Real account: the one card on the subscription row (changes go through
     Stripe's portal). The canary's sample account: a Visa and a Mastercard,
     held here so add / edit / primary / remove stick while on the page, and
     the 3D card always shows whichever is primary. */
  const holder = tenant?.company_name ?? null;
  const [localWallet, setLocalWallet] = useState<WalletCard[] | null>(null);
  const wallet: WalletCard[] = previewActive
    ? localWallet ?? [
        { id: "visa-4242", brand: "visa", last4: "4242", expMonth: 12, expYear: 2029, isPrimary: true, name: holder },
        { id: "mc-5454", brand: "mastercard", last4: "5454", expMonth: 8, expYear: 2028, isPrimary: false, name: holder },
      ]
    : savedCards.map((c, i) => ({ ...c, id: `${c.last4}-${i}`, name: holder }));
  const primaryCard = wallet.find((c) => c.isPrimary) ?? wallet[0] ?? null;

  /* Integration billing: the bill is shown line by line. Never against sample data. */
  const lineByLine = useIntegrationBilling() && !previewActive;
  const viewingLines = useInvoiceLines(lineByLine ? viewingInvoice?.stripe_invoice_id : null);

  /* The receipt viewer, on its own: the subscribed page has no invoices table
     now, but Payment history's "View" opens it. */
  const invoiceViewer = (
    <ReceiptDialogV2
      invoice={viewingInvoice}
      tenantName={tenant?.company_name || "Tenant"}
      cardBrand={shownSubscription?.card_brand}
      cardLast4={shownSubscription?.card_last4}
      open={!!viewingInvoice}
      onClose={() => setViewingInvoice(null)}
      lines={lineByLine ? viewingLines.data?.lines ?? null : undefined}
      linesLoading={lineByLine && !!viewingInvoice && viewingLines.isLoading}
      linesUnavailable={lineByLine && !!viewingInvoice && viewingLines.isError}
    />
  );

  const billingHistory =
    shownInvoices.length > 0 ? (
      <>
        <UsageDashboard
          invoices={shownInvoices}
          invoicesLoading={previewActive ? false : invoicesLoading}
          onViewInvoice={setViewingInvoice}
          hideBreakdown={lineByLine}
        />
        {invoiceViewer}
      </>
    ) : null;

  // Keyed on the value, not the URLSearchParams object: a re-render must never
  // restart the 15s clock or put "slow" back to "confirming".
  const returnStatus = searchParams.get("status");

  // Return from Stripe Checkout or the Billing Portal: poll until the webhook lands.
  useEffect(() => {
    if (returnStatus !== "success" && returnStatus !== "payment-updated") return;
    if (returnStatus === "payment-updated") toast.success("Payment method updated");
    const interval = setInterval(() => {
      refetch();
    }, 2000);
    const timeout = setTimeout(() => clearInterval(interval), 15000);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [returnStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Back from Stripe's "confirm your plan change" page: ask the server to record
     the new plan (a no-op if they left without confirming), then poll so the
     webhook's sync shows. Runs once per return. */
  const planParam = searchParams.get("plan");
  useEffect(() => {
    if (returnStatus !== "plan-updated" || !planParam || !tenant?.id) return;
    let cancelled = false;
    const [kind, value] = planParam.split(":");
    void supabase.functions
      .invoke("change-subscription-plan-v2", {
        body: { tenantId: tenant.id, action: "confirm", ...(kind === "id" ? { planId: value } : { planKey: value }) },
      })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          toast.error("We couldn't confirm your plan change", { description: "If you were charged, it will show here shortly." });
        } else if (data?.changed) {
          toast.success(`You're now on ${data.planName}`);
        } else {
          toast("Your plan wasn't changed", { description: "Nothing was charged." });
        }
        const interval = setInterval(() => refetch(), 2000);
        setTimeout(() => clearInterval(interval), 15000);
      });
    return () => {
      cancelled = true;
    };
  }, [returnStatus, planParam, tenant?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (returnStatus === "canceled") {
      toast("Checkout canceled", { description: "No charge was made." });
      return;
    }
    if (returnStatus !== "success") return;
    setCheckoutPhase("confirming");
    const slow = setTimeout(() => setCheckoutPhase((phase) => (phase === "confirming" ? "slow" : phase)), 15000);
    return () => clearTimeout(slow);
  }, [returnStatus]);

  useEffect(() => {
    if (checkoutPhase === "idle" || !isSubscribed) return;
    setCheckoutPhase("idle");
    toast.success("Your subscription is active");
  }, [checkoutPhase, isSubscribed]);

  const handleSubscribe = async (planId: string, consent?: { termsAccepted: boolean }) => {
    setSubscribingPlanId(planId);
    try {
      const origin = window.location.origin;
      const result = await createCheckoutSession.mutateAsync({
        planId,
        successUrl: `${origin}/subscription?status=success`,
        cancelUrl: `${origin}/subscription?status=canceled`,
        termsAccepted: consent?.termsAccepted === true,
      });
      if (result?.url) window.location.href = result.url;
    } finally {
      setSubscribingPlanId(null);
    }
  };

  const handleManagePayment = async () => {
    // Must never open a real Stripe session against sample data.
    if (previewActive) return;
    const origin = window.location.origin;
    const result = await createPortalSession.mutateAsync({
      returnUrl: `${origin}/subscription?status=payment-updated`,
    });
    if (result?.url) window.location.href = result.url;
  };

  // A failed subscription read is not "not subscribed". None of these
  // branches is taken while loading: the skeleton is the subscribed layout.
  if (!pageLoading && subscriptionError && !subscription) {
    return (
      <div className="mx-auto w-full max-w-2xl p-6">
        <SettingsLoadError thing="your billing details" error={subscriptionError} onRetry={refetch} />
      </div>
    );
  }

  // Payment required — MUST come before the unsubscribed branch: a
  // grace-expired or dunning-canceled tenant would otherwise reach the pricing
  // cards and could only get a 409 (see the v1 page for the full history).
  if (
    !pageLoading &&
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
            <CardDescription>Your last subscription payment did not go through.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {readOnly && <SettingsReadOnlyNotice copy={BILLING_READ_ONLY_COPY} />}
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
            {/* Paying clears one invoice but leaves the declined card as default,
                so the card must be fixable from here too. */}
            <Button
              variant={outstandingInvoiceUrl ? "outline" : "default"}
              onClick={handleManagePayment}
              disabled={createPortalSession.isPending || readOnly}
            >
              {createPortalSession.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CreditCard className="mr-2 h-4 w-4" />
              )}
              Update payment method
            </Button>
            {!outstandingInvoiceUrl && invoicesLoading && (
              <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Loading your invoice link…
              </p>
            )}
            {!outstandingInvoiceUrl && !invoicesLoading && (
              <p className="text-sm">
                We could not load your invoice link. Please contact{" "}
                <a href="mailto:support@drive-247.com" className="font-medium text-primary dark:text-[hsl(var(--v2-link,var(--primary)))] hover:underline">
                  support@drive-247.com
                </a>{" "}
                to settle it.
              </p>
            )}
            {!outstandingInvoiceUrl && !!invoicesError && !invoicesLoading && (
              <Button variant="ghost" size="sm" onClick={refetch}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Try loading it again
              </Button>
            )}
          </CardContent>
        </Card>
        {billingHistory}
      </div>
    );
  }

  // Unsubscribed.
  if (!pageLoading && !isSubscribed && !previewActive) {
    const hasPlans = plans && plans.length > 0;

    // Just back from Checkout: pricing cards here would invite a second checkout.
    if (checkoutPhase !== "idle") {
      return (
        <div className="mx-auto w-full max-w-2xl space-y-6 p-6">
          {checkoutPhase === "confirming" ? (
            <div role="status" className="flex flex-col items-center gap-3 rounded-2xl bg-card px-6 py-12 text-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" aria-hidden="true" />
              <h1 className="font-heading text-lg font-semibold tracking-tight text-foreground">Confirming your subscription…</h1>
              <p className="max-w-sm text-sm text-muted-foreground">
                Your checkout is complete. Stripe usually confirms it within a few seconds, and this page updates by itself.
              </p>
            </div>
          ) : (
            <SettingsEmptyState
              icon={CalendarDays}
              headline="Activation is taking longer than usual"
              body="Your checkout is complete, but Stripe hasn't confirmed it yet. Check again in a minute. Please don't start a second checkout."
              primaryAction={{ label: "Check again", onClick: refetch, icon: RefreshCw }}
              secondaryAction={{ label: "Contact support", href: "mailto:support@drive-247.com" }}
            />
          )}
        </div>
      );
    }

    return (
      <div className="p-6">
        <div className="mb-10 text-center max-w-2xl mx-auto">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <Crown className="h-7 w-7 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Choose your plan</h1>
          <p className="mt-2 text-muted-foreground text-base">
            Subscribe to unlock the full Drive247 platform and grow your rental business
          </p>
          {readOnly && <SettingsReadOnlyNotice copy={BILLING_READ_ONLY_COPY} className="mt-4" />}
        </div>

        {plansError && !plans ? (
          <div className="mx-auto max-w-2xl">
            <SettingsLoadError thing="your plans" error={plansError} onRetry={() => refetchPlans()} retrying={plansFetching} />
          </div>
        ) : hasPlans ? (
          <>
            {readOnlyWrap(
              <div className={`flex flex-wrap justify-center gap-8 ${plans.length === 1 ? "" : "max-w-5xl mx-auto"}`}>
                {plans.map((plan) => (
                  <PricingCard
                    key={plan.id}
                    plan={plan}
                    onSubscribe={handleSubscribe}
                    isLoading={subscribingPlanId === plan.id && createCheckoutSession.isPending}
                    billingAnchor={(tenant as { subscription_billing_anchor?: string | null } | null)?.subscription_billing_anchor}
                  />
                ))}
              </div>,
            )}

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
            <a href="mailto:support@drive-247.com" className="mt-4 inline-block text-primary dark:text-[hsl(var(--v2-link,var(--primary)))] hover:underline">
              support@drive-247.com
            </a>
          </div>
        )}
        {/* A cancelled tenant is unsubscribed but still needs their receipts. */}
        {billingHistory}
        {!!invoicesError && invoices.length === 0 && (
          <div className="mx-auto mt-10 max-w-2xl">
            <SettingsLoadError thing="your invoices" error={invoicesError} onRetry={refetch} />
          </div>
        )}
      </div>
    );
  }

  // Subscribed — first screen (plan, card, referrals), then next invoice and invoices.
  return (
    <div className="mx-auto w-full max-w-[1240px] p-6">
      {/* First screen: header, plan details and the card/referrals row fit ONE
          viewport on desktop (100svh less the 4rem top bar and this page's
          p-6). The card/referrals row takes what is left and the card sizes to
          it (its face scales as a whole — see payment-card-3d). A floor keeps a
          very short window usable; below md it just stacks and scrolls. */}
      {/* The whole first screen is the skeleton region (its flex column must
          stay one element for the card to size); the header is kept real. */}
      <AutoSkeleton loading={pageLoading} className="flex flex-col gap-6 md:h-[calc(100svh-7rem)] md:min-h-[600px]">
        <div className="shrink-0" data-skeleton-keep>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Billing</h1>
          <p className="mt-1 text-muted-foreground">
            Your plan, your card, and your referral savings.
          </p>
          {readOnly && <SettingsReadOnlyNotice copy={BILLING_READ_ONLY_COPY} className="mt-2" />}
        </div>

            {/* What they pay: the big number, and base − discounts beside it. */}
            <SubscriptionSummaryV2
              baseCents={shownSubscription?.amount ?? null}
              currency={shownSubscription?.currency || "usd"}
              interval={shownSubscription?.interval || "month"}
              nextBillAt={shownSubscription?.current_period_end ?? null}
              periodStart={shownSubscription?.current_period_start ?? null}
              cardOnFile={primaryCard ? { brand: primaryCard.brand, last4: primaryCard.last4 } : null}
              endsAt={shownSubscription?.cancel_at ?? null}
              useStripeInvoice={lineByLine}
              invoices={shownInvoices}
              onViewInvoice={setViewingInvoice}
              payDisabled={previewActive || pageLoading}
              planName={shownSubscription?.plan_name ?? null}
              readOnly={readOnly}
              card={
              <div className="flex h-full min-h-0 flex-col md:[container-type:size]">
                {/* Card and its button in ONE column that is exactly as wide as
                    the card (w-fit), so the button matches the card's width. */}
                <div className="flex h-full justify-center">
                  <div className="flex w-full max-w-[440px] flex-col gap-4 md:w-fit md:max-w-none">
                    {primaryCard ? (
                      /* The card itself opens Manage cards (the dialog carries Add card too). */
                      <button
                        type="button"
                        onClick={() => setMethodsOpen(true)}
                        aria-label="Manage cards"
                        // The skeleton draws the card as one bone, not its face.
                        data-skeleton-block
                        className="group block rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2"
                      >
                      <PaymentCard3D
                        brand={primaryCard.brand}
                        last4={primaryCard.last4}
                        expMonth={primaryCard.expMonth}
                        expYear={primaryCard.expYear}
                        name={primaryCard.name}
                        isPrimary={primaryCard.isPrimary}
                        actionLabel="Manage card"
                      />

                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setMethodsOpen(true)}
                        className="py-10 text-center text-sm text-primary dark:text-[hsl(var(--v2-link,var(--primary)))] transition-opacity duration-200 ease-out hover:opacity-80 motion-reduce:transition-none"
                      >
                        No payment method on file · Add card
                      </button>
                    )}
                  </div>
                </div>
              </div>
              }
            />

            {/* Band 2 — referrals: the programme on the left, the coupon on the
                right, in the same two columns as the subscription band above. */}
            {referralsOn && (
              <section
                aria-label="Referrals"
                className="grid gap-8 border-t pt-6 md:min-h-0 md:flex-1 md:grid-cols-[minmax(0,1fr)_360px] md:grid-rows-[minmax(0,1fr)] md:gap-12 lg:grid-cols-[minmax(0,1fr)_400px]"
              >
                <ReferralSummaryV2 readOnly={readOnly} />
                <ReferralTileV2 readOnly={readOnly} />
              </section>
            )}


      </AutoSkeleton>

      <div className="space-y-8 [&:not(:empty)]:mt-8">
        {lineByLine && <NextInvoiceCard />}

        {invoiceViewer}

        <CardManagerDialogV2
          open={methodsOpen}
          onOpenChange={setMethodsOpen}
          cards={wallet}
          onChange={setLocalWallet}
          local={previewActive}
          holderName={holder}
          onStripe={handleManagePayment}
          isRedirecting={createPortalSession.isPending}
          readOnly={readOnly}
        />

      </div>
    </div>
  );
}
