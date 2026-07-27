"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useSubscriptionPlans } from "@/hooks/use-subscription-plans";
import { useTenantSubscription } from "@/hooks/use-tenant-subscription";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/stores/auth-store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PricingCard } from "@/components/subscription/pricing-card";
import { CreditCard, Loader2, Mail, ShieldAlert } from "lucide-react";

interface SubscriptionGateDialogProps {
  /**
   * When omitted, defaults to `true` (matching the legacy always-open behavior).
   * Prefer passing this explicitly so the dialog can stay mounted across
   * gate-state flips without losing internal selection state.
   */
  open?: boolean;
  /**
   * "setup"    — never-subscribed tenant, Finish Setup copy.
   * "expired"  — subscription ended/canceled, harder language.
   * "past_due" — an existing customer whose payment failed and who has now
   *              exhausted the 7-day grace window. They must PAY AN EXISTING
   *              INVOICE, not buy a new subscription, so this variant shows the
   *              outstanding invoice link instead of pricing cards. Showing
   *              "choose a plan" to a paying customer is both confusing and
   *              broken — create-subscription-checkout rejects them with
   *              "Tenant already has an active subscription".
   * All three are equally non-dismissible.
   */
  variant?: "setup" | "expired" | "past_due";
}

/**
 * Non-dismissible paywall shown to a tenant who must add billing before using the
 * dashboard. It renders the SAME PricingCard the /subscription page uses, so a new
 * customer sees the full, honest price breakdown up front — "$0 today / then $X on
 * DATE" for a free-trial or upfront_monthly plan, or the real "$X/month" for a
 * charge-now plan — plus the $1 card-verification line and first-payment date. The
 * card carries its own CTA that kicks off Stripe Checkout.
 */
export function SubscriptionGateDialog({
  open = true,
  variant = "setup",
}: SubscriptionGateDialogProps = {}) {
  const isPastDue = variant === "past_due";
  const isExpired = variant === "expired" || isPastDue;
  const [subscribingPlanId, setSubscribingPlanId] = useState<string | null>(null);
  const { data: plans, isLoading: plansLoading } = useSubscriptionPlans();
  const { createCheckoutSession, outstandingInvoiceUrl } = useTenantSubscription();
  const { tenant } = useTenant();
  const { signOut } = useAuth();
  const router = useRouter();

  // The modal is deliberately inescapable (no close button, no Esc, no
  // outside-click) and covers the header, so signing out would otherwise be
  // impossible — e.g. staff who logged into the wrong account.
  const handleSignOut = async () => {
    await signOut();
    router.replace("/login");
  };

  // Go-live date drives the upfront_monthly first-charge date shown on the card.
  const billingAnchor = (
    tenant as { subscription_billing_anchor?: string | null } | null
  )?.subscription_billing_anchor;

  const handleSubscribe = async (planId: string) => {
    setSubscribingPlanId(planId);
    try {
      const origin = window.location.origin;
      const result = await createCheckoutSession.mutateAsync({
        planId,
        successUrl: `${origin}/subscription?status=success`,
        cancelUrl: `${origin}/?setup=retry`,
      });
      if (result?.url) {
        window.location.href = result.url;
      }
    } finally {
      setSubscribingPlanId(null);
    }
  };

  const hasPlans = !!plans && plans.length > 0;

  return (
    <Dialog open={open}>
      <DialogContent
        className="sm:max-w-md max-h-[90vh] overflow-y-auto [&>button:last-child]:hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {plansLoading ? (
          <div className="flex flex-col items-center py-8">
            {/* Radix requires a DialogTitle for an accessible name. With the old
                titled intro removed, this loading state is the initial render on a
                fresh open, so give it a screen-reader-only title. */}
            <DialogTitle className="sr-only">Loading subscription plans</DialogTitle>
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">Loading plans...</p>
          </div>
        ) : isPastDue ? (
          /* ── Existing customer, grace window exhausted ──
             They already have a subscription; the problem is an unpaid invoice.
             Send them straight to Stripe's hosted invoice page to settle it. */
          <>
            <DialogHeader className="text-center sm:text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
                <ShieldAlert className="h-6 w-6 text-destructive" />
              </div>
              <DialogTitle className="text-xl">
                Your subscription has expired
              </DialogTitle>
              <p className="text-sm text-muted-foreground">
                Your subscription has expired, and your access has been canceled.
                Please pay your pending invoice to restore access.
              </p>
            </DialogHeader>

            <div className="mt-2 flex flex-col gap-3">
              {outstandingInvoiceUrl ? (
                <Button asChild className="w-full" size="lg">
                  <a
                    href={outstandingInvoiceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <CreditCard className="h-4 w-4" />
                    Pay your pending invoice
                  </a>
                </Button>
              ) : (
                /* No invoice URL synced — never render a dead button; give them
                   a human instead. */
                <a
                  href="mailto:support@drive-247.com"
                  className="mx-auto inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                >
                  <Mail className="h-4 w-4" />
                  Contact support@drive-247.com to settle your invoice
                </a>
              )}
              <p className="text-center text-xs text-muted-foreground">
                Access is restored automatically once your payment clears.
              </p>
            </div>
          </>
        ) : !hasPlans ? (
          /* ── No plans configured ── */
          <>
            <DialogHeader className="text-center sm:text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Mail className="h-6 w-6 text-muted-foreground" />
              </div>
              <DialogTitle className="text-xl">No Plans Available</DialogTitle>
            </DialogHeader>

            <p className="text-sm text-muted-foreground text-center">
              No subscription plans have been activated for your account yet.
              Please contact support to get started.
            </p>

            <a
              href="mailto:support@drive-247.com"
              className="mx-auto inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
            >
              <Mail className="h-4 w-4" />
              support@drive-247.com
            </a>
          </>
        ) : (
          /* ── Plans available → full pricing card(s) right in the modal ── */
          <>
            <DialogHeader className="text-center sm:text-center">
              <div
                className={`mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full ${
                  isExpired ? "bg-destructive/10" : "bg-primary/10"
                }`}
              >
                {isExpired ? (
                  <ShieldAlert className="h-6 w-6 text-destructive" />
                ) : (
                  <CreditCard className="h-6 w-6 text-primary" />
                )}
              </div>
              <DialogTitle className="text-xl">
                {isExpired
                  ? "Your subscription has ended"
                  : "Finish Setup to Continue"}
              </DialogTitle>
              <p className="text-sm text-muted-foreground">
                {isExpired
                  ? "Resubscribe below to regain access to your dashboard."
                  : plans!.length > 1
                  ? "Choose a plan to start using Drive247."
                  : "Add your billing details below to start using Drive247."}
              </p>
            </DialogHeader>

            <div className="mt-2 flex flex-col gap-3">
              {plans!.map((plan) => (
                <PricingCard
                  key={plan.id}
                  plan={plan}
                  onSubscribe={handleSubscribe}
                  isLoading={
                    subscribingPlanId === plan.id && createCheckoutSession.isPending
                  }
                  billingAnchor={billingAnchor}
                  embedded
                />
              ))}
            </div>
          </>
        )}

        {!plansLoading && (
          <button
            type="button"
            onClick={handleSignOut}
            className="mx-auto mt-1 text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            Sign out
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}
