/**
 * DismissRecommendationDialog — capture optional reason for dismissing.
 *
 * Reason flows through to pricing_recommendations.dismiss_reason — useful for
 * later retros and (eventually) training data on rejected suggestions.
 */
"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { PricingRecommendation } from "@/hooks/use-pricing-recommendations";

const QUICK_REASONS = [
  "Already priced correctly",
  "Vehicle off-fleet soon",
  "Customer-specific deal in flight",
  "Disagree with the suggestion",
  "Other",
];

interface Props {
  open: boolean;
  rec: PricingRecommendation | null;
  onClose: () => void;
  onSubmit: (reason?: string) => void;
  isSubmitting: boolean;
}

export function DismissRecommendationDialog({ open, rec, onClose, onSubmit, isSubmitting }: Props) {
  const [selected, setSelected] = useState<string>("");
  const [custom, setCustom] = useState("");

  useEffect(() => {
    if (open) { setSelected(""); setCustom(""); }
  }, [open]);

  if (!rec) return null;
  const finalReason = selected === "Other" ? custom.trim() : selected;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Dismiss recommendation</DialogTitle>
          <DialogDescription>
            We&apos;ll skip this one. You can add a short reason so we learn what
            doesn&apos;t fit — it&apos;s optional.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-1">
            {QUICK_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setSelected(r)}
                className={`flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors
                  ${selected === r
                    ? "border-indigo-300 bg-indigo-50 text-indigo-900"
                    : "border-[#f1f5f9] bg-white text-[#404040] hover:border-indigo-200"}`}
              >
                {r}
              </button>
            ))}
          </div>
          {selected === "Other" && (
            <Textarea
              placeholder="Tell us why (optional, max 500 chars)"
              value={custom}
              onChange={(e) => setCustom(e.target.value.slice(0, 500))}
              rows={3}
            />
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <Button
            onClick={() => onSubmit(finalReason || undefined)}
            disabled={isSubmitting}
            className="bg-red-600 text-white hover:bg-red-700"
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Dismiss
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
