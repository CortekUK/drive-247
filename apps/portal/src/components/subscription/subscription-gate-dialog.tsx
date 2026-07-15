"use client";

import { useState } from "react";
import { useSubscriptionPlans } from "@/hooks/use-subscription-plans";
import { useTenantSubscription } from "@/hooks/use-tenant-subscription";
import { useTenant } from "@/contexts/TenantContext";
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
   * "setup" — never-subscribed tenant, Finish Setup copy.
   * "expired" — subscription ended/canceled, harder language.
   * Both are equally non-dismissible.
   */
  variant?: "setup" | "expired";
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
  const isExpired = variant === "expired";
  const [subscribingPlanId, setSubscribingPlanId] = useState<string | null>(null);
  const { data: plans, isLoading: plansLoading } = useSubscriptionPlans();
  const { createCheckoutSession } = useTenantSubscription();
  const { tenant } = useTenant();

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
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">Loading plans...</p>
          </div>
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

            <div className="mt-1 flex flex-col items-center gap-4">
              {plans!.map((plan) => (
                <PricingCard
                  key={plan.id}
                  plan={plan}
                  onSubscribe={handleSubscribe}
                  isLoading={
                    subscribingPlanId === plan.id && createCheckoutSession.isPending
                  }
                  billingAnchor={billingAnchor}
                />
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
