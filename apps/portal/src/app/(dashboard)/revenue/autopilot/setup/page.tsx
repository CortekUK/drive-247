/**
 * /revenue/autopilot/setup — Phase 3 onboarding wizard.
 */
"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AutopilotSetupWizard } from "@/components/revenue/autopilot-setup-wizard";
import { FeaturePaywall } from "@/components/revenue/feature-paywall";
import { useFeatureAccess } from "@/hooks/use-feature-access";

export default function AutopilotSetupPage() {
  const access = useFeatureAccess("revenue_optimiser_autopilot");

  if (access.isLoading) {
    return <main className="mx-auto max-w-[960px] px-6 py-10 text-sm text-[#737373]">Loading…</main>;
  }
  if (!access.canAccess) {
    return (
      <FeaturePaywall
        requiredTierLabel={access.requiredTierLabel}
        featureLabel="Autopilot"
        currentPlanName={access.planName}
      />
    );
  }

  return (
    <main className="mx-auto w-full max-w-[820px] px-6 py-8">
      <Link href="/revenue" className="mb-2 inline-flex items-center gap-1 text-xs text-[#737373] hover:text-indigo-600">
        <ArrowLeft className="h-3 w-3" /> Back to Revenue Optimiser
      </Link>
      <header className="mb-6">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-indigo-600">Revenue Optimiser</div>
        <h1 className="mt-1 text-[28px] font-medium text-[#080812]">Enable Autopilot</h1>
        <p className="mt-1 text-sm text-[#737373]">
          Autopilot applies recommendations automatically within the rules you&apos;ve set.
          You stay in control via per-rule bounds, the approval threshold, and the auto-pause circuit-breaker.
        </p>
      </header>

      <AutopilotSetupWizard />
    </main>
  );
}
