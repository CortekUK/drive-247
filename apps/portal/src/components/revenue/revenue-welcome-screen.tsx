/**
 * RevenueWelcomeScreen — first-time view per Spec §8.1.
 *
 * "Revenue Optimiser learns from your fleet's history to suggest the best price
 * for each vehicle. Before we recommend anything, let's look at your last 6 months."
 * → Big [Run Backtest] CTA → kicks off the backtest engine.
 */
"use client";

import { Loader2, PlayCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  onRunBacktest: () => void;
  isRunning: boolean;
  vehicleCount: number | undefined;
}

export function RevenueWelcomeScreen({ onRunBacktest, isRunning, vehicleCount }: Props) {
  const hasVehicles = vehicleCount === undefined || vehicleCount > 0;

  return (
    <main className="mx-auto w-full max-w-[860px] px-6 py-12">
      <header className="mb-8">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-indigo-600">
          Drive247 · Revenue Optimiser
        </div>
        <h1 className="mt-1 text-[32px] font-medium text-[#080812]">
          Price each vehicle based on your fleet&apos;s demand, not guesses.
        </h1>
        <p className="mt-3 text-sm text-[#737373]">
          Before we recommend anything, let&apos;s look at your last 6 months and show you
          what you would have earned with smart pricing — on your own data.
        </p>
      </header>

      <section className="rounded-xl border border-[#f1f5f9] bg-white p-8">
        <h2 className="text-base font-medium text-[#080812]">Run your free backtest</h2>
        <p className="mt-1 text-sm text-[#737373]">
          We replay every rental you completed in the last 180 days against what our pricing
          engine would have recommended. Takes about 30 seconds. <span className="font-medium text-[#404040]">No changes will be made.</span>
        </p>

        {!hasVehicles && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>You don&apos;t have any active vehicles yet. Add vehicles before running the backtest — the engine needs your fleet&apos;s history to model demand.</div>
          </div>
        )}

        <div className="mt-5">
          <Button size="lg" onClick={onRunBacktest} disabled={isRunning || !hasVehicles}>
            {isRunning ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Running backtest…</>
            ) : (
              <><PlayCircle className="mr-2 h-4 w-4" /> Run Backtest</>
            )}
          </Button>
          {isRunning && (
            <p className="mt-2 text-xs text-[#737373]">
              Loading your bookings · modelling demand · calculating projected lift…
            </p>
          )}
        </div>
      </section>

      <section className="mt-8 rounded-xl border border-[#f1f5f9] bg-[#f8fafc] p-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[#737373]">How it works</h2>
        <ol className="mt-3 space-y-2 text-sm text-[#404040]">
          <li><span className="font-medium">1.</span> We analyse your last 6 months of bookings and enquiries.</li>
          <li><span className="font-medium">2.</span> We model what we would have recommended for each vehicle, each week.</li>
          <li><span className="font-medium">3.</span> You see the projected lift — on your own data, not industry averages.</li>
          <li><span className="font-medium">4.</span> You decide whether to enable Insights (observation only) or Recommendations.</li>
        </ol>
      </section>
    </main>
  );
}
