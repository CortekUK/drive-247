/**
 * OfferPreviewDialog — Phase 4 message composer for combined recommendations.
 *
 * Lets the operator:
 *   - Toggle which matched leads receive the offer
 *   - Edit the prefilled message body
 *   - Pick a channel override (auto by default)
 *   - Hit Send (or Apply+Send if the parent passed onAlsoApply)
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Send } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { PricingRecommendation } from "@/hooks/use-pricing-recommendations";
import type { MatchedLeadRow } from "@/hooks/use-recommendation-offers";

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

interface Props {
  open: boolean;
  rec: PricingRecommendation | null;
  matchedLeads: MatchedLeadRow[];
  /** Whether the parent also wants to apply the price after offers are sent. */
  alsoApplyPrice: boolean;
  onClose: () => void;
  onSubmit: (args: { leadIds: string[]; messageBody: string; channel?: "sms" | "email" }) => Promise<void> | void;
  isSubmitting: boolean;
}

export function OfferPreviewDialog({
  open, rec, matchedLeads, alsoApplyPrice, onClose, onSubmit, isSubmitting,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [channel, setChannel] = useState<"auto" | "sms" | "email">("auto");

  useEffect(() => {
    if (open && rec) {
      // Default: all leads selected
      setSelected(new Set(matchedLeads.map((l) => l.id)));
      // Prefill template
      const vehicle = [rec.vehicle?.make, rec.vehicle?.model].filter(Boolean).join(" ") || "the vehicle";
      const oldP = fmtMoney(rec.current_price);
      const newP = fmtMoney(rec.recommended_price);
      setMessage(
        `Hi, good news — the weekly rate on the ${vehicle} just dropped from ${oldP} to ${newP}. ` +
        `Still interested? Reply YES to lock it in.`,
      );
      setChannel("auto");
    }
  }, [open, rec, matchedLeads]);

  const counts = useMemo(() => {
    let sms = 0, email = 0, neither = 0;
    for (const l of matchedLeads) {
      if (!selected.has(l.id)) continue;
      if (channel === "sms") {
        if (l.phone) sms++; else neither++;
      } else if (channel === "email") {
        if (l.email) email++; else neither++;
      } else {
        if (l.phone) sms++;
        else if (l.email) email++;
        else neither++;
      }
    }
    return { sms, email, neither, total: selected.size };
  }, [selected, matchedLeads, channel]);

  if (!rec) return null;
  const trimmed = message.trim();
  const canSubmit = selected.size > 0 && trimmed.length > 0;
  const title = alsoApplyPrice ? "Apply price + send offers" : "Send offers";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {alsoApplyPrice ? (
              <>The price will be updated and offer messages dispatched to selected leads.</>
            ) : (
              <>The price stays unchanged — only the offer messages go out.</>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Lead picker */}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-[#404040]">Recipients ({selected.size} of {matchedLeads.length})</span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setSelected(new Set(matchedLeads.map((l) => l.id)))} className="text-[11px] text-indigo-600 hover:underline">All</button>
                <button type="button" onClick={() => setSelected(new Set())} className="text-[11px] text-indigo-600 hover:underline">None</button>
              </div>
            </div>
            <ul className="max-h-44 overflow-y-auto rounded-md border border-[#f1f5f9]">
              {matchedLeads.map((l) => {
                const isSelected = selected.has(l.id);
                return (
                  <li key={l.id}>
                    <button
                      type="button"
                      onClick={() => {
                        const next = new Set(selected);
                        if (isSelected) next.delete(l.id); else next.add(l.id);
                        setSelected(next);
                      }}
                      className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs transition-colors
                        ${isSelected ? "bg-indigo-50" : "bg-white hover:bg-[#fafafa]"}`}
                    >
                      <div className="flex items-center gap-2">
                        <input type="checkbox" checked={isSelected} readOnly className="h-3.5 w-3.5 rounded border-[#d4d4d8]" />
                        <span className="font-medium text-[#080812]">{l.full_name ?? "(no name)"}</span>
                      </div>
                      <span className="shrink-0 text-[10px] text-[#737373]">
                        {l.phone ? <span className="mr-1">SMS</span> : null}
                        {l.email ? <span>Email</span> : null}
                        {!l.phone && !l.email ? <span className="text-amber-700">No contact</span> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Channel + message */}
          <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
            <div>
              <span className="text-xs font-medium text-[#404040]">Message</span>
              <Textarea
                rows={5}
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, 1000))}
                placeholder="Compose the offer text"
                className="mt-1 text-sm"
              />
              <div className="mt-0.5 text-[10px] text-[#737373]">{message.length}/1000 characters</div>
            </div>
            <div>
              <span className="text-xs font-medium text-[#404040]">Channel</span>
              <Select value={channel} onValueChange={(v) => setChannel(v as "auto" | "sms" | "email")}>
                <SelectTrigger className="mt-1 h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto (SMS if phone)</SelectItem>
                  <SelectItem value="sms">SMS only</SelectItem>
                  <SelectItem value="email">Email only</SelectItem>
                </SelectContent>
              </Select>
              <div className="mt-2 space-y-0.5 text-[10px] text-[#737373]">
                <div>SMS: {counts.sms}</div>
                <div>Email: {counts.email}</div>
                {counts.neither > 0 && <div className="text-amber-700">No channel: {counts.neither}</div>}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <Button
            onClick={() => onSubmit({
              leadIds: [...selected],
              messageBody: trimmed,
              channel: channel === "auto" ? undefined : channel,
            })}
            disabled={!canSubmit || isSubmitting}
            className="bg-[#0f172a] text-white hover:bg-[#0f172a]/90"
          >
            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-3.5 w-3.5" />}
            {alsoApplyPrice ? "Apply price + send" : "Send offers"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
