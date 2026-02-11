"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  useTenantSubscription,
  TenantSubscriptionInvoice,
} from "@/hooks/use-tenant-subscription";
import { useSubscriptionPlans } from "@/hooks/use-subscription-plans";
import { PricingCard } from "@/components/subscription/pricing-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
        <Skeleton className="h-[400px] w-full max-w-sm mx-auto rounded-2xl" />
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
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Subscription</h1>
          <p className="mt-1 text-muted-foreground">
            Manage your {subscription?.plan_name || "subscription"}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refetch}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <Tabs defaultValue="plan">
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
                  <span className="font-medium">
                    {formatCurrency(
                      subscription?.amount || 0,
                      subscription?.currency || "usd"
                    )}
                    /{subscription?.interval || "month"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Current Period
                  </span>
                  <span className="text-sm">
                    {formatDate(subscription?.current_period_start ?? null)} –{" "}
                    {formatDate(subscription?.current_period_end ?? null)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Next Payment
                  </span>
                  <div className="flex items-center gap-1.5">
                    <CalendarDays className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">
                      {formatDate(subscription?.current_period_end ?? null)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Payment Method */}
            <div className="rounded-lg border bg-card p-6">
              <h2 className="text-lg font-semibold mb-4">Payment Method</h2>
              {subscription?.card_last4 ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                    <CreditCard className="h-8 w-8 text-muted-foreground" />
                    <div>
                      <p className="font-medium capitalize">
                        {subscription.card_brand || "Card"} ****{" "}
                        {subscription.card_last4}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Expires {subscription.card_exp_month}/
                        {subscription.card_exp_year}
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
          <div className="rounded-lg border bg-card">
            <div className="p-6 pb-4">
              <h2 className="text-lg font-semibold">Billing History</h2>
              <p className="text-sm text-muted-foreground mt-1">
                View and download your past invoices
              </p>
            </div>
            {invoicesLoading ? (
              <div className="px-6 pb-6 space-y-3">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : invoices.length === 0 ? (
              <div className="px-6 pb-6 text-center py-8">
                <p className="text-sm text-muted-foreground">
                  No invoices yet
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left py-3 px-6 text-xs font-medium text-muted-foreground uppercase">
                        Invoice
                      </th>
                      <th className="text-left py-3 pr-4 text-xs font-medium text-muted-foreground uppercase">
                        Date
                      </th>
                      <th className="text-left py-3 pr-4 text-xs font-medium text-muted-foreground uppercase">
                        Amount
                      </th>
                      <th className="text-left py-3 pr-4 text-xs font-medium text-muted-foreground uppercase">
                        Status
                      </th>
                      <th className="text-left py-3 pr-4 text-xs font-medium text-muted-foreground uppercase">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="px-6">
                    {invoices.map((invoice) => (
                      <tr key={invoice.id} className="border-b last:border-0">
                        <td className="py-3 px-6 text-sm">
                          {invoice.invoice_number || "\u2014"}
                        </td>
                        <td className="py-3 pr-4 text-sm">
                          {formatDate(invoice.created_at)}
                        </td>
                        <td className="py-3 pr-4 text-sm">
                          {formatCurrency(invoice.amount_due, invoice.currency)}
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
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
