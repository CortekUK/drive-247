/**
 * LeadActivityTimeline — Spec Section 6.4.
 * Read-only chronological feed of every event on a lead.
 */
"use client";

import { useLeadActivity, type LeadActivityEvent } from "@/hooks/use-lead-activity";

const EVENT_LABELS: Record<string, string> = {
  application_submitted: "Application submitted",
  application_submitted_blacklisted: "Application submitted (blacklisted)",
  quick_enquiry_submitted: "Quick enquiry submitted",
  stage_changed: "Stage changed",
  message_sent: "Message sent",
  doc_uploaded: "Document uploaded",
  doc_verified: "Document verified",
  offer_sent: "Offer sent",
  offer_opened: "Offer opened",
  offer_accepted: "Offer accepted",
  offer_expired: "Offer expired",
  automation_started: "Automation started",
  automation_completed: "Automation completed",
  score_changed: "Score changed",
  assigned: "Lead assigned",
  note_added: "Note added",
  converted: "Converted to rental",
};

function eventLabel(e: LeadActivityEvent): string {
  return EVENT_LABELS[e.event_type] ?? e.event_type;
}

function eventDetail(e: LeadActivityEvent): string | null {
  const p = e.payload as Record<string, unknown>;
  if (e.event_type === "stage_changed") {
    const from = p.from_stage ?? p.from;
    const to = p.to_stage ?? p.to;
    return `${from} → ${to}`;
  }
  if (e.event_type === "message_sent" && p.channel) {
    return String(p.channel).toUpperCase();
  }
  if (e.event_type === "score_changed" && p.from_band && p.to_band) {
    return `${p.from_band} → ${p.to_band}`;
  }
  return null;
}

export function LeadActivityTimeline({ leadId }: { leadId: string }) {
  const { data: events = [], isLoading } = useLeadActivity(leadId);

  if (isLoading) return <p className="text-xs text-[#737373]">Loading activity…</p>;
  if (events.length === 0) return <p className="text-xs text-[#737373]">No activity yet.</p>;

  return (
    <ol className="space-y-2">
      {events.map((e) => {
        const detail = eventDetail(e);
        return (
          <li key={e.id} className="flex items-start gap-2 border-l-2 border-[#e0e7ff] pl-3">
            <div className="flex-1 text-xs">
              <div className="font-medium text-[#404040]">
                {eventLabel(e)}{" "}
                {detail && <span className="text-[#737373]">· {detail}</span>}
              </div>
              <div className="mt-0.5 text-[#737373]">
                {e.actor_type} · {new Date(e.created_at).toLocaleString()}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
