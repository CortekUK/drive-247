"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  useTenantSubscription,
  TenantSubscriptionInvoice,
} from "@/hooks/use-tenant-subscription";
import { useSubscriptionPlans } from "@/hooks/use-subscription-plans";
import { PricingCard } from "@/components/subscription/pricing-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CreditCard,
  Download,
  ExternalLink,
  Loader2,
  CalendarDays,
  RefreshCw,
  Crown,
  Shield,
} from "lucide-react";
import { toast } from "sonner";
import {
  Eyebrow,
  Tile,
  StatusPill,
  type StatusTone,
  Segmented,
  TableTile,
  Money,
  EmptyState,
} from "@/components/bento";

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

function statusToneFor(status: string): StatusTone {
  if (status === "active" || status === "paid") return "success";
  if (status === "trialing") return "info";
  if (status === "past_due" || status === "open") return "danger";
  return "neutral";
}

function StatusBadge({ status }: { status: string }) {
  return (
    <StatusPill tone={statusToneFor(status)} dot className="capitalize">
      {status.replace("_", " ")}
    </StatusPill>
  );
}

export default function SubscriptionPage() {
  const searchParams = useSearchParams();
  const {
    subscription,
    isSubscribed,
    isLoading,
    invoices,
    invoicesLoading,
    createCheckoutSession,
    createPortalSession,
    refetch,
  } = useTenantSubscription();
  const { data: plans, isLoading: plansLoading } = useSubscriptionPlans();

  const [subscribingPlanId, setSubscribingPlanId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"plan" | "invoices">("plan");

  // Handle return from Stripe Checkout
  useEffect(() => {
    if (searchParams.get("status") === "success") {
      toast.success("Subscription activated successfully!");
      // Poll for webhook to process
      const interval = setInterval(() => {
        refetch();
      }, 2000);
      const timeout = setTimeout(() => clearInterval(interval), 15000);
      return () => {
        clearInterval(interval);
        clearTimeout(timeout);
      };
    }
  }, [searchParams]);

  const handleSubscribe = async (planId: string) => {
    setSubscribingPlanId(planId);
    try {
      const origin = window.location.origin;
      const result = await createCheckoutSession.mutateAsync({
        planId,
        successUrl: `${origin}/subscription?status=success`,
        cancelUrl: `${origin}/subscription?status=canceled`,
      });

      if (result?.url) {
        window.location.href = result.url;
      }
    } finally {
      setSubscribingPlanId(null);
    }
  };

  const handleManagePayment = async () => {
    const result = await createPortalSession.mutateAsync({
      returnUrl: window.location.href,
    });

    if (result?.url) {
      window.location.href = result.url;
    }
  };

  if (isLoading || plansLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="h-[280px] w-full rounded-tile" />
          <Skeleton className="h-[280px] w-full rounded-tile" />
        </div>
      </div>
    );
  }

  // Unsubscribed state
  if (!isSubscribed) {
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
      </div>
    );
  }

  // Subscribed state
  return (
    <div className="container mx-auto p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Eyebrow>Billing</Eyebrow>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight">Subscription</h1>
          <p className="mt-1 text-muted-foreground">
            Manage your {subscription?.plan_name || "subscription"}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refetch}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <Segmented
        options={[
          { value: "plan", label: "Plan" },
          { value: "invoices", label: "Invoices" },
        ]}
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "plan" | "invoices")}
      />

      {activeTab === "plan" && (
        <div className="mt-6">
          <div className="grid gap-6 md:grid-cols-2">
            {/* Plan Details */}
            <Tile pad="roomy">
              <h2 className="text-lg font-bold tracking-tight mb-4">Plan Details</h2>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Plan</span>
                  <span className="font-medium capitalize">
                    {subscription?.plan_name || "Pro"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Status</span>
                  <StatusBadge status={subscription?.status || "active"} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Amount</span>
                  <Money className="font-semibold">
                    {formatCurrency(
                      subscription?.amount || 0,
                      subscription?.currency || "usd"
                    )}
                    /{subscription?.interval || "month"}
                  </Money>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Current Period
                  </span>
                  <Money className="text-sm">
                    {formatDate(subscription?.current_period_start ?? null)} –{" "}
                    {formatDate(subscription?.current_period_end ?? null)}
                  </Money>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Next Payment
                  </span>
                  <div className="flex items-center gap-1.5">
                    <CalendarDays className="h-4 w-4 text-muted-foreground" />
                    <Money className="text-sm">
                      {formatDate(subscription?.current_period_end ?? null)}
                    </Money>
                  </div>
                </div>
              </div>
            </Tile>

            {/* Payment Method */}
            <Tile pad="roomy">
              <h2 className="text-lg font-bold tracking-tight mb-4">Payment Method</h2>
              {subscription?.card_last4 ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 p-3 rounded-tile-sm [background:var(--bento-tile-2)]">
                    <CreditCard className="h-8 w-8 text-muted-foreground" />
                    <div>
                      <p className="font-semibold capitalize">
                        {subscription.card_brand || "Card"} ****{" "}
                        <Money>{subscription.card_last4}</Money>
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Expires <Money>{subscription.card_exp_month}/
                        {subscription.card_exp_year}</Money>
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    onClick={handleManagePayment}
                    disabled={createPortalSession.isPending}
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
                </div>
              ) : (
                <div className="text-center py-4">
                  <p className="text-sm text-muted-foreground mb-3">
                    No payment method on file
                  </p>
                  <Button
                    variant="outline"
                    onClick={handleManagePayment}
                    disabled={createPortalSession.isPending}
                  >
                    Add Payment Method
                  </Button>
                </div>
              )}

              <div className="mt-6 pt-4 border-t border-border">
                <h3 className="text-sm font-semibold mb-2">
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
            </Tile>
          </div>
        </div>
      )}

      {activeTab === "invoices" && (
        <div className="mt-6">
          <TableTile
            toolbar={
              <div>
                <h2 className="text-lg font-bold tracking-tight">Billing History</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  View and download your past invoices
                </p>
              </div>
            }
          >
            {invoicesLoading ? (
              <div className="px-6 pb-6 space-y-3">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : invoices.length === 0 ? (
              <div className="px-6 pb-6">
                <EmptyState
                  icon={<CreditCard className="h-5 w-5" />}
                  title="No invoices yet"
                  description="Your billing history will appear here once you have invoices."
                  className="border-none shadow-none"
                />
              </div>
            ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border [background:var(--bento-tile-2)]">
                      <th className="text-left py-3 px-6 text-[10.5px] font-bold uppercase tracking-wider text-[color:var(--bento-text-3)]">
                        Invoice
                      </th>
                      <th className="text-left py-3 pr-4 text-[10.5px] font-bold uppercase tracking-wider text-[color:var(--bento-text-3)]">
                        Date
                      </th>
                      <th className="text-right py-3 pr-4 text-[10.5px] font-bold uppercase tracking-wider text-[color:var(--bento-text-3)]">
                        Amount
                      </th>
                      <th className="text-left py-3 pr-4 text-[10.5px] font-bold uppercase tracking-wider text-[color:var(--bento-text-3)]">
                        Status
                      </th>
                      <th className="text-left py-3 pr-4 text-[10.5px] font-bold uppercase tracking-wider text-[color:var(--bento-text-3)]">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((invoice) => (
                      <tr key={invoice.id} className="border-b border-border last:border-0 transition-colors hover:bg-[color:var(--bento-tile-2)]">
                        <td className="py-3 px-6 text-sm">
                          <Money>{invoice.invoice_number || "\u2014"}</Money>
                        </td>
                        <td className="py-3 pr-4 text-sm">
                          <Money>{formatDate(invoice.created_at)}</Money>
                        </td>
                        <td className="py-3 pr-4 text-right">
                          <Money className="text-sm">{formatCurrency(invoice.amount_due, invoice.currency)}</Money>
                        </td>
                        <td className="py-3 pr-4">
                          <StatusBadge status={invoice.status} />
                        </td>
                        <td className="py-3 pr-4 text-sm">
                          <div className="flex items-center gap-2">
                            {invoice.stripe_hosted_invoice_url && (
                              <a
                                href={invoice.stripe_hosted_invoice_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-primary hover:underline"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                                View
                              </a>
                            )}
                            {invoice.stripe_invoice_pdf && (
                              <a
                                href={invoice.stripe_invoice_pdf}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-primary hover:underline"
                              >
                                <Download className="h-3.5 w-3.5" />
                                PDF
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
            )}
          </TableTile>
        </div>
      )}
    </div>
  );
}
