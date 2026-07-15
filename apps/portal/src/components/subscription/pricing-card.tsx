"use client";

import { CalendarClock, Loader2, Sparkles, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PricingCardProps {
  plan: {
    id: string;
    name: string;
    description?: string | null;
    amount: number;
    currency: string;
    interval: string;
    features: string[];
    trial_days?: number;
    billing_model?: string;
  };
  onSubscribe: (planId: string) => void;
  isLoading?: boolean;
  isCurrentPlan?: boolean;
  /** Go-live date (tenants.subscription_billing_anchor) for upfront_monthly first-charge date. */
  billingAnchor?: string | null;
}

function formatPrice(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount / 100);
}

// "Upfront monthly" plans charge exactly one calendar month after the tenant's
// go-live date (billingAnchor); falls back to one month from today when unset.
function firstChargeLabel(anchor?: string | null) {
  const now = new Date();
  const base = anchor ? new Date(`${anchor}T00:00:00Z`) : now;
  const d = new Date(base);
  d.setUTCMonth(d.getUTCMonth() + 1);
  while (d.getTime() <= now.getTime()) {
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function PricingCard({ plan, onSubscribe, isLoading, isCurrentPlan, billingAnchor }: PricingCardProps) {
  const isUpfront = plan.billing_model === "upfront_monthly";
  const hasTrial = !isUpfront && plan.trial_days && plan.trial_days > 0;
  const firstCharge = firstChargeLabel(billingAnchor);

  return (
    <div className="w-full max-w-sm">
      <div
        className={`relative overflow-hidden rounded-2xl border bg-card shadow-lg transition-shadow hover:shadow-xl ${
          isCurrentPlan ? "border-green-500/50 ring-1 ring-green-500/20" : "border-border"
        }`}
      >
        {/* Decorative gradient top bar */}
        <div className="h-1.5 bg-gradient-to-r from-primary via-primary/80 to-primary/60" />

        {/* Trial badge */}
        {hasTrial && !isCurrentPlan && (
          <div className="absolute top-4 right-4">
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-500 ring-1 ring-amber-500/20">
              <Zap className="h-3 w-3" />
              {plan.trial_days}-day free trial
            </span>
          </div>
        )}

        {/* Upfront-monthly badge (no free trial) */}
        {isUpfront && !isCurrentPlan && (
          <div className="absolute top-4 right-4">
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary ring-1 ring-primary/20">
              <CalendarClock className="h-3 w-3" />
              First payment {firstCharge}
            </span>
          </div>
        )}

        <div className="p-8">
          {/* Plan name */}
          <div className="mb-6">
            <div className="inline-flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                <Sparkles className="h-4 w-4 text-primary" />
              </div>
              <h3 className="text-lg font-semibold">{plan.name}</h3>
            </div>
            {plan.description && (
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                {plan.description}
              </p>
            )}
          </div>

          {/* Price — when NOTHING is charged today (free trial or upfront-monthly),
              lead with "$0 today" so users aren't scared off by the full amount; the
              real recurring price + when it starts goes on the subline. A genuine
              charge-now plan (no trial, not upfront) still shows its real price. */}
          <div className="mb-8">
            {hasTrial || isUpfront ? (
              <>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold tracking-tight">
                    {formatPrice(0, plan.currency)}
                  </span>
                  <span className="text-sm text-muted-foreground font-medium">
                    today
                  </span>
                </div>
                {hasTrial ? (
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    then {formatPrice(plan.amount, plan.currency)}/{plan.interval} after your{" "}
                    {plan.trial_days}-day free trial
                  </p>
                ) : (
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    then {formatPrice(plan.amount, plan.currency)} on{" "}
                    <span className="font-medium text-foreground">{firstCharge}</span>, monthly after that
                  </p>
                )}
              </>
            ) : (
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-bold tracking-tight">
                  {formatPrice(plan.amount, plan.currency)}
                </span>
                <span className="text-sm text-muted-foreground font-medium">
                  /{plan.interval}
                </span>
              </div>
            )}
          </div>

          {/* CTA */}
          {isCurrentPlan ? (
            <Button disabled className="w-full" size="lg" variant="outline">
              Current Plan
            </Button>
          ) : (
            <Button
              onClick={() => onSubscribe(plan.id)}
              disabled={isLoading}
              className="w-full"
              size="lg"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Redirecting to checkout...
                </>
              ) : isUpfront ? (
                "Add Card to Continue"
              ) : hasTrial ? (
                <>
                  Start {plan.trial_days}-Day Free Trial
                </>
              ) : (
                "Subscribe Now"
              )}
            </Button>
          )}

          {/* Fine print */}
          {!isCurrentPlan && (
            <p className="mt-3 text-center text-[11px] text-muted-foreground">
              {isUpfront
                ? `Your card is saved now — first charge on ${firstCharge}. Cancel anytime.`
                : hasTrial
                ? "No charge until trial ends. Cancel anytime."
                : "Cancel anytime. No long-term contracts."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
