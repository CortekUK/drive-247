/**
 * /revenue/rules — Phase 3 rules editor (Spec §8.6 / §13).
 *
 * Gated by Recommendations feature access. Inside the page, per-row autopilot
 * toggling is allowed even without Autopilot feature access — the toggle is
 * inert until the tenant flips the mode to "autopilot" via /revenue/settings.
 */
"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { RulesEditor } from "@/components/revenue/rules-editor";
import { FeaturePaywall } from "@/components/revenue/feature-paywall";
import { useFeatureAccess } from "@/hooks/use-feature-access";

export default function RulesPage() {
  const access = useFeatureAccess("revenue_optimiser_recommendations");

  if (access.isLoading) {
    return <main className="mx-auto max-w-[960px] px-6 py-10 text-sm text-[#737373]">Loading…</main>;
  }
  if (!access.canAccess) {
    return (
      <FeaturePaywall
        requiredTierLabel={access.requiredTierLabel}
        featureLabel="Rules editor"
        currentPlanName={access.planName}
      />
    );
  }

  return (
    <main className="mx-auto w-full max-w-[1100px] px-6 py-8">
      <Link href="/revenue" className="mb-2 inline-flex items-center gap-1 text-xs text-[#737373] hover:text-indigo-600">
        <ArrowLeft className="h-3 w-3" /> Back to Revenue Optimiser
      </Link>
      <header className="mb-6">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-indigo-600">Revenue Optimiser</div>
        <h1 className="mt-1 text-[28px] font-medium text-[#080812]">Rules</h1>
        <p className="mt-1 text-sm text-[#737373]">
          Per-vehicle and per-category price bounds. Required before enabling Autopilot.
        </p>
      </header>

      <RulesEditor />
    </main>
  );
}
