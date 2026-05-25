/**
 * /revenue — Revenue Optimiser landing page (Spec §6 Journey A, Phase 1).
 *
 * State machine (top→bottom):
 *   1. Subscription gate         → FeaturePaywall (Pro+ required for Insights)
 *   2. Not enabled, no backtest  → WelcomeScreen with Run Backtest CTA
 *   3. Not enabled, has backtest → BacktestReportView + Enable CTAs
 *   4. Enabled (any mode)        → CalibrationBanner + InsightsList + latest backtest summary
 */
"use client";

import { useEffect, useState } from "react";
import { useFeatureAccess } from "@/hooks/use-feature-access";
import {
  useRevenueOptimiserSettings,
  useLatestBacktest,
  useRunBacktest,
  useToggleRevenueOptimiserMode,
  useRevenueOptimiserInsights,
} from "@/hooks/use-revenue-optimiser";
import { useTenant } from "@/contexts/TenantContext";
import { supabase } from "@/integrations/supabase/client";
import { FeaturePaywall } from "@/components/revenue/feature-paywall";
import { RevenueWelcomeScreen } from "@/components/revenue/revenue-welcome-screen";
import { BacktestReportView } from "@/components/revenue/backtest-report-view";
import { InsightsList, CalibrationBanner } from "@/components/revenue/insights-list";
import { RecommendationsList } from "@/components/revenue/recommendations-list";
import { Button } from "@/components/ui/button";
import { RefreshCw, Loader2, Settings as SettingsIcon, BarChart3 } from "lucide-react";
import Link from "next/link";

