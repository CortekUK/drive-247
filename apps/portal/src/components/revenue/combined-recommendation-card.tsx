/**
 * CombinedRecommendationCard — Spec §6 Journey C (Phase 4).
 *
 * Renders a price-drop rec along with the matching leads + 3 actions:
 *   - Apply price + send offers  (default)
 *   - Apply price only           (skip the leads)
 *   - Send offers only           (keep the current price)
 *
 * Click any of the first two leads to see the offer-preview dialog which lets
 * the operator edit the message body before dispatch.
 */
"use client";

import { useMemo, useState } from "react";
import { TrendingDown, Sparkles, Inbox, Send, Check, X, MoreHorizontal, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import type { PricingRecommendation } from "@/hooks/use-pricing-recommendations";
import { useMatchedLeads, type MatchedLeadRow } from "@/hooks/use-recommendation-offers";

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

interface Props {
  rec: PricingRecommendation;
  onApplyOnly: (rec: PricingRecommendation) => void;
  onSendOnly: (rec: PricingRecommendation, leads: MatchedLeadRow[]) => void;
  onApplyAndSend: (rec: PricingRecommendation, leads: MatchedLeadRow[]) => void;
  onDetails: (rec: PricingRecommendation) => void;
  onDismiss: (rec: PricingRecommendation) => void;
  onSnooze: (rec: PricingRecommendation) => void;
  isBusy?: boolean;
}

export function CombinedRecommendationCard({
  rec, onApplyOnly, onSendOnly, onApplyAndSend, onDetails, onDismiss, onSnooze, isBusy,
}: Props) {
  const leadsQuery = useMatchedLeads(rec.matched_lead_ids);
  const leads = leadsQuery.data ?? [];
  const v = rec.vehicle;
  const title = [v?.make, v?.model].filter(Boolean).join(" ") || "Vehicle";

  const diff = rec.current_price - rec.recommended_price;
  const pct = rec.current_price > 0 ? (diff / rec.current_price) * 100 : 0;

  const idleDays = useMemo(() => {
    const d = rec.data_points as { idle_days?: number | null };
    return d?.idle_days ?? null;
  }, [rec.data_points]);

  return (
    <article className="rounded-lg border-2 border-indigo-200 bg-gradient-to-br from-white to-indigo-50/30 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-indigo-300 bg-indigo-100 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-indigo-700">
              Combined
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-widest text-indigo-600">
              Price drop + activate leads
            </span>
            {v?.reg && (
              <span className="rounded-full border border-[#f1f5f9] bg-white px-2 py-0.5 text-[10px] text-[#404040]">
                {v.reg}
              </span>
            )}
          </div>
          <h3 className="mt-1 truncate text-base font-medium text-[#080812]">{title}</h3>
          <div className="mt-2 flex items-baseline gap-2 tabular-nums">
            <span className="text-sm text-[#737373] line-through">{fmtMoney(rec.current_price)}</span>
            <span className="text-2xl font-medium text-[#080812]">{fmtMoney(rec.recommended_price)}</span>
            <span className="flex items-center gap-0.5 text-xs font-medium text-red-600">
              <TrendingDown className="h-3 w-3" /> −{pct.toFixed(1)}%
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#737373]">
            <span>Saves customers {fmtMoney(diff)}/week</span>
            {idleDays !== null && <span>· Idle {idleDays}d</span>}
            {rec.projected_revenue_delta_monthly !== null && (
              <span>· Projected{" "}
                <span className={rec.projected_revenue_delta_monthly >= 0 ? "text-emerald-700 font-medium" : "text-red-700 font-medium"}>
                  {rec.projected_revenue_delta_monthly >= 0 ? "+" : ""}{fmtMoney(rec.projected_revenue_delta_monthly)}/mo
                </span>
              </span>
            )}
          </div>
        </div>
      </div>

      {rec.ai_explanation && (
        <div className="mt-3 rounded-md border border-indigo-100 bg-white p-3">
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-500" />
            <p className="text-[13px] leading-relaxed text-[#404040]">{rec.ai_explanation}</p>
          </div>
        </div>
      )}

      {/* Matched leads */}
      <div className="mt-4 rounded-md border border-indigo-100 bg-white">
        <div className="flex items-center gap-2 border-b border-indigo-100 px-3 py-2">
          <Inbox className="h-3.5 w-3.5 text-indigo-600" />
          <span className="text-xs font-medium text-[#080812]">
            {leadsQuery.isLoading ? "Loading matching leads…" : `${leads.length} matching lead${leads.length === 1 ? "" : "s"}`}
          </span>
        </div>
        <ul className="divide-y divide-indigo-50 max-h-56 overflow-y-auto">
          {leadsQuery.isLoading
            ? [0, 1, 2].map((i) => (
                <li key={i} className="px-3 py-2">
                  <Skeleton className="h-8 w-full" />
                </li>
              ))
            : leads.slice(0, 4).map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-[#080812]">{l.full_name ?? "(no name)"}</div>
                    <div className="truncate text-[11px] text-[#737373]">
                      {l.start_date ? `Wants ${l.start_date}${l.end_date ? ` → ${l.end_date}` : ""}` : "Flexible dates"}
                      {" · "}{stageLabel(l.stage)}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-[10px] text-[#737373]">
                    {l.phone ? <span className="block">SMS</span> : null}
                    {l.email ? <span className="block">Email</span> : null}
                    {!l.phone && !l.email ? <span className="text-amber-700">No contact</span> : null}
                  </div>
                </li>
              ))}
          {leads.length > 4 && (
            <li className="px-3 py-2 text-[11px] text-[#737373]">+ {leads.length - 4} more</li>
          )}
        </ul>
      </div>

      {/* Actions */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onDetails(rec)}
          disabled={isBusy}
          className="text-xs"
        >
          Details
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0" disabled={isBusy} aria-label="More actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onSelect={() => onSnooze(rec)}>
                <Clock className="mr-2 h-3.5 w-3.5" /> Snooze 7 days
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onDismiss(rec)} className="text-red-600 focus:text-red-700">
                <X className="mr-2 h-3.5 w-3.5" /> Dismiss
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onSendOnly(rec, leads)}
            disabled={isBusy || leads.length === 0}
            className="text-xs"
          >
            <Send className="mr-1 h-3.5 w-3.5" /> Send offers only
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onApplyOnly(rec)}
            disabled={isBusy}
            className="text-xs"
          >
            <Check className="mr-1 h-3.5 w-3.5" /> Apply price only
          </Button>
          <Button
            size="sm"
            onClick={() => onApplyAndSend(rec, leads)}
            disabled={isBusy || leads.length === 0}
            className="bg-[#0f172a] text-xs text-white hover:bg-[#0f172a]/90"
          >
            <Check className="mr-1 h-3.5 w-3.5" /> Apply + send offers
          </Button>
        </div>
      </div>
    </article>
  );
}

function stageLabel(stage: string): string {
  switch (stage) {
    case "new": return "New lead";
    case "contacted": return "Contacted";
    case "vehicle_offered": return "Offer made";
    default: return stage;
  }
}
