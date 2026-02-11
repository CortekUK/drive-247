"use client";

import { Check, Loader2, Sparkles, Zap } from "lucide-react";
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

export function PricingCard({ plan, onSubscribe, isLoading, isCurrentPlan }: PricingCardProps) {
  const hasTrial = plan.trial_days && plan.trial_days > 0;

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

          {/* Price */}
          <div className="mb-8">
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-bold tracking-tight">
                {formatPrice(plan.amount, plan.currency)}
              </span>
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
          </div>

          {/* Features */}
          {plan.features.length > 0 && (
            <div className="mb-8">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                What's included
              </p>
              <ul className="space-y-2.5">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5">
                    <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/10">
                      <Check className="h-2.5 w-2.5 text-primary" strokeWidth={3} />
                    </div>
                    <span className="text-sm leading-snug">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
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
              {hasTrial
                ? "No charge until trial ends. Cancel anytime."
                : "Cancel anytime. No long-term contracts."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