export default function RevenueOptimiserPage() {
  // Tier gate
  const insightsAccess = useFeatureAccess("revenue_optimiser_insights");
  const recommendationsAccess = useFeatureAccess("revenue_optimiser_recommendations");

  // Data
  const settings = useRevenueOptimiserSettings();
  const latestBacktest = useLatestBacktest();
  const insights = useRevenueOptimiserInsights({ days: 14 });

  // Lightweight vehicle count for the welcome screen empty-state. Portal has
  // no shared useVehicles hook so we query inline once per mount.
  const { tenant } = useTenant();
  const [vehicleCount, setVehicleCount] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!tenant?.id) return;
    let cancelled = false;
    supabase
      .from("vehicles")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .not("is_disposed", "is", true)
      .then(({ count }) => { if (!cancelled) setVehicleCount(count ?? 0); });
    return () => { cancelled = true; };
  }, [tenant?.id]);

  // Mutations
  const runBacktest = useRunBacktest();
  const toggleMode = useToggleRevenueOptimiserMode();

  // Loading guard
  if (insightsAccess.isLoading || settings.isLoading || latestBacktest.isLoading) {
    return <main className="mx-auto max-w-[960px] px-6 py-10 text-sm text-[#737373]">Loading Revenue Optimiser…</main>;
  }

  // 1. Tier gate
  if (!insightsAccess.canAccess) {
    return (
      <FeaturePaywall
        requiredTierLabel={insightsAccess.requiredTierLabel}
        featureLabel="Insights"
        currentPlanName={insightsAccess.planName}
      />
    );
  }

  const isEnabled = settings.data?.enabled === true;
  const mode = settings.data?.mode ?? "observation";
  const hasBacktest = !!latestBacktest.data;

  // 2. Not enabled, no backtest → Welcome
  if (!isEnabled && !hasBacktest) {
    return (
      <RevenueWelcomeScreen
        onRunBacktest={() => runBacktest.mutate()}
        isRunning={runBacktest.isPending}
        vehicleCount={vehicleCount}
      />
    );
  }

  // 3. Backtest exists → Show it + Enable CTAs (when not enabled) or status (when enabled)
  if (latestBacktest.data && !isEnabled) {
    return (
      <BacktestReportView
        report={latestBacktest.data}
        canAccessRecommendations={recommendationsAccess.canAccess}
        recommendationsRequiredTier={recommendationsAccess.requiredTierLabel}
        isToggling={toggleMode.isPending}
        isRunningBacktest={runBacktest.isPending}
        onEnableInsights={() => toggleMode.mutate("observation")}
        onEnableRecommendations={() => toggleMode.mutate("recommendations")}
        onRerunBacktest={() => runBacktest.mutate()}
        currentMode={mode}
        isEnabled={false}
      />
    );
  }

  // 4. Enabled — branch on mode
  const inRecommendationsMode = mode === "recommendations" || mode === "autopilot";

  return (
    <main className="mx-auto w-full max-w-[1100px] px-6 py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-indigo-600">
            Revenue Optimiser
          </div>
          <h1 className="mt-1 text-[28px] font-medium text-[#080812]">
            {inRecommendationsMode ? "Recommendations" : "Insights"} · <span className="capitalize">{mode}</span> mode
          </h1>
          <p className="mt-1 text-sm text-[#737373]">
            {inRecommendationsMode
              ? `Daily per-vehicle price suggestions across ${vehicleCount ?? "—"} vehicles.`
              : `Daily observations from your fleet, computed from ${vehicleCount ?? "—"} vehicles.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {inRecommendationsMode && (
            <>
              <Button asChild size="sm" variant="outline">
                <Link href="/revenue/outcomes"><BarChart3 className="mr-1.5 h-3.5 w-3.5" /> Outcomes</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/revenue/rules">Rules</Link>
              </Button>
              {mode !== "autopilot" && recommendationsAccess.canAccess && settings.data?.calibration_complete && (
                <Button asChild size="sm" variant="outline">
                  <Link href="/revenue/autopilot/setup">Enable Autopilot</Link>
                </Button>
              )}
              <Button asChild size="sm" variant="outline">
                <Link href="/revenue/settings"><SettingsIcon className="mr-1.5 h-3.5 w-3.5" /> Settings</Link>
              </Button>
            </>
          )}
          <Button size="sm" variant="outline" onClick={() => runBacktest.mutate()} disabled={runBacktest.isPending}>
            {runBacktest.isPending
              ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Re-running…</>
              : <><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Re-run backtest</>}
          </Button>
        </div>
      </header>

      {inRecommendationsMode ? (
        <div className="space-y-4">
          {!settings.data?.calibration_complete && (
            <CalibrationBanner
              calibrationStartedAt={settings.data?.calibration_started_at ?? null}
              calibrationComplete={settings.data?.calibration_complete ?? false}
              canAccessRecommendations={recommendationsAccess.canAccess}
              recommendationsRequiredTier={recommendationsAccess.requiredTierLabel}
            />
          )}
          <RecommendationsList />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <CalibrationBanner
              calibrationStartedAt={settings.data?.calibration_started_at ?? null}
              calibrationComplete={settings.data?.calibration_complete ?? false}
              canAccessRecommendations={recommendationsAccess.canAccess}
              recommendationsRequiredTier={recommendationsAccess.requiredTierLabel}
            />
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#737373]">Recent observations</h2>
              <InsightsList insights={insights.data ?? []} isLoading={insights.isLoading} />
            </section>
          </div>

          <aside className="space-y-4">
            {latestBacktest.data && (
              <div className="rounded-lg border border-[#f1f5f9] bg-white p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[#737373]">Latest backtest</h3>
                <div className="mt-2 text-2xl font-medium text-emerald-600 tabular-nums">
                  +{latestBacktest.data.uplift_percent}%
                </div>
                <div className="text-xs text-[#737373]">
                  ${latestBacktest.data.uplift_amount.toLocaleString()} projected lift
                </div>
                <div className="mt-2 text-[10px] text-[#737373]">
                  {latestBacktest.data.period_start} → {latestBacktest.data.period_end}
                  <br />
                  {latestBacktest.data.vehicles_analysed} vehicles · {latestBacktest.data.bookings_analysed} bookings
                  <br />
                  Confidence: <span className="capitalize">{latestBacktest.data.confidence}</span>
                </div>
              </div>
            )}
            <div className="rounded-lg border border-[#f1f5f9] bg-[#f8fafc] p-4 text-xs text-[#737373]">
              <p className="font-medium text-[#404040]">About Insights mode</p>
              <p className="mt-1">
                We&apos;re collecting data and surfacing patterns. No prices are being changed
                by the system. After your 30-day calibration period, you can switch to
                Recommendations Mode.
              </p>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
