/**
 * LeadInfoPanel — Spec Section 6.4 (Left column).
 *
 * Sections (top to bottom):
 *  1. Header (avatar, name, score chip, stage badge, quick action icons)
 *  2. Application summary
 *  3. Documents
 *  4. Tags
 *  5. Notes
 *  6. Activity timeline
 */
"use client";

import { Mail, Phone, MessageSquare, MessageCircle, Flame, ThermometerSun, Snowflake, AlertTriangle } from "lucide-react";
import type { LeadRow } from "@/hooks/use-leads";
import { stageColor, stageLabel } from "@/lib/lead-stage-machine";
import { cn } from "@/lib/utils";
import { LeadDocumentsList } from "./lead-documents-list";
import { LeadNotesList } from "./lead-notes-list";
import { LeadActivityTimeline } from "./lead-activity-timeline";

const BAND_ICONS = {
  hot: { Icon: Flame, color: "text-orange-600" },
  warm: { Icon: ThermometerSun, color: "text-amber-600" },
  cold: { Icon: Snowflake, color: "text-blue-500" },
  risk: { Icon: AlertTriangle, color: "text-red-600" },
} as const;

interface Props {
  lead: LeadRow;
  onFocusComposer?: (channel: "sms" | "email" | "whatsapp") => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-[#f1f5f9] bg-white p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#737373]">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex justify-between gap-2 text-xs py-1.5 border-b border-[#f1f5f9] last:border-b-0">
      <span className="text-[#737373]">{label}</span>
      <span className="text-right text-[#404040]">{value}</span>
    </div>
  );
}

export function LeadInfoPanel({ lead, onFocusComposer }: Props) {
  const initials = lead.full_name.split(" ").slice(0, 2).map((p) => p[0]).join("").toUpperCase();
  const hues = stageColor(lead.stage);
  const band = lead.score_band ? BAND_ICONS[lead.score_band] : null;
  const BandIcon = band?.Icon;
  const data = (lead.application_data ?? {}) as Record<string, unknown>;
  const addr = (data.address ?? {}) as Record<string, string | null | undefined>;
  const phoneTail = lead.phone.replace(/\D/g, "").slice(-4);

  return (
    <div className="flex h-full w-[320px] shrink-0 flex-col gap-3 overflow-y-auto border-r border-[#f1f5f9] bg-[#f8fafc] p-3">
      {/* Header */}
      <Section title="Lead">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-medium text-indigo-700">
            {initials || "?"}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-[#080812]">{lead.full_name}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs">
              {BandIcon && <BandIcon className={cn("h-3.5 w-3.5", band?.color)} />}
              {lead.lead_score != null && (
                <span className="text-[#737373]">Score {lead.lead_score}</span>
              )}
              {lead.score_band && (
                <span className={cn("capitalize", band?.color)}>{lead.score_band}</span>
              )}
            </div>
            <div className={cn("mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium", hues.bg, hues.text)}>
              {stageLabel(lead.stage)}
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 border-t border-[#f1f5f9] pt-2">
          <button onClick={() => onFocusComposer?.("sms")} className="rounded p-1.5 text-[#737373] hover:bg-[#f1f5f9]" aria-label="SMS">
            <Phone className="h-4 w-4" />
          </button>
          <button onClick={() => onFocusComposer?.("email")} className="rounded p-1.5 text-[#737373] hover:bg-[#f1f5f9]" aria-label="Email">
            <Mail className="h-4 w-4" />
          </button>
          <button onClick={() => onFocusComposer?.("whatsapp")} className="rounded p-1.5 text-[#737373] hover:bg-[#f1f5f9]" aria-label="WhatsApp">
            <MessageSquare className="h-4 w-4" />
          </button>
          <span className="ml-auto text-xs text-[#737373]">···{phoneTail}</span>
        </div>
      </Section>

      {/* Application summary */}
      <Section title="Application">
        <Row label="Purpose" value={String(data.purpose ?? "—")} />
        <Row label="Dates" value={lead.start_date && lead.end_date ? `${lead.start_date} → ${lead.end_date}` : "—"} />
        <Row label="Rental length" value={lead.rental_type ?? "—"} />
        <Row label="Vehicle" value={lead.vehicle_class || (lead.vehicle_id ? "Specific" : "Any")} />
        <Row label="Years driving" value={data.yearsDriving as number | undefined} />
        <Row label="Violations" value={data.hasViolations ? "Yes" : "No"} />
        <Row label="Deposit ready" value={data.canPayDeposit ? "Yes" : "No"} />
        <Row label="Deposit comfort" value={data.depositComfortAmount ? `$${data.depositComfortAmount}` : "—"} />
        <Row label="Weekly budget" value={data.weeklyBudget ? `$${data.weeklyBudget}` : "—"} />
        {(addr.line1 || addr.city) && (
          <Row label="Address" value={`${addr.line1 ?? ""}, ${addr.city ?? ""} ${addr.state ?? ""}`.trim()} />
        )}
        <Row label="DOB" value={data.dateOfBirth as string | undefined} />
      </Section>

      {/* Documents */}
      <Section title="Documents">
        <LeadDocumentsList leadId={lead.id} />
      </Section>

      {/* Tags */}
      <Section title="Tags">
        {lead.tags.length === 0 ? (
          <p className="text-xs text-[#737373]">No tags yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {lead.tags.map((t) => (
              <span key={t} className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
                {t}
              </span>
            ))}
          </div>
        )}
      </Section>

      {/* Notes */}
      <Section title="Notes">
        <LeadNotesList leadId={lead.id} />
      </Section>

      {/* Activity */}
      <Section title="Activity">
        <LeadActivityTimeline leadId={lead.id} />
      </Section>
    </div>
  );
}
