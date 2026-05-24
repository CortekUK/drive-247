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

import { useState } from "react";
import { Mail, Phone, MessageSquare, MessageCircle, Flame, ThermometerSun, Snowflake, AlertTriangle, Copy, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";
import type { LeadRow } from "@/hooks/use-leads";
import { useUpdateLeadContact } from "@/hooks/use-lead-mutations";
import { stageColor, stageLabel } from "@/lib/lead-stage-machine";
import { cn } from "@/lib/utils";
import { LeadDocumentsList } from "./lead-documents-list";
import { LeadNotesList } from "./lead-notes-list";
import { LeadActivityTimeline } from "./lead-activity-timeline";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function hasUsableEmail(email: string | null | undefined): boolean {
  return !!email && EMAIL_RE.test(email.trim());
}
function hasUsablePhone(phone: string | null | undefined): boolean {
  if (!phone) return false;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7;
}

function EditableContactRow({
  Icon,
  label,
  value,
  onCopy,
  onSave,
  validate,
  saving,
  inputType = "text",
  placeholder,
}: {
  Icon: typeof Phone;
  label: string;
  value: string | null;
  onCopy?: () => void;
  onSave: (next: string) => void;
  validate: (next: string) => string | null;
  saving: boolean;
  inputType?: "text" | "email" | "tel";
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  const start = () => { setDraft(value ?? ""); setEditing(true); };
  const cancel = () => { setEditing(false); setDraft(value ?? ""); };
  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === (value ?? "")) { setEditing(false); return; }
    const err = validate(trimmed);
    if (err) { toast.error(err); return; }
    onSave(trimmed);
    setEditing(false);
  };

  return (
    <div className="flex items-center justify-between gap-2 py-1.5 text-xs border-b border-[#f1f5f9] last:border-b-0">
      <div className="flex min-w-0 items-center gap-1.5 text-[#737373]">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span>{label}</span>
      </div>
      {editing ? (
        <div className="flex min-w-0 flex-1 items-center gap-1 pl-2">
          <input
            type={inputType}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") cancel();
            }}
            placeholder={placeholder}
            autoFocus
            className="min-w-0 flex-1 rounded border border-[#d4d4d8] bg-white px-1.5 py-0.5 text-xs text-[#080812] outline-none focus:border-indigo-400"
          />
          <button
            type="button"
            onClick={commit}
            disabled={saving}
            className="shrink-0 rounded p-0.5 text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
            aria-label="Save"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={saving}
            className="shrink-0 rounded p-0.5 text-[#737373] hover:bg-[#f1f5f9] disabled:opacity-50"
            aria-label="Cancel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[#404040]" title={value ?? undefined}>{value ?? "—"}</span>
          {value && onCopy && (
            <button
              type="button"
              onClick={onCopy}
              className="shrink-0 rounded p-0.5 text-[#737373] hover:bg-[#f1f5f9] hover:text-[#404040]"
              aria-label={`Copy ${label.toLowerCase()}`}
            >
              <Copy className="h-3 w-3" />
            </button>
          )}
          <button
            type="button"
            onClick={start}
            className="shrink-0 rounded p-0.5 text-[#737373] hover:bg-[#f1f5f9] hover:text-[#404040]"
            aria-label={`Edit ${label.toLowerCase()}`}
          >
            <Pencil className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}

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
  const phoneOk = hasUsablePhone(lead.phone);
  const emailOk = hasUsableEmail(lead.email);
  const updateContact = useUpdateLeadContact();

  const copy = (label: string, value: string) => {
    navigator.clipboard?.writeText(value);
    toast.success(`${label} copied`);
  };

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
        {/* Channel quick-jumps — disabled when the destination isn't usable. */}
        <div className="mt-3 flex items-center gap-2 border-t border-[#f1f5f9] pt-2">
          <button
            onClick={() => phoneOk && onFocusComposer?.("sms")}
            disabled={!phoneOk}
            title={phoneOk ? "Compose SMS" : "No phone on file"}
            className="rounded p-1.5 text-[#737373] hover:bg-[#f1f5f9] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            aria-label="SMS"
          >
            <Phone className="h-4 w-4" />
          </button>
          <button
            onClick={() => emailOk && onFocusComposer?.("email")}
            disabled={!emailOk}
            title={emailOk ? "Compose email" : "No email on file"}
            className="rounded p-1.5 text-[#737373] hover:bg-[#f1f5f9] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            aria-label="Email"
          >
            <Mail className="h-4 w-4" />
          </button>
          <button
            onClick={() => phoneOk && onFocusComposer?.("whatsapp")}
            disabled={!phoneOk}
            title={phoneOk ? "Compose WhatsApp" : "No phone on file"}
            className="rounded p-1.5 text-[#737373] hover:bg-[#f1f5f9] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            aria-label="WhatsApp"
          >
            <MessageSquare className="h-4 w-4" />
          </button>
        </div>
      </Section>

      {/* Contact details — operator-editable so a typo at apply time can be
          corrected here rather than via DB. */}
      <Section title="Contact">
        <EditableContactRow
          Icon={Phone}
          label="Phone"
          value={lead.phone || null}
          inputType="tel"
          placeholder="+1 555 123 4567"
          onCopy={lead.phone ? () => copy("Phone", lead.phone) : undefined}
          saving={updateContact.isPending}
          validate={(next) => {
            if (!next) return "Phone is required";
            const digits = next.replace(/\D/g, "");
            if (digits.length < 7 || digits.length > 15) return "Phone must be 7–15 digits";
            return null;
          }}
          onSave={(next) => updateContact.mutate({ leadId: lead.id, patch: { phone: next } })}
        />
        <EditableContactRow
          Icon={Mail}
          label="Email"
          value={lead.email || null}
          inputType="email"
          placeholder="lead@example.com"
          onCopy={lead.email ? () => copy("Email", lead.email) : undefined}
          saving={updateContact.isPending}
          validate={(next) => {
            if (!next) return "Email is required";
            if (!EMAIL_RE.test(next)) return "Enter a valid email";
            return null;
          }}
          onSave={(next) => updateContact.mutate({ leadId: lead.id, patch: { email: next } })}
        />
        {!phoneOk && (
          <p className="mt-1 text-[10px] text-amber-700">⚠ No usable phone — SMS / WhatsApp disabled.</p>
        )}
        {!emailOk && (
          <p className="mt-1 text-[10px] text-amber-700">⚠ No usable email — Email channel disabled.</p>
        )}
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
