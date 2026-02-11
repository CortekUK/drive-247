"use client";

import { useState } from "react";
import { useSubscriptionPlans } from "@/hooks/use-subscription-plans";
import { useTenantSubscription } from "@/hooks/use-tenant-subscription";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CreditCard, Loader2, Check, Mail } from "lucide-react";

function formatPrice(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount / 100);
}

export function SubscriptionGateDialog() {
  const [step, setStep] = useState<"intro" | "plans">("intro");
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [subscribing, setSubscribing] = useState(false);
  const { data: plans, isLoading: plansLoading } = useSubscriptionPlans();
  const { createCheckoutSession } = useTenantSubscription();

  const handleSubscribe = async (planId: string) => {
    setSubscribing(true);
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
      setSubscribing(false);
    }
  };

  return (
    <Dialog open>
      <DialogContent
        className="sm:max-w-md [&>button:last-child]:hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {step === "intro" ? (
          <>
            <DialogHeader className="text-center sm:text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <CreditCard className="h-6 w-6 text-primary" />
              </div>
              <DialogTitle className="text-xl">
                Finish Setup to Continue
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-3 text-sm text-muted-foreground">
              <p>
                To complete your Drive247 setup, please add your billing
                details.
              </p>
              <p>
                Your subscription will begin automatically{" "}
                <span className="font-medium text-foreground">
                  48 hours after setup is completed
                </span>
                .
              </p>
              <p className="font-medium text-foreground">
                No charges are taken at this stage.
              </p>
            </div>

            <div className="mt-2">
              <Button onClick={() => setStep("plans")} className="w-full">
                Complete Setup
              </Button>
            </div>
          </>
        ) : plansLoading ? (
          <div className="flex flex-col items-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              Loading plans...
            </p>
          </div>
        ) : !plans || plans.length === 0 ? (
          /* ── No plans ── */
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
        ) : plans.length === 1 ? (
          /* ── Single plan ── */
          <>
            <DialogHeader className="text-center sm:text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <CreditCard className="h-6 w-6 text-primary" />
              </div>
              <DialogTitle className="text-xl">
                Complete Billing Setup
              </DialogTitle>
            </DialogHeader>

            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{plans[0].name}</span>
                <span className="text-lg font-bold">
                  {formatPrice(plans[0].amount, plans[0].currency)}
                  <span className="text-sm font-normal text-muted-foreground">
                    /{plans[0].interval}
                  </span>
                </span>
              </div>
              {plans[0].description && (
                <p className="text-sm text-muted-foreground">
                  {plans[0].description}
                </p>
              )}
              {plans[0].features.length > 0 && (
                <ul className="space-y-1.5">
                  {plans[0].features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm">
                      <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
              )}
              {plans[0].trial_days > 0 && (
                <p className="text-xs text-amber-600 font-medium">
                  Includes {plans[0].trial_days}-day free trial
                </p>
              )}
            </div>

            <p className="text-xs text-muted-foreground text-center">
              You'll be redirected to securely add billing details. No charges
              are taken at this stage.
            </p>

            <Button
              onClick={() => handleSubscribe(plans[0].id)}
              disabled={subscribing}
              className="w-full"
            >
              {subscribing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Redirecting...
                </>
              ) : (
                "Add Billing Details"
              )}
            </Button>
          </>
        ) : (
          /* ── Multiple plans ── */
          <>
            <DialogHeader className="text-center sm:text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <CreditCard className="h-6 w-6 text-primary" />
              </div>
              <DialogTitle className="text-xl">Select Your Plan</DialogTitle>
            </DialogHeader>

            <div className="space-y-2">
              {plans.map((plan) => (
                <button
                  key={plan.id}
                  onClick={() => setSelectedPlanId(plan.id)}
                  className={`w-full rounded-lg border p-4 text-left transition-colors ${
                    selectedPlanId === plan.id
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:border-muted-foreground/30"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{plan.name}</span>
                    <span className="text-lg font-bold">
                      {formatPrice(plan.amount, plan.currency)}
                      <span className="text-sm font-normal text-muted-foreground">
                        /{plan.interval}
                      </span>
                    </span>
                  </div>
                  {plan.description && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {plan.description}
                    </p>
                  )}
                  {plan.trial_days > 0 && (
                    <p className="mt-1 text-xs text-amber-600 font-medium">
                      {plan.trial_days}-day free trial
                    </p>
                  )}
                </button>
              ))}
            </div>

            <p className="text-xs text-muted-foreground text-center">
              You'll be redirected to securely add billing details. No charges
              are taken at this stage.
            </p>

            <Button
              onClick={() => selectedPlanId && handleSubscribe(selectedPlanId)}
              disabled={!selectedPlanId || subscribing}
              className="w-full"
            >
              {subscribing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Redirecting...
                </>
              ) : (
                "Add Billing Details"
              )}
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
