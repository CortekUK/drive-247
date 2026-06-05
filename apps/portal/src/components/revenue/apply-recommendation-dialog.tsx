/**
 * ApplyRecommendationDialog — confirm + (optionally) override the price.
 *
 * The user can:
 *   - Accept the recommendation as-is (default)
 *   - Type a custom price within [range_low, range_high]; the edge fn enforces
 *     the absolute max_swing + cost_floor server-side, but we surface the
 *     soft "outside the recommended range" warning here as a UX hint.
 */
"use client";

import { useEffect, useState } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PricingRecommendation } from "@/hooks/use-pricing-recommendations";

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

interface Props {
  open: boolean;
  rec: PricingRecommendation | null;
  onClose: () => void;
  onSubmit: (customPrice?: number) => void;
  isSubmitting: boolean;
}

export function ApplyRecommendationDialog({ open, rec, onClose, onSubmit, isSubmitting }: Props) {
  const [useCustom, setUseCustom] = useState(false);
  const [customValue, setCustomValue] = useState("");

  // Reset whenever a new rec is opened
  useEffect(() => {
    if (open && rec) {
      setUseCustom(false);
      setCustomValue(String(rec.recommended_price));
    }
  }, [open, rec]);

  if (!rec) return null;

  const numeric = Number(customValue);
  const validCustom = Number.isFinite(numeric) && numeric > 0;
  const outsideRange =
    validCustom && (numeric < rec.recommended_range_low || numeric > rec.recommended_range_high);
  const finalPrice = useCustom ? numeric : rec.recommended_price;

  const v = rec.vehicle;
  const vehicleLabel = [v?.make, v?.model].filter(Boolean).join(" ") || "this vehicle";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Apply pricing change</DialogTitle>
          <DialogDescription>
            This updates <span className="font-medium text-[#080812]">{vehicleLabel}</span>
            {v?.reg ? <> ({v.reg})</> : null} and is recorded in the price-change audit log.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Recommended summary */}
          <div className="rounded-md border border-[#f1f5f9] bg-[#f8fafc] p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-[#737373]">Current</span>
              <span className="tabular-nums font-medium text-[#404040]">{fmtMoney(rec.current_price)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-[#737373]">Recommended</span>
              <span className="tabular-nums font-medium text-emerald-600">{fmtMoney(rec.recommended_price)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-[#737373]">Range</span>
              <span className="tabular-nums text-[11px] text-[#737373]">
                {fmtMoney(rec.recommended_range_low)} – {fmtMoney(rec.recommended_range_high)}
              </span>
            </div>
          </div>

          {/* Custom price */}
          <div>
            <label className="flex items-center gap-2 text-xs text-[#404040]">
              <input
                type="checkbox"
                checked={useCustom}
                onChange={(e) => setUseCustom(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-[#d4d4d8] text-indigo-600"
              />
              Set a custom price instead
            </label>
            {useCustom && (
              <div className="mt-2">
                <Label className="text-[11px] uppercase tracking-wide text-[#737373]">New price</Label>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={customValue}
                  onChange={(e) => setCustomValue(e.target.value)}
                  className="mt-1 h-9 text-sm"
                />
                {outsideRange && validCustom && (
                  <div className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    Outside the recommended range — apply may still be rejected by safety rails.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <Button
            onClick={() => onSubmit(useCustom ? finalPrice : undefined)}
            disabled={isSubmitting || (useCustom && !validCustom)}
            className="bg-[#0f172a] text-white hover:bg-[#0f172a]/90"
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Apply {fmtMoney(useCustom && validCustom ? finalPrice : rec.recommended_price)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
