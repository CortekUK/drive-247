"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useTenantSubscription, TenantSubscriptionInvoice } from "@/hooks/use-tenant-subscription";
import { PricingCard } from "@/components/subscription/pricing-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  CreditCard,
  Crown,
  Loader2,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import { useTenant } from "@/contexts/TenantContext";

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

function LocalInvoiceView({
  invoice,
  tenantName,
  open,
  onClose,
}: {
  invoice: TenantSubscriptionInvoice | null;
  tenantName: string;
  open: boolean;
  onClose: () => void;
}) {
  if (!invoice) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <Dialog open={open} onOpenChange={(val) => !val && onClose()}>
      <DialogContent className="sm:max-w-lg print:max-w-full print:shadow-none print:border-none">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Invoice {invoice.invoice_number || ""}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 print:text-black" id="invoice-content">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold">Drive247</h2>
              <p className="text-sm text-muted-foreground print:text-gray-600">
                Platform Subscription Invoice
              </p>
            </div>
            <div className="text-right">
              <StatusBadge status={invoice.status} />
            </div>
          </div>

          <Separator />

          {/* Invoice Details */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground print:text-gray-500">Bill To</p>
              <p className="font-medium">{tenantName}</p>
            </div>
            <div className="text-right">
              <p className="text-muted-foreground print:text-gray-500">Invoice Number</p>
              <p className="font-medium">{invoice.invoice_number || "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground print:text-gray-500">Invoice Date</p>
              <p className="font-medium">{formatDateLong(invoice.created_at)}</p>
            </div>
            <div className="text-right">
              <p className="text-muted-foreground print:text-gray-500">Period</p>
              <p className="font-medium">
                {formatDate(invoice.period_start)} – {formatDate(invoice.period_end)}
              </p>
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
                  <td className="py-3">
                    <p className="font-medium">Drive247 Pro — Monthly Subscription</p>
                    <p className="text-muted-foreground print:text-gray-500">
                      {formatDate(invoice.period_start)} – {formatDate(invoice.period_end)}
                    </p>
                  </td>
                  <td className="py-3 text-right font-medium">
                    {formatCurrency(invoice.amount_due, invoice.currency)}
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td className="py-3 text-right font-semibold">Total</td>
                  <td className="py-3 text-right font-semibold">
                    {formatCurrency(invoice.amount_due, invoice.currency)}
                  </td>
                </tr>
                {invoice.status === "paid" && (
                  <tr>
                    <td className="py-1 text-right text-muted-foreground print:text-gray-500">
                      Amount Paid
                    </td>
                    <td className="py-1 text-right text-muted-foreground print:text-gray-500">
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

        <div className="flex justify-end gap-2 print:hidden">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button size="sm" onClick={handlePrint}>
            <Download className="mr-2 h-4 w-4" />
            Print / Save PDF
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
    isLoading,
    invoices,
    invoicesLoading,
    createCheckoutSession,
    createPortalSession,
    refetch,
  } = useTenantSubscription();

  const [viewingInvoice, setViewingInvoice] = useState<TenantSubscriptionInvoice | null>(null);

  // Handle return from Stripe Checkout
  useEffect(() => {
    if (searchParams.get("status") === "success") {
      toast.success("Subscription activated! Welcome to Drive247 Pro.");
      const interval = setInterval(() => refetch(), 2000);
      const timeout = setTimeout(() => clearInterval(interval), 15000);
      return () => {
        clearInterval(interval);
        clearTimeout(timeout);
      };
    }
  }, [searchParams]);

  const handleSubscribe = async () => {
    const origin = window.location.origin;
    const result = await createCheckoutSession.mutateAsync({
      successUrl: `${origin}/settings?tab=subscription&status=success`,
      cancelUrl: `${origin}/settings?tab=subscription&status=canceled`,
    });

    if (result?.url) {
      window.location.href = result.url;
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

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[300px] w-full rounded-xl" />
      </div>
    );
  }

  // Unsubscribed state
  if (!isSubscribed) {
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
            <PricingCard
              onSubscribe={handleSubscribe}
              isLoading={createCheckoutSession.isPending}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Subscribed state
  return (
    <div className="space-y-6">
      {/* Plan Section */}
      <div className="flex items-start justify-between rounded-lg border bg-card p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Crown className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h3 className="text-lg font-semibold capitalize">
              {subscription?.plan_name || "Pro"} plan
            </h3>
            <p className="text-sm text-muted-foreground">
              {formatCurrency(subscription?.amount || 20000, subscription?.currency || "usd")}/{subscription?.interval || "month"}
            </p>
            <p className="text-sm text-muted-foreground">
              Your subscription will auto renew on{" "}
              {formatDateLong(subscription?.current_period_end ?? null)}.
            </p>
          </div>
        </div>
        <Button variant="outline" disabled>
          Adjust plan
        </Button>
      </div>

      <Separator />

      {/* Payment Section */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Payment</h3>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CreditCard className="h-5 w-5 text-muted-foreground" />
            {subscription?.card_last4 ? (
              <span className="text-sm">
                <span className="capitalize">{subscription.card_brand || "Card"}</span>
                {" "}
                &bull;&bull;&bull;&bull; {subscription.card_last4}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">No payment method on file</span>
            )}
          </div>
          <Button
            variant="outline"
            onClick={handleManagePayment}
            disabled={createPortalSession.isPending}
          >
            {createPortalSession.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading...
              </>
            ) : (
              "Update"
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

      {/* Invoices Section */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Invoices</h3>

        {invoicesLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No invoices yet
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 text-sm font-semibold">Date</th>
                  <th className="text-left py-3 text-sm font-semibold">Total</th>
                  <th className="text-left py-3 text-sm font-semibold">Status</th>
                  <th className="text-left py-3 text-sm font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={invoice.id} className="border-b last:border-0">
                    <td className="py-3 text-sm">
                      {formatDate(invoice.created_at)}
                    </td>
                    <td className="py-3 text-sm">
                      {formatCurrency(invoice.amount_due, invoice.currency)}
                    </td>
                    <td className="py-3">
                      <StatusBadge status={invoice.status} />
                    </td>
                    <td className="py-3 text-sm">
                      <button
                        onClick={() => setViewingInvoice(invoice)}
                        className="text-primary hover:underline"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Local Invoice Viewer */}
      <LocalInvoiceView
        invoice={viewingInvoice}
        tenantName={tenant?.company_name || "Tenant"}
        open={!!viewingInvoice}
        onClose={() => setViewingInvoice(null)}
      />
    </div>
  );
}
