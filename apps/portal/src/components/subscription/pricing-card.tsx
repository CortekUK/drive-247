"use client";

import { CalendarClock, Loader2, Sparkles, Zap, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tile, StatusPill, Money } from "@/components/bento";

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
}

function formatPrice(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount / 100);
}

// "Upfront monthly" plans charge exactly one calendar month from today.
function firstChargeLabel() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function PricingCard({ plan, onSubscribe, isLoading, isCurrentPlan }: PricingCardProps) {
  const isUpfront = plan.billing_model === "upfront_monthly";
  const hasTrial = !isUpfront && plan.trial_days && plan.trial_days > 0;
  const firstCharge = firstChargeLabel();

  return (
    <div className="w-full max-w-sm">
      <Tile
        pad="none"
        className={`relative overflow-hidden ${
          isCurrentPlan
            ? "[border-color:var(--bento-success)] ring-1 ring-[color:var(--bento-success)]/30"
            : ""
        }`}
      >
        {/* Trial badge */}
        {hasTrial && !isCurrentPlan && (
          <div className="absolute top-4 right-4">
            <StatusPill tone="warn">
              <Zap className="h-3 w-3" />
              {plan.trial_days}-day free trial
            </StatusPill>
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
              <div className="flex h-8 w-8 items-center justify-center rounded-tile-sm [background:var(--bento-primary-weak)]">
                <Sparkles className="h-4 w-4 text-[color:var(--bento-primary-weak-fg)]" />
              </div>
              <h3 className="text-lg font-bold tracking-tight">{plan.name}</h3>
            </div>
            {plan.description && (
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                {plan.description}
              </p>
            )}
          </div>

          {/* Price */}
          <div className="mb-8">
            <div className="flex items-baseline gap-1">
              <Money className="text-4xl font-extrabold tracking-tight">
                {formatPrice(plan.amount, plan.currency)}
              </Money>
              <span className="text-sm text-muted-foreground font-medium">
                /{plan.interval}
              </span>
            </div>
            {hasTrial && (
              <p className="mt-1.5 text-sm text-muted-foreground">
                Free for {plan.trial_days} days, then{" "}
                {formatPrice(plan.amount, plan.currency)}/{plan.interval}
              </p>
            )}
            {isUpfront && (
              <p className="mt-1.5 text-sm text-muted-foreground">
                Add your card today — first payment of{" "}
                {formatPrice(plan.amount, plan.currency)} on{" "}
                <span className="font-medium text-foreground">{firstCharge}</span>, then monthly.
              </p>
            )}
          </div>

          {/* Features */}
          {plan.features && plan.features.length > 0 && (
            <ul className="mb-8 space-y-2.5">
              {plan.features.map((feature, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--bento-success)]" />
                  <span className="text-muted-foreground">{feature}</span>
                </li>
              ))}
            </ul>
          )}

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
      </Tile>
    </div>
  );
}
