"use client";

/**
 * Free-trial countdown — "Free trial · 4 days left".
 *
 * A super admin can give new self-serve signups a free trial per plan (admin →
 * Signup Plans). The card is saved at signup and Stripe charges it the day
 * after the trial ends unless the operator cancels. This banner is the
 * countdown they were promised, and it states the charge and its date so
 * nothing on day 6 is a surprise.
 *
 * The v1 sidebar had a "Setup Mode · Nd left" chip; v2 dropped it, so on the v2
 * portal — where every self-serve signup lands — this is the only countdown.
 *
 * `isTrialing` already excludes a migrated, long-live operator whose UAE
 * subscription sits in a deferred-billing "trial" (see use-tenant-subscription).
 */

import { useMemo } from "react";
import { Gift } from "lucide-react";

import { useTenantSubscription } from "@/hooks/use-tenant-subscription";
import { fingerprint, type AppBanner } from "../banner-types";

function money(cents: number | null | undefined, currency: string | null | undefined): string | null {
  if (typeof cents !== "number") return null;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: (currency || "usd").toUpperCase(),
      minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(cents / 100);
  } catch {
    return null;
  }
}

function day(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function useTrialCountdownBanner(): AppBanner[] {
  const { subscription, isTrialing, trialDaysRemaining } = useTenantSubscription();

  return useMemo(() => {
    if (!isTrialing || !subscription?.trial_end) return [];

    const left = trialDaysRemaining;
    const leftText = left <= 0 ? "ends today" : `${left} ${left === 1 ? "day" : "days"} left`;
    const endsOn = day(subscription.trial_end);
    const price = money(subscription.amount, subscription.currency);
    const cancelling =
      !!subscription.cancel_at && new Date(subscription.cancel_at).getTime() > Date.now();

    const consequence = cancelling
      ? `Your plan is cancelled — access ends ${endsOn ?? "when the trial ends"} and you won't be charged.`
      : `Your card will be charged ${price ?? "your plan price"}${endsOn ? ` on ${endsOn}` : " when the trial ends"} unless you cancel before then.`;

    return [
      {
        id: "free-trial-countdown",
        // Quiet for most of the trial; louder in the last two days, when the
        // charge is close enough that someone deciding to leave needs to act.
        severity: left <= 2 ? "warning" : "info",
        scope: "app",
        icon: Gift,
        hideOnPathPrefix: ["/subscription"],
        title: (
          <>
            <span className="font-medium">Free trial · {leftText}.</span>{" "}
            <span>{consequence}</span>
          </>
        ),
        plainTitle: `Free trial, ${leftText}. ${consequence}`,
        action: { label: "Manage plan", href: "/subscription" },
        // One dismissal per day of the trial: closing it on day 2 brings it
        // back on day 3, so the countdown keeps counting.
        dismissal: { fingerprint: fingerprint("trial", subscription.trial_end.slice(0, 10), left) },
      },
    ];
  }, [isTrialing, trialDaysRemaining, subscription?.trial_end, subscription?.amount, subscription?.currency, subscription?.cancel_at]);
}
