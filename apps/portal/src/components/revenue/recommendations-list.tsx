/**
 * RecommendationsList — Spec §8.3
 *
 * The primary surface in Recommendations Mode. Renders sorted/filtered
 * RecommendationCards, owns the detail drawer, dismiss-with-reason dialog,
 * and apply-with-custom-price dialog.
 *
 * State machine: list ←→ drawer (Details) ←→ apply dialog (custom price)
 *                     ←→ dismiss dialog (reason)
 */
"use client";

import { useMemo, useState } from "react";
import { Filter, SlidersHorizontal, Sparkles } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RecommendationCard } from "./recommendation-card";
import { CombinedRecommendationCard } from "./combined-recommendation-card";
import { OfferPreviewDialog } from "./offer-preview-dialog";
import { RecommendationDetailDrawer } from "./recommendation-detail-drawer";
import { ApplyRecommendationDialog } from "./apply-recommendation-dialog";
import { DismissRecommendationDialog } from "./dismiss-recommendation-dialog";
import {
  type PricingRecommendation,
  type RecommendationFilters,
  usePricingRecommendations,
  useApplyRecommendation,
  useDismissRecommendation,
  useSnoozeRecommendation,
  useRevertRecommendation,
} from "@/hooks/use-pricing-recommendations";
import { useSendRecommendationOffers, type MatchedLeadRow } from "@/hooks/use-recommendation-offers";

type SortKey = NonNullable<RecommendationFilters["sort"]>;
type DirectionFilter = "all" | "up" | "down";
type ConfidenceFilter = "all" | "low" | "medium" | "high";

interface Props {
  /** Show this banner when zero recs are present (e.g. cron hasn't run yet) */
  emptyHint?: string;
}

