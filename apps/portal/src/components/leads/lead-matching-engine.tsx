/**
 * LeadMatchingEngine — Spec Section 6.5 (Right column, Section 2).
 *
 * Renders ranked vehicle options for a lead with multi-select for the offer builder.
 */
"use client";

import { useState } from "react";
import { Loader2, Car, DollarSign, Calendar } from "lucide-react";
import { useMatchingEngine, type MatchOption } from "@/hooks/use-matching-engine";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const AVAILABILITY_HUES = {
  full: "text-emerald-600 bg-emerald-50",
  partial: "text-amber-600 bg-amber-50",
  unavailable: "text-red-600 bg-red-50",
};

const BUDGET_HUES = {
  under: "text-blue-600",
  within: "text-emerald-600",
  over: "text-red-600",
};

interface Props {
  leadId: string;
  lastActivityAt: string;
  onBuildOffer: (selectedVehicleIds: string[]) => void;
}

export function LeadMatchingEngine({ leadId, lastActivityAt, onBuildOffer }: Props) {
  const { data, isLoading, error } = useMatchingEngine(leadId, lastActivityAt);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (vehicleId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(vehicleId)) next.delete(vehicleId);
      else next.add(vehicleId);
      return next;
    });

  const buildOffer = () => onBuildOffer(Array.from(selected));

  return (
    <section className="rounded-md border border-[#f1f5f9] bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[#737373]">Matching engine</h3>
        {selected.size > 0 && (
          <Button size="sm" onClick={buildOffer}>
            Create offer ({selected.size})
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-xs text-[#737373]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Finding matches…
        </div>
      )}

      {error && (
        <p className="text-xs text-red-600">Failed to run matching engine.</p>
      )}

      {data && data.options.length === 0 && !isLoading && (
        <p className="text-xs text-[#737373]">No vehicles match for the requested dates.</p>
      )}

      <ul className="space-y-2">
        {data?.options.map((opt, idx) => (
          <MatchOptionCard
            key={idx}
            option={opt}
            selected={selected}
            onToggle={toggle}
          />
        ))}
      </ul>
    </section>
  );
}

function MatchOptionCard({
  option,
  selected,
  onToggle,
}: {
  option: MatchOption;
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  const primary = option.vehicles[0];
  if (!primary) return null;
  const avail = AVAILABILITY_HUES[primary.available];
  const budget = BUDGET_HUES[option.budgetFit];
  const isStitched = option.kind === "stitched";

  // For stitched: checkbox state reflects ALL vehicles selected; toggle picks/unpicks all
  const allVehicleIds = option.vehicles.map((v) => v.vehicleId);
  const isFullySelected = isStitched
    ? allVehicleIds.every((id) => selected.has(id))
    : selected.has(primary.vehicleId);

  const handleToggle = () => {
    if (isStitched) {
      // Add all if not fully selected; remove all otherwise.
      if (isFullySelected) {
        allVehicleIds.forEach((id) => onToggle(id)); // each call toggles
      } else {
        // Add only the missing ones
        allVehicleIds.filter((id) => !selected.has(id)).forEach((id) => onToggle(id));
      }
    } else {
      onToggle(primary.vehicleId);
    }
  };

  return (
    <li className="rounded-md border border-[#f1f5f9] p-2.5 hover:border-indigo-200">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {/* Vehicle chain — for stitched, show all vehicles with handoff arrow */}
          {isStitched ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
                  STITCHED — {option.vehicles.length} vehicles
                </span>
                <span className="ml-auto text-xs font-medium text-indigo-700">
                  {option.matchScore}/100
                </span>
              </div>
              <ol className="space-y-1">
                {option.vehicles.map((v, idx) => (
                  <li key={`${v.vehicleId}-${idx}`} className="rounded border border-violet-100 bg-violet-50/40 p-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-[#080812]">
                      <span className="rounded-full bg-violet-200 px-1.5 text-[10px] font-bold text-violet-900">
                        {idx + 1}
                      </span>
                      <Car className="h-3 w-3 text-[#737373]" />
                      <span className="truncate">{v.name}</span>
                      <span className="ml-auto text-[10px] text-[#737373]">
                        {v.startDate.slice(5)} → {v.endDate.slice(5)}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-1.5 text-sm font-medium text-[#080812]">
                <Car className="h-3.5 w-3.5 text-[#737373]" />
                <span className="truncate">{primary.name}</span>
                {option.kind === "conditional" && (
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                    CONDITIONAL
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[#737373]">
                <span className={cn("rounded px-1.5 py-0.5", avail)}>{primary.available}</span>
                <span className="flex items-center gap-0.5">
                  <DollarSign className="h-3 w-3" />
                  <span className={budget}>${option.totalPrice}</span>
                </span>
                <span className="flex items-center gap-0.5">
                  <Calendar className="h-3 w-3" />
                  {primary.startDate.slice(5)} → {primary.endDate.slice(5)}
                </span>
                <span className="ml-auto text-xs font-medium text-indigo-700">
                  {option.matchScore}/100
                </span>
              </div>
            </>
          )}

          {/* Shared price + reasoning row */}
          {isStitched && (
            <div className="mt-2 flex items-center gap-2 text-[11px] text-[#737373]">
              <span className="flex items-center gap-0.5">
                <DollarSign className="h-3 w-3" />
                <span className={budget}>${option.totalPrice} total</span>
              </span>
            </div>
          )}
          {option.reasoning && option.reasoning.length > 0 && (
            <p className="mt-1 line-clamp-2 text-[11px] text-[#737373]">
              {option.reasoning.join(" ")}
            </p>
          )}
          {option.conditions && option.conditions.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-[10px] text-amber-700">
              {option.conditions.map((c) => (
                <li key={c}>• {c}</li>
              ))}
            </ul>
          )}
        </div>
        <label className="flex shrink-0 items-center" title={isStitched ? "Includes all vehicles in the chain" : ""}>
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-[#d4d4d8]"
            checked={isFullySelected}
            onChange={handleToggle}
          />
        </label>
      </div>
    </li>
  );
}
