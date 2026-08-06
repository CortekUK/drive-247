"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useTenantSubscription, TenantSubscriptionInvoice } from "@/hooks/use-tenant-subscription";
import { useSubscriptionPlans } from "@/hooks/use-subscription-plans";
import { PricingCard } from "@/components/subscription/pricing-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  CreditCard,
  Crown,
  FileText,
  Loader2,
  Download,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import { UsageDashboard } from "./usage-dashboard";
import {
  CardBrandIcon,
  CardOnFile,
  cardBrandLabel,
} from "@/components/subscription/card-brand-icon";

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateLong(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
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

/**
 * Exported so /subscription renders the SAME Stripe-style receipt as Settings.
 * That page previously had a bespoke invoice table with no 3-row limit and no
 * receipt viewer — and it is the page the paywall whitelists and the page
 * checkout returns to, so it was the surface most tenants actually saw.
 */
export function LocalInvoiceView({
  invoice,
  tenantName,
  cardBrand,
  cardLast4,
  open,
  onClose,
}: {
  invoice: TenantSubscriptionInvoice | null;
  tenantName: string;
  /** Card on file, shown as Stripe shows it ("Visa •••• 4242"). */
  cardBrand?: string | null;
  cardLast4?: string | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!invoice) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <Dialog open={open} onOpenChange={(val) => !val && onClose()}>
      {/*
        THREE-ROW SHELL: header / scrollable body / footer.
        The receipt is taller than a laptop viewport once it carries a usage
        line, and DialogContent is centred with translate(-50%,-50%) and had no
        height cap — so the extra height overflowed EQUALLY off the top and the
        bottom of the screen, taking the title and all three action buttons with
        it, and nothing could scroll it back into view. Capping at the viewport
        and scrolling only the middle row keeps "Download receipt" reachable at
        every height; `minmax(0,1fr)` is what actually lets that row shrink
        below its content.

        `data-print-root` pairs with the @media print block in global.css so
        "Download receipt" prints the receipt alone rather than the receipt on
        top of the whole settings page.
      */}
      <DialogContent
        data-print-root
        className="grid max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-lg grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:w-full print:max-w-full print:border-none print:shadow-none"
      >
        <DialogHeader className="border-b px-5 py-4 sm:px-6 print:hidden">
          {/* pr-8 clears the absolutely-positioned close button. */}
          <DialogTitle className="truncate pr-8 text-base">
            Invoice {invoice.invoice_number || ""}
          </DialogTitle>
        </DialogHeader>

        <div
          className="space-y-6 overflow-y-auto px-5 py-5 sm:px-6 print:overflow-visible print:text-black"
          id="invoice-content"
        >
          {/* ── Stripe-style receipt header ──
              Mirrors Stripe's hosted receipt: a status-marked document glyph,
              the outcome as a sentence, then the amount as the largest element
              on screen. The amount is what a tenant actually opens this to see,
              so it leads rather than sitting in a table footer. */}
          <div className="flex flex-col items-center gap-3 pt-2 text-center">
            <div className="relative">
              <div className="flex h-14 w-14 items-center justify-center rounded-lg border-2 border-muted bg-muted/30">
                <FileText className="h-7 w-7 text-muted-foreground" />
              </div>
              {invoice.status === "paid" && (
                <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-green-500 ring-2 ring-background print:ring-0">
                  <Check className="h-4 w-4 text-white" strokeWidth={3} />
                </span>
              )}
            </div>

            <p className="text-sm text-muted-foreground print:text-gray-600">
              {invoice.status === "paid"
                ? "Invoice paid"
                : invoice.status === "open"
                  ? "Invoice due"
                  : `Invoice ${invoice.status}`}
            </p>

            <p className="text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl">
              {formatCurrency(
                invoice.status === "paid" ? invoice.amount_paid : invoice.amount_due,
                invoice.currency,
              )}
            </p>

            {/* Stripe's "View invoice and payment details ›" affordance — only
                rendered when there is a genuine hosted page behind it. */}
            {invoice.stripe_hosted_invoice_url && (
              <a
                href={invoice.stripe_hosted_invoice_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline print:hidden"
              >
                View invoice and payment details
                <ChevronRight className="h-4 w-4" />
              </a>
            )}
          </div>

          <Separator />

          {/* Receipt facts, in Stripe's label/value rows.
              Labels never shrink and values wrap toward the right, so a long
              invoice number or company name reflows onto a second line instead
              of squeezing its label into a vertical column of letters. */}
          <div className="space-y-2.5 text-sm">
            <div className="flex items-start justify-between gap-3">
              <span className="shrink-0 text-muted-foreground print:text-gray-500">
                Invoice number
              </span>
              <span className="min-w-0 break-all text-right font-medium tabular-nums">
                {invoice.invoice_number || "—"}
              </span>
            </div>
            <div className="flex items-start justify-between gap-3">
              <span className="shrink-0 text-muted-foreground print:text-gray-500">
                {invoice.paid_at ? "Payment date" : "Invoice date"}
              </span>
              <span className="min-w-0 text-right font-medium">
                {/* invoice_date before created_at: an unpaid or voided invoice has no
                    paid_at, and created_at is our row-INSERT time — which the
                    reconciler stamps at backfill, so the receipt printed the day
                    we imported the row as the invoice date. */}
                {formatDateLong(invoice.paid_at || invoice.invoice_date || invoice.created_at)}
              </span>
            </div>
            {/* Rendered off last4 alone: with the artwork carrying the brand, an
                unrecognised or missing brand degrades to the neutral card mark
                and the row still states a true fact. It stays hidden entirely
                when there is no card on file — a receipt that invents
                "•••• ••••" is worse than one that omits the row. */}
            {cardLast4 && (
              <div className="flex items-start justify-between gap-3">
                <span className="shrink-0 text-muted-foreground print:text-gray-500">
                  Payment method
                </span>
                <span className="flex min-w-0 items-center justify-end gap-2 font-medium">
                  <CardBrandIcon brand={cardBrand} className="h-5 w-[30px]" />
                  <span className="tabular-nums">
                    <span className="sr-only">
                      {cardBrandLabel(cardBrand)} ending in {cardLast4}
                    </span>
                    <span aria-hidden="true">•••• {cardLast4}</span>
                  </span>
                </span>
              </div>
            )}
            <div className="flex items-start justify-between gap-3">
              <span className="shrink-0 text-muted-foreground print:text-gray-500">Billed to</span>
              <span className="min-w-0 break-words text-right font-medium">{tenantName}</span>
            </div>
            <div className="flex items-start justify-between gap-3">
              <span className="shrink-0 text-muted-foreground print:text-gray-500">Period</span>
              <span className="min-w-0 text-right font-medium">
                {formatDate(invoice.period_start)} – {formatDate(invoice.period_end)}
              </span>
            </div>
          </div>

          <Separator />

          {/* Line Items */}
          <div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 font-medium">Description</th>
                  <th className="text-right py-2 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b">
                  <td className="py-3 pr-3">
                    <p className="font-medium">Monthly Subscription</p>
                    <p className="text-muted-foreground print:text-gray-500">
                      {formatDate(invoice.period_start)} – {formatDate(invoice.period_end)}
                    </p>
                  </td>
                  <td className="whitespace-nowrap py-3 text-right font-medium tabular-nums">
                    {invoice.base_amount != null
                      ? formatCurrency(invoice.base_amount, invoice.currency)
                      : formatCurrency(invoice.amount_due, invoice.currency)}
                  </td>
                </tr>
                {invoice.usage_amount != null && invoice.usage_amount > 0 && (
                  <tr className="border-b">
                    <td className="py-3 pr-3">
                      <p className="font-medium">E-Sign Usage</p>
                      <p className="text-muted-foreground print:text-gray-500">
                        {invoice.usage_quantity || 0} agreement{(invoice.usage_quantity || 0) !== 1 ? "s" : ""}
                      </p>
                    </td>
                    <td className="whitespace-nowrap py-3 text-right font-medium tabular-nums">
                      {formatCurrency(invoice.usage_amount, invoice.currency)}
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td className="py-3 pr-3 text-right font-semibold">Total</td>
                  <td className="whitespace-nowrap py-3 text-right font-semibold tabular-nums">
                    {formatCurrency(invoice.amount_due, invoice.currency)}
                  </td>
                </tr>
                {invoice.status === "paid" && (
                  <tr>
                    <td className="py-1 pr-3 text-right text-muted-foreground print:text-gray-500">
                      Amount Paid
                    </td>
                    <td className="whitespace-nowrap py-1 text-right tabular-nums text-muted-foreground print:text-gray-500">
                      {formatCurrency(invoice.amount_paid, invoice.currency)}
                    </td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>

          {invoice.paid_at && (
            <>
              <Separator />
              <p className="text-xs text-muted-foreground print:text-gray-500 text-center">
                Paid on {formatDateLong(invoice.paid_at)}
              </p>
            </>
          )}
        </div>

        {/* Stripe pairs "Download invoice" (outline) with "Download receipt"
            (solid). We map the first to Stripe's own PDF when we have it, and
            keep local print as the fallback so the button is never dead.

            Sits OUTSIDE the scroll region so the actions stay pinned to the
            bottom of the dialog at any viewport height — this row was the first
            thing to disappear off-screen before the shell was capped. */}
        <div className="flex flex-col-reverse gap-2 border-t bg-background px-5 py-4 sm:flex-row sm:justify-end sm:px-6 print:hidden">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="w-full sm:w-auto"
          >
            Close
          </Button>
          {invoice.stripe_invoice_pdf && (
            <Button variant="outline" size="sm" asChild className="w-full sm:w-auto">
              <a
                href={invoice.stripe_invoice_pdf}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Download className="mr-2 h-4 w-4" />
                Download invoice
              </a>
            </Button>
          )}
          <Button size="sm" onClick={handlePrint} className="w-full sm:w-auto">
            <Download className="mr-2 h-4 w-4" />
            Download receipt
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SubscriptionSettings() {
  const { tenant } = useTenant();
  const searchParams = useSearchParams();
  const {
    subscription,
    isSubscribed,
    isGraceExpired,
    owesOutstandingInvoice,
    isTrialing,
    trialDaysRemaining,
    openInvoice,
    outstandingInvoiceUrl,
    isLoading,
    invoices,
    invoicesLoading,
    createCheckoutSession,
    createPortalSession,
    refetch,
  } = useTenantSubscription();
  const { data: plans, isLoading: plansLoading } = useSubscriptionPlans();

  const [viewingInvoice, setViewingInvoice] = useState<TenantSubscriptionInvoice | null>(null);
  const [subscribingPlanId, setSubscribingPlanId] = useState<string | null>(null);

  /**
   * Billing history + receipt viewer, shared by EVERY branch below.
   *
   * The past_due / grace-expired / unsubscribed branches all early-return before
   * the main layout, which meant a tenant lost their entire invoice list and
   * every download link at exactly the moment they most need a receipt — while
   * chasing a failed payment, or after cancelling. Rendering it from one place
   * keeps the history reachable in all states.
   *
   * Renders nothing when there are no invoices, so a brand-new tenant sees no
   * empty scaffolding.
   */
  const billingHistory =
    invoices.length > 0 ? (
      <>
        <UsageDashboard
          invoices={invoices}
          invoicesLoading={invoicesLoading}
          onViewInvoice={setViewingInvoice}
        />
        <LocalInvoiceView
          invoice={viewingInvoice}
          tenantName={tenant?.company_name || "Tenant"}
          cardBrand={subscription?.card_brand}
          cardLast4={subscription?.card_last4}
          open={!!viewingInvoice}
          onClose={() => setViewingInvoice(null)}
        />
      </>
    ) : null;

  // Handle return from Stripe Checkout, and from the Billing Portal.
  //
  // Both land back here before their webhook has necessarily been delivered, so
  // a single fetch races Stripe and can paint stale data. The portal return used
  // to carry no marker at all, which is why an updated card could keep showing
  // the OLD brand/last4 indefinitely: nothing re-fetched, and
  // refetchOnWindowFocus is disabled globally.
  useEffect(() => {
    const status = searchParams.get("status");
    if (status !== "success" && status !== "payment-updated") return;

    toast({
      title:
        status === "success"
          ? "Subscription activated successfully!"
          : "Payment method updated",
    });
    const interval = setInterval(() => refetch(), 2000);
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
        successUrl: `${origin}/settings?tab=subscription&status=success`,
        cancelUrl: `${origin}/settings?tab=subscription&status=canceled`,
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
    // Return with an explicit marker so the poll above runs. window.location.href
    // carried no status param, so the card change raced the webhook and often
    // never appeared.
    const origin = window.location.origin;
    const result = await createPortalSession.mutateAsync({
      returnUrl: `${origin}/settings?tab=subscription&status=payment-updated`,
    });

    if (result?.url) {
      window.location.href = result.url;
    }
  };

  if (isLoading || plansLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[300px] w-full rounded-xl" />
      </div>
    );
  }

  // An existing customer whose grace window lapsed is NOT an unsubscribed
  // prospect. Sending them down the "choose a plan" path is a dead end:
  // create-subscription-checkout rejects them with 409 "Tenant already has an
  // active subscription", so the Subscribe button can only ever produce an
  // error toast. What they need is the outstanding invoice.
  // Also fires when the subscription is already CANCELED but an invoice is still
  // open. Stripe's default at the end of dunning is to cancel, which moves the
  // row off past_due — so a debtor stopped matching either condition here and
  // fell through to the pricing cards, free to buy a SECOND subscription while
  // the original debt sat unpaid and unmentioned. This page is the one the hard
  // paywall whitelists, so that is exactly where they land.
  if (isGraceExpired || subscription?.status === "past_due" || owesOutstandingInvoice) {
    return (
      <div className="space-y-6">
        <Card>
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
            {/* BOTH actions are required, and paying alone is not enough.
                Settling a hosted invoice clears that ONE invoice; it does not
                change the subscription's default payment method. A tenant whose
                card was declined would pay, then fail again next cycle, forever.
                The 7-day grace window exists precisely so they can FIX THE CARD,
                and this branch is the only screen they can reach while past_due —
                every other "Update payment method" control lives in the
                subscribed branch below, which this early-return skips. */}
            <div className="flex flex-wrap gap-3">
              {outstandingInvoiceUrl && (
                <Button asChild>
                  <a
                    href={outstandingInvoiceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <CreditCard className="mr-2 h-4 w-4" />
                    Pay your pending invoice
                  </a>
                </Button>
              )}
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
            </div>
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

  // Unsubscribed state
  if (!isSubscribed) {
    const hasPlans = plans && plans.length > 0;

    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-primary" />
              Subscription
            </CardTitle>
            <CardDescription>
              Subscribe to access the full Drive247 platform
            </CardDescription>
          </CardHeader>
          <CardContent>
            {hasPlans ? (
              <div className={`flex flex-wrap justify-center gap-6 ${plans.length === 1 ? '' : 'max-w-4xl mx-auto'}`}>
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
            ) : (
              <div className="text-center py-8">
                <p className="text-muted-foreground">
                  No subscription plans are available yet. Please contact us to get started.
                </p>
                <a
                  href="mailto:support@drive-247.com"
                  className="mt-2 inline-block text-primary hover:underline"
                >
                  support@drive-247.com
                </a>
              </div>
            )}
          </CardContent>
        </Card>
        {/* A cancelled tenant is unsubscribed but still needs their receipts —
            for their accountant, or to dispute a charge. Renders nothing when
            there are no invoices, so a genuinely new tenant sees no scaffolding. */}
        {billingHistory}
      </div>
    );
  }

  // Subscribed state.
  //
  // Uses the hook's `openInvoice`, which is scoped to the CURRENT subscription.
  // This used to do its own `invoices.find(...)` over every invoice the tenant
  // has ever had, so a debt belonging to a dead subscription — even one from a
  // different Stripe mode — raised "Payment failed" on a perfectly healthy one.
  // Settling the current subscription could not clear it, because the banner was
  // anchored on an invoice that had nothing to do with it.
  const unpaidInvoice = openInvoice;

  return (
    <div className="space-y-6">
      {/* Payment Failed Banner */}
      {unpaidInvoice && (
        <div className="flex items-start justify-between gap-4 rounded-lg border border-orange-200 bg-orange-50 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-orange-600" />
            <div className="space-y-0.5">
              <p className="text-sm font-semibold text-orange-900">
                Payment failed
              </p>
              <p className="text-sm text-orange-800">
                Your invoice of{" "}
                {formatCurrency(unpaidInvoice.amount_due, unpaidInvoice.currency)}
                {" "}for{" "}
                {formatDate(unpaidInvoice.period_start)} – {formatDate(unpaidInvoice.period_end)}
                {" "}is unpaid. Pay now to keep your subscription active.
              </p>
            </div>
          </div>
          {unpaidInvoice.stripe_hosted_invoice_url && (
            <Button
              asChild
              size="sm"
              className="shrink-0 bg-orange-600 text-white hover:bg-orange-700"
            >
              <a
                href={unpaidInvoice.stripe_hosted_invoice_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Pay now
              </a>
            </Button>
          )}
        </div>
      )}

      {/* Plan Section
          No "Adjust plan" control by design: we do not offer self-serve plan
          changes — pricing is agreed per-tenant on a sales call. The server
          already enforces this (create-subscription-portal-session sets
          subscription_update: false), so this is the UI catching up to the
          actual product rule rather than a feature being hidden. */}
      <div className="flex rounded-lg border bg-card p-4 sm:p-6">
        <div className="flex items-start gap-3 sm:gap-4 min-w-0">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 shrink-0">
            <Crown className="h-6 w-6 text-primary" />
          </div>
          <div className="min-w-0">
            {/* No invented plan name or price. Pricing here is custom per tenant
                (agreed on a sales call), so a "Pro" / $200.00 fallback is not a
                harmless placeholder — it states a plan and a price this tenant
                may never have agreed to, on the exact screen they check their
                billing on. `??` rather than `||` because a comped $0
                subscription is a real, valid amount that `||` would discard. */}
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold capitalize">
                {subscription?.plan_name ? `${subscription.plan_name} plan` : "Subscription"}
              </h3>
              {subscription?.status && <StatusBadge status={subscription.status} />}
            </div>
            <p className="text-sm text-muted-foreground">
              {subscription?.amount != null
                ? `${formatCurrency(subscription.amount, subscription.currency || "usd")}/${subscription.interval || "month"}`
                : "Custom pricing"}
            </p>
            {isTrialing && trialDaysRemaining > 0 && (
              <p className="text-sm text-blue-600 dark:text-blue-400">
                Trial — {trialDaysRemaining} day{trialDaysRemaining === 1 ? "" : "s"} remaining
              </p>
            )}
            {/* Never promise a renewal that is not going to happen. A tenant
                who has cancelled is scheduled to TERMINATE on cancel_at — and
                telling them they will "auto renew" on the very day their access
                ends is a support incident (or a chargeback) waiting to happen.
                Same for a failed payment: renewal is not the next event, paying
                the outstanding invoice is. */}
            {subscription?.cancel_at || subscription?.canceled_at ? (
              <p className="text-sm text-amber-600 dark:text-amber-500">
                Your subscription is scheduled to end on{" "}
                {formatDateLong(
                  subscription?.cancel_at ?? subscription?.current_period_end ?? null,
                )}
                . You will keep access until then.
              </p>
            ) : subscription?.status === "past_due" ? (
              <p className="text-sm text-amber-600 dark:text-amber-500">
                Your last payment failed. Please settle your outstanding invoice
                to keep your subscription active.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Your subscription will auto renew on{" "}
                {formatDateLong(subscription?.current_period_end ?? null)}.
              </p>
            )}
          </div>
        </div>
      </div>

      <Separator />

      {/* Payment Section
          Boxed to match the plan card above it, and showing the ACTUAL network
          artwork rather than a generic credit-card glyph — the brand is the one
          thing that lets an operator with several cards tell at a glance which
          one we will charge. Expiry rides along because a lapsed date is the
          most common reason the next renewal fails, and the fix (Update) is
          right beside it. */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Payment</h3>
        <div className="flex flex-col gap-4 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          {subscription?.card_last4 ? (
            <CardOnFile
              brand={subscription.card_brand}
              last4={subscription.card_last4}
              expMonth={subscription.card_exp_month}
              expYear={subscription.card_exp_year}
            />
          ) : (
            <div className="flex min-w-0 items-center gap-3">
              <CardBrandIcon brand={null} className="text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                No payment method on file
              </span>
            </div>
          )}
          <Button
            variant="outline"
            onClick={handleManagePayment}
            disabled={createPortalSession.isPending}
            className="w-full shrink-0 sm:w-auto"
          >
            {createPortalSession.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading...
              </>
            ) : subscription?.card_last4 ? (
              "Update"
            ) : (
              "Add payment method"
            )}
          </Button>
        </div>
      </div>

      <Separator />

      {/* Cancellation Section */}
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Cancel subscription</h3>
        <p className="text-sm text-muted-foreground">
          To cancel your subscription, please contact us at{" "}
          <a
            href="mailto:support@drive-247.com"
            className="text-primary hover:underline"
          >
            support@drive-247.com
          </a>
        </p>
      </div>

      <Separator />

      {/* Usage dashboard, billing history and receipt viewer — see `billingHistory`. */}
      {billingHistory}
    </div>
  );
}
