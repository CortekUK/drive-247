/**
 * /revenue/settings — Spec §8.6
 *
 * Settings surface (mode, safety rails, notifications). Available to anyone
 * with Insights access — mode/safety/notification differences are presented
 * inside the component, gated by feature access.
 */
"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { RevenueOptimiserSettings } from "@/components/revenue/revenue-optimiser-settings";
import { FeaturePaywall } from "@/components/revenue/feature-paywall";
import { useFeatureAccess } from "@/hooks/use-feature-access";

export default function RevenueOptimiserSettingsPage() {
  const access = useFeatureAccess("revenue_optimiser_insights");

  if (access.isLoading) {
    return <main className="mx-auto max-w-[960px] px-6 py-10 text-sm text-[#737373]">Loading…</main>;
  }
  if (!access.canAccess) {
    return (
      <FeaturePaywall
        requiredTierLabel={access.requiredTierLabel}
        featureLabel="Revenue Optimiser settings"
        currentPlanName={access.planName}
      />
    );
  }

  return (
    <main className="mx-auto w-full max-w-[1100px] px-6 py-8">
      <Link href="/revenue" className="mb-2 inline-flex items-center gap-1 text-xs text-[#737373] hover:text-indigo-600">
        <ArrowLeft className="h-3 w-3" /> Back to Revenue Optimiser
      </Link>
      <header className="mb-8">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-indigo-600">
          Revenue Optimiser
        </div>
        <h1 className="mt-1 text-[28px] font-medium text-[#080812]">Settings</h1>
        <p className="mt-1 text-sm text-[#737373]">
          Mode, safety rails, cost floors, and notification preferences.
        </p>
      </header>

      <RevenueOptimiserSettings />
    </main>
  );
}
