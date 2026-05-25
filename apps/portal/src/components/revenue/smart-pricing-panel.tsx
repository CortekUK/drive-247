/**
 * SmartPricingPanel — Spec §8.5
 *
 * Embedded card on the vehicle detail page that shows:
 *   - Latest pending recommendation (with quick Apply)
 *   - Otherwise: latest applied + its measured outcome
 *   - Otherwise: a "no recommendation yet" empty state
 *
 * Hidden entirely when:
 *   - Revenue Optimiser is not enabled for the tenant
 *   - The tenant is not on a tier that has recommendations
 *   - The vehicle is not eligible (e.g. disposed) — caller is responsible
 */
"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Sparkles, TrendingUp, TrendingDown, Check, ArrowRight, BarChart3, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useRevenueOptimiserSettings } from "@/hooks/use-revenue-optimiser";
import { useFeatureAccess } from "@/hooks/use-feature-access";
import {
  useApplyRecommendation,
  type PricingRecommendation,
  type PricingOutcome,
} from "@/hooks/use-pricing-recommendations";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RecommendationDetailDrawer } from "./recommendation-detail-drawer";
import { ApplyRecommendationDialog } from "./apply-recommendation-dialog";
import {
  useDismissRecommendation,
  useSnoozeRecommendation,
  useRevertRecommendation,
} from "@/hooks/use-pricing-recommendations";
import { DismissRecommendationDialog } from "./dismiss-recommendation-dialog";

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

interface Props {
  vehicleId: string;
}

