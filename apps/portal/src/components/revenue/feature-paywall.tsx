/**
 * FeaturePaywall — shown when the tenant's subscription tier doesn't support
 * the requested Revenue Optimiser feature.
 */
"use client";

import Link from "next/link";
import { Lock, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  requiredTierLabel: string;   // "Pro" | "Growth"
  featureLabel: string;        // "Insights" | "Recommendations" | "Autopilot"
  currentPlanName: string | null;
}

export function FeaturePaywall({ requiredTierLabel, featureLabel, currentPlanName }: Props) {
  return (
    <main className="mx-auto w-full max-w-[760px] px-6 py-16">
      <div className="rounded-xl border border-[#f1f5f9] bg-white p-10 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50">
          <Lock className="h-6 w-6 text-indigo-600" />
        </div>
        <h1 className="mt-4 text-2xl font-semibold text-[#080812]">
          Revenue Optimiser — {featureLabel} requires the {requiredTierLabel} tier
        </h1>
        <p className="mt-3 text-sm text-[#737373]">
          {currentPlanName
            ? <>You&apos;re currently on <span className="font-medium">{currentPlanName}</span>. Upgrade to {requiredTierLabel} to unlock {featureLabel.toLowerCase()}.</>
            : <>You need an active {requiredTierLabel} subscription to access {featureLabel.toLowerCase()}.</>}
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button asChild>
            <Link href="/subscription">
              View plans <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