export function RecommendationsList({ emptyHint }: Props) {
  const [sort, setSort] = useState<SortKey>("impact");
  const [direction, setDirection] = useState<DirectionFilter>("all");
  const [confidence, setConfidence] = useState<ConfidenceFilter>("all");

  const [detailRec, setDetailRec] = useState<PricingRecommendation | null>(null);
  const [applyRec, setApplyRec] = useState<PricingRecommendation | null>(null);
  const [dismissRec, setDismissRec] = useState<PricingRecommendation | null>(null);
  const [offerCtx, setOfferCtx] = useState<{ rec: PricingRecommendation; leads: MatchedLeadRow[]; alsoApplyPrice: boolean } | null>(null);

  const recsQuery = usePricingRecommendations({ status: "pending", sort, limit: 200 });
  const pendingApprovalQuery = usePricingRecommendations({ status: "pending_approval", sort: "impact", limit: 50 });
  const applyMut = useApplyRecommendation();
  const dismissMut = useDismissRecommendation();
  const snoozeMut = useSnoozeRecommendation();
  const revertMut = useRevertRecommendation();
  const sendOffersMut = useSendRecommendationOffers();

  const recs = recsQuery.data ?? [];
  const filtered = useMemo(() => {
    return recs.filter((r) => {
      if (direction === "up" && r.recommended_price <= r.current_price) return false;
      if (direction === "down" && r.recommended_price >= r.current_price) return false;
      if (confidence !== "all" && r.confidence !== confidence) return false;
      return true;
    });
  }, [recs, direction, confidence]);

  const totalProjected = useMemo(
    () => filtered.reduce((s, r) => s + Number(r.projected_revenue_delta_monthly ?? 0), 0),
    [filtered],
  );
  const isBusy = applyMut.isPending || dismissMut.isPending || snoozeMut.isPending;

  // ──────────────────────────────────────────────────────────────────────────
  // Loading + empty states
  // ──────────────────────────────────────────────────────────────────────────
  if (recsQuery.isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-44 w-full rounded-lg" />
        ))}
      </div>
    );
  }
  if (recsQuery.isError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Failed to load recommendations: {(recsQuery.error as Error).message}
      </div>
    );
  }
  if (recs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[#f1f5f9] bg-white p-10 text-center">
        <Sparkles className="mx-auto h-7 w-7 text-indigo-500" />
        <h3 className="mt-3 text-sm font-medium text-[#080812]">No pending recommendations</h3>
        <p className="mx-auto mt-1 max-w-md text-xs text-[#737373]">
          {emptyHint ?? "Revenue Optimiser runs every morning at 07:00 UTC. New recommendations will appear here once the next run completes — or after you apply a price change, that vehicle stays locked for 14 days."}
        </p>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Filtered-but-empty
  // ──────────────────────────────────────────────────────────────────────────
  const showFilters = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1.5 text-xs text-[#737373]">
        <SlidersHorizontal className="h-3.5 w-3.5" /> Sort
      </div>
      <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
        <SelectTrigger className="h-8 w-[140px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="impact">Biggest impact</SelectItem>
          <SelectItem value="newest">Newest</SelectItem>
          <SelectItem value="confidence">Highest confidence</SelectItem>
        </SelectContent>
      </Select>
      <div className="ml-3 flex items-center gap-1.5 text-xs text-[#737373]">
        <Filter className="h-3.5 w-3.5" /> Filter
      </div>
      <Select value={direction} onValueChange={(v) => setDirection(v as DirectionFilter)}>
        <SelectTrigger className="h-8 w-[120px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All changes</SelectItem>
          <SelectItem value="up">Increases</SelectItem>
          <SelectItem value="down">Decreases</SelectItem>
        </SelectContent>
      </Select>
      <Select value={confidence} onValueChange={(v) => setConfidence(v as ConfidenceFilter)}>
        <SelectTrigger className="h-8 w-[150px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All confidence</SelectItem>
          <SelectItem value="high">High only</SelectItem>
          <SelectItem value="medium">Medium+</SelectItem>
          <SelectItem value="low">Low only</SelectItem>
        </SelectContent>
      </Select>
      {(direction !== "all" || confidence !== "all") && (
        <Button
          size="sm"
          variant="ghost"
          className="h-8 text-xs text-[#737373]"
          onClick={() => { setDirection("all"); setConfidence("all"); }}
        >
          Clear
        </Button>
      )}
    </div>
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────────────────────────────
  const pendingApprovalRecs = pendingApprovalQuery.data ?? [];

  return (
    <div className="space-y-6">
      {/* Pending-approval section (Phase 3 — autopilot above the approval threshold) */}
      {pendingApprovalRecs.length > 0 && (
        <section className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/40 p-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-800">
              {pendingApprovalRecs.length} recommendation{pendingApprovalRecs.length === 1 ? "" : "s"} need your approval
            </h3>
            <span className="text-[10px] text-amber-800/80">
              Autopilot held these back because they exceed your approval threshold.
            </span>
          </div>
          <div className="space-y-2">
            {pendingApprovalRecs.map((rec) => (
              <RecommendationCard
                key={rec.id}
                rec={rec}
                onApply={(r) => setApplyRec(r)}
                onDetails={(r) => setDetailRec(r)}
                onDismiss={(r) => setDismissRec(r)}
                onSnooze={(r) => snoozeMut.mutate({ recommendationId: r.id, days: 7 })}
                isBusy={isBusy}
              />
            ))}
          </div>
        </section>
      )}

      {/* Filter bar + summary */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {showFilters}
        <div className="text-xs text-[#737373]">
          <span className="font-medium text-[#080812]">{filtered.length}</span> of {recs.length} ·
          {" "}<span className="font-medium text-emerald-600">
            {totalProjected >= 0 ? "+" : ""}${Math.round(totalProjected).toLocaleString()}/mo
          </span>{" "}potential
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#f1f5f9] bg-white p-8 text-center text-sm text-[#737373]">
          No recommendations match these filters.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((rec) =>
            rec.is_combined ? (
              <CombinedRecommendationCard
                key={rec.id}
                rec={rec}
                onApplyOnly={(r) => setApplyRec(r)}
                onSendOnly={(r, leads) => setOfferCtx({ rec: r, leads, alsoApplyPrice: false })}
                onApplyAndSend={(r, leads) => setOfferCtx({ rec: r, leads, alsoApplyPrice: true })}
                onDetails={(r) => setDetailRec(r)}
                onDismiss={(r) => setDismissRec(r)}
                onSnooze={(r) => snoozeMut.mutate({ recommendationId: r.id, days: 7 })}
                isBusy={isBusy || sendOffersMut.isPending}
              />
            ) : (
              <RecommendationCard
                key={rec.id}
                rec={rec}
                onApply={(r) => setApplyRec(r)}
                onDetails={(r) => setDetailRec(r)}
                onDismiss={(r) => setDismissRec(r)}
                onSnooze={(r) => snoozeMut.mutate({ recommendationId: r.id, days: 7 })}
                isBusy={isBusy}
              />
            ),
          )}
        </div>
      )}

      <OfferPreviewDialog
        open={!!offerCtx}
        rec={offerCtx?.rec ?? null}
        matchedLeads={offerCtx?.leads ?? []}
        alsoApplyPrice={offerCtx?.alsoApplyPrice ?? false}
        onClose={() => setOfferCtx(null)}
        isSubmitting={sendOffersMut.isPending || applyMut.isPending}
        onSubmit={async ({ leadIds, messageBody, channel }) => {
          if (!offerCtx) return;
          // Optionally apply price first; if it fails, surface the error and abort.
          if (offerCtx.alsoApplyPrice) {
            try {
              await applyMut.mutateAsync({ recommendationId: offerCtx.rec.id });
            } catch {
              return;
            }
          }
          await sendOffersMut.mutateAsync({
            recommendationId: offerCtx.rec.id,
            leadIds,
            messageBody,
            channel,
          });
          setOfferCtx(null);
        }}
      />

      <RecommendationDetailDrawer
        open={!!detailRec}
        rec={detailRec}
        onClose={() => setDetailRec(null)}
        onApply={(r) => { setDetailRec(null); setApplyRec(r); }}
        onDismiss={(r) => { setDetailRec(null); setDismissRec(r); }}
        onSnooze={(r) => { setDetailRec(null); snoozeMut.mutate({ recommendationId: r.id, days: 7 }); }}
        onRevert={(r) => revertMut.mutate({ recommendationId: r.id })}
        isBusy={isBusy}
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
    </div>
  );
}
