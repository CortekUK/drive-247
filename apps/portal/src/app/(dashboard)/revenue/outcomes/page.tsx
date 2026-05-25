/**
 * /revenue/outcomes — Spec §8.7
 *
 * Shows the OutcomeTracker for the past 90 days (with a quick day-window switcher).
 * Gated by the same Recommendations feature flag — without it, this page is paywalled.
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { OutcomeTracker } from "@/components/revenue/outcome-tracker";
import { FeaturePaywall } from "@/components/revenue/feature-paywall";
import { useFeatureAccess } from "@/hooks/use-feature-access";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export default function OutcomesPage() {
  const access = useFeatureAccess("revenue_optimiser_recommendations");
  const [days, setDays] = useState<number>(90);

  if (access.isLoading) {
    return <main className="mx-auto max-w-[960px] px-6 py-10 text-sm text-[#737373]">Loading…</main>;
  }
  if (!access.canAccess) {
    return (
      <FeaturePaywall
        requiredTierLabel={access.requiredTierLabel}
        featureLabel="Outcome tracking"
        currentPlanName={access.planName}
      />
    );
  }

  return (
    <main className="mx-auto w-full max-w-[1100px] px-6 py-8">
      <Link href="/revenue" className="mb-2 inline-flex items-center gap-1 text-xs text-[#737373] hover:text-indigo-600">
        <ArrowLeft className="h-3 w-3" /> Back to recommendations
      </Link>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-indigo-600">
            Revenue Optimiser
          </div>
          <h1 className="mt-1 text-[28px] font-medium text-[#080812]">Outcomes</h1>
          <p className="mt-1 text-sm text-[#737373]">
            Measured impact of every applied recommendation, 14 days after apply.
          </p>
        </div>
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="h-8 w-[140px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="60">Last 60 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
            <SelectItem value="180">Last 6 months</SelectItem>
          </SelectContent>
        </Select>
      </header>

      <OutcomeTracker days={days} />
    </main>
  );
}
