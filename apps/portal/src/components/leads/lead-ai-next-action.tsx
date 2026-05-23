/**
 * LeadAINextAction — Spec Section 6.4 (Right column, Section 1) + 11.2.
 *
 * Calls ai-suggest-next-action with caching; falls back to deterministic
 * stage suggestion when AI is disabled / over quota / errored.
 */
"use client";

import { Loader2, Sparkles } from "lucide-react";
import type { LeadRow } from "@/hooks/use-leads";
import { useAISuggest } from "@/hooks/use-ai-suggest";

const ACTION_LABELS: Record<string, string> = {
  send_welcome: "Send welcome message",
  send_doc_request: "Request documents",
  send_followup: "Send follow-up",
  run_verification: "Run verification",
  approve_lead: "Approve the lead",
  review_failure: "Review failed verification",
  send_offer: "Build vehicle offer",
  send_agreement: "Send the agreement",
  send_payment_link: "Send payment link",
  schedule_pickup: "Schedule pickup",
  convert_to_rental: "Convert to rental",
  mark_lost: "Mark as lost",
  do_nothing: "No immediate action",
};

export function LeadAINextAction({ lead }: { lead: LeadRow }) {
  const { data, isLoading } = useAISuggest(lead.id, lead.last_activity_at);

  if (isLoading) {
    return (
      <section className="rounded-md border border-indigo-100 bg-indigo-50/40 p-3">
        <div className="flex items-center gap-1.5 text-xs text-indigo-700">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Computing next action…
        </div>
      </section>
    );
  }

  if (!data) {
    return null;
  }

  const label = ACTION_LABELS[data.action] ?? data.action;
  const confidence = Math.round((data.confidence ?? 0) * 100);

  return (
    <section className="rounded-md border border-indigo-100 bg-indigo-50/40 p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-indigo-700">
          <Sparkles className="h-3.5 w-3.5" />
          Next action
        </div>
        <span className="text-[10px] uppercase tracking-wide text-indigo-700/70">
          {data.source === "ai" ? `AI · ${confidence}%` : data.source === "cache" ? "Cached" : "Default"}
        </span>
      </div>
      <p className="text-sm font-medium text-[#080812]">{label}</p>
      {data.draftMessage && (
        <p className="mt-1 whitespace-pre-wrap text-xs text-[#404040]">
          “{data.draftMessage}”
        </p>
      )}
      {data.reasoning && (
        <p className="mt-1 text-[11px] italic text-[#737373]">{data.reasoning}</p>
      )}
    </section>
  );
}