export function SmartPricingPanel({ vehicleId }: Props) {
  const { tenant } = useTenant();
  const settings = useRevenueOptimiserSettings();
  const access = useFeatureAccess("revenue_optimiser_recommendations");

  const enabled = !!tenant?.id && !!settings.data?.enabled && settings.data.mode === "recommendations" && access.canAccess;

  const recQuery = useQuery({
    queryKey: ["vehicle-smart-pricing", tenant?.id, vehicleId],
    enabled: enabled && !!vehicleId,
    queryFn: async () => {
      if (!tenant?.id) return { pending: null, applied: null, outcome: null };
      // Pending first (the operator-actionable thing)
      const { data: pendingRaw } = await supabase
        .from("pricing_recommendations")
        .select("*, vehicle:vehicles(reg, make, model, category)")
        .eq("tenant_id", tenant.id)
        .eq("vehicle_id", vehicleId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const pending = (pendingRaw as unknown as PricingRecommendation | null) ?? null;

      // Latest applied for context (and its outcome)
      const { data: appliedRaw } = await supabase
        .from("pricing_recommendations")
        .select("*, vehicle:vehicles(reg, make, model, category)")
        .eq("tenant_id", tenant.id)
        .eq("vehicle_id", vehicleId)
        .eq("status", "applied")
        .order("applied_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const applied = (appliedRaw as unknown as PricingRecommendation | null) ?? null;

      let outcome: PricingOutcome | null = null;
      if (applied) {
        const { data: outcomeRaw } = await supabase
          .from("pricing_recommendation_outcomes")
          .select("*")
          .eq("recommendation_id", applied.id)
          .maybeSingle();
        outcome = (outcomeRaw as PricingOutcome | null) ?? null;
      }
      return { pending, applied, outcome };
    },
  });

  const [detailRec, setDetailRec] = useState<PricingRecommendation | null>(null);
  const [applyRec, setApplyRec] = useState<PricingRecommendation | null>(null);
  const [dismissRec, setDismissRec] = useState<PricingRecommendation | null>(null);

  const applyMut = useApplyRecommendation();
  const dismissMut = useDismissRecommendation();
  const snoozeMut = useSnoozeRecommendation();
  const revertMut = useRevertRecommendation();

  const heading = useMemo(() => (
    <div className="flex items-center gap-2">
      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-100 text-indigo-700">
        <Sparkles className="h-3.5 w-3.5" />
      </div>
      <div>
        <h3 className="text-sm font-medium text-[#080812]">Smart pricing</h3>
        <p className="text-[11px] text-[#737373]">From Revenue Optimiser</p>
      </div>
    </div>
  ), []);

  if (!enabled) return null;

  if (recQuery.isLoading) {
    return (
      <Wrapper heading={heading}>
        <Skeleton className="h-16 w-full rounded-md" />
      </Wrapper>
    );
  }

  const { pending, applied, outcome } = recQuery.data ?? { pending: null, applied: null, outcome: null };

  // 1. Pending → primary actionable surface
  if (pending) {
    const diff = pending.recommended_price - pending.current_price;
    const pct = pending.current_price > 0 ? (diff / pending.current_price) * 100 : 0;
    const goingUp = diff > 0;
    return (
      <Wrapper heading={heading}>
        <div className="flex items-baseline gap-2 tabular-nums">
          <span className="text-xs text-[#737373] line-through">{fmtMoney(pending.current_price)}</span>
          <span className="text-2xl font-medium text-[#080812]">{fmtMoney(pending.recommended_price)}</span>
          <span className={`flex items-center gap-0.5 text-xs font-medium ${goingUp ? "text-emerald-600" : "text-red-600"}`}>
            {goingUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {goingUp ? "+" : ""}{pct.toFixed(1)}%
          </span>
        </div>
        {pending.ai_explanation && (
          <p className="mt-2 text-[12px] leading-relaxed text-[#404040]">{pending.ai_explanation}</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => setApplyRec(pending)}
            disabled={applyMut.isPending || dismissMut.isPending || snoozeMut.isPending}
            className="bg-[#0f172a] text-xs text-white hover:bg-[#0f172a]/90"
          >
            <Check className="mr-1 h-3.5 w-3.5" /> Apply
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDetailRec(pending)} className="text-xs">
            Details
          </Button>
          <Link
            href="/revenue"
            className="ml-auto inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline"
          >
            All recommendations <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        <RecommendationDetailDrawer
          open={!!detailRec}
          rec={detailRec}
          onClose={() => setDetailRec(null)}
          onApply={(r) => { setDetailRec(null); setApplyRec(r); }}
          onDismiss={(r) => { setDetailRec(null); setDismissRec(r); }}
          onSnooze={(r) => { setDetailRec(null); snoozeMut.mutate({ recommendationId: r.id, days: 7 }); }}
          onRevert={(r) => revertMut.mutate({ recommendationId: r.id })}
          isBusy={applyMut.isPending || dismissMut.isPending || snoozeMut.isPending}
        />
        <ApplyRecommendationDialog
          open={!!applyRec}
          rec={applyRec}
          onClose={() => setApplyRec(null)}
          onSubmit={(customPrice) => {
            if (!applyRec) return;
            applyMut.mutate(
              { recommendationId: applyRec.id, customPrice },
              { onSuccess: () => setApplyRec(null) },
            );
          }}
          isSubmitting={applyMut.isPending}
        />
        <DismissRecommendationDialog
          open={!!dismissRec}
          rec={dismissRec}
          onClose={() => setDismissRec(null)}
          onSubmit={(reason) => {
            if (!dismissRec) return;
            dismissMut.mutate(
              { recommendationId: dismissRec.id, reason },
              { onSuccess: () => setDismissRec(null) },
            );
          }}
          isSubmitting={dismissMut.isPending}
        />
      </Wrapper>
    );
  }

  // 2. Applied (with optional outcome)
  if (applied) {
    const stale = applied.applied_at
      ? Date.now() - new Date(applied.applied_at).getTime() > 14 * 86_400_000
      : false;
    return (
      <Wrapper heading={heading}>
        <div className="text-xs text-[#737373]">
          Applied {applied.applied_at ? new Date(applied.applied_at).toLocaleDateString() : ""}
          {applied.applied_source ? ` · via ${applied.applied_source}` : ""}
        </div>
        <div className="mt-1 flex items-baseline gap-2 tabular-nums">
          <span className="text-2xl font-medium text-[#080812]">
            {fmtMoney(applied.applied_price ?? applied.recommended_price)}
          </span>
          <span className="text-xs text-[#737373]">{applied.tier} rate</span>
        </div>

        {outcome ? (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-[#f1f5f9] bg-[#f8fafc] px-3 py-2">
            <BarChart3 className={`h-3.5 w-3.5 ${outcome.outcome === "positive" ? "text-emerald-600" : outcome.outcome === "negative" ? "text-red-600" : "text-amber-600"}`} />
            <div className="flex-1 text-xs">
              <span className="font-medium capitalize text-[#080812]">{outcome.outcome}</span> · Net 14d
              {" "}
              <span className={`tabular-nums font-medium ${(outcome.net_revenue_delta ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {(outcome.net_revenue_delta ?? 0) >= 0 ? "+" : ""}{fmtMoney(outcome.net_revenue_delta ?? 0)}
              </span>
            </div>
            <Link href="/revenue/outcomes" className="text-[10px] text-indigo-600 hover:underline">All outcomes</Link>
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-dashed border-[#f1f5f9] bg-[#fafafa] px-3 py-2 text-xs text-[#737373]">
            <Clock className="h-3.5 w-3.5" />
            {stale
              ? "Outcome will be measured by the daily cron next run."
              : "Outcome will be measured 14 days after apply."}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setDetailRec(applied)} className="text-xs">
            Details
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => revertMut.mutate({ recommendationId: applied.id })}
            disabled={revertMut.isPending}
            className="text-xs text-red-600 hover:bg-red-50 hover:text-red-700"
          >
            Revert price
          </Button>
        </div>

        <RecommendationDetailDrawer
          open={!!detailRec}
          rec={detailRec}
          onClose={() => setDetailRec(null)}
          onApply={() => undefined}
          onDismiss={() => undefined}
          onSnooze={() => undefined}
          onRevert={(r) => revertMut.mutate({ recommendationId: r.id })}
          isBusy={revertMut.isPending}
        />
      </Wrapper>
    );
  }

  // 3. Empty
  return (
    <Wrapper heading={heading}>
      <p className="text-xs text-[#737373]">
        No active recommendation for this vehicle. The next generate run happens
        daily at 07:00 UTC — once enough data is in place, a suggestion will
        appear here.
      </p>
    </Wrapper>
  );
}

function Wrapper({ heading, children }: { heading: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[#f1f5f9] bg-white p-4">
      <div className="mb-3">{heading}</div>
      {children}
    </div>
  );
}
