"use client";

/* ─────────────────────────────────────────────────────────────────────────────
 * Consent — evidence, not preferences.
 *
 * A2P 10DLC carriers have rejected this platform's campaigns over exactly this,
 * so the timestamp beside the flag is as load-bearing as the flag.
 * ────────────────────────────────────────────────────────────────────────── */

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Panel, Row, Section, Toggle, fmtDate, listCls } from "./kit";
import type { SectionProps } from "./sections";

export function SectionConsent({ c, set, onJump, canEdit }: SectionProps) {
  return (
    <Panel
      title="Consent"
      description="Not a preference — a record of permission, with the date it was given."
    >
      <Section title="Text messages">
        <Toggle
          checked={c.consent.sms}
          disabled={!canEdit}
          onChange={(v) =>
            set({
              sms_consent: v,
              // The timestamp is the evidence. It is stamped when consent is
              // first recorded and cleared when it is withdrawn, so it always
              // describes the flag beside it rather than some earlier state.
              sms_consent_at: v ? (c.consent.smsAt ?? new Date().toISOString()) : null,
            })
          }
          label="This customer has agreed to receive SMS"
          hint="Booking confirmations, handover reminders, payment links and lockbox codes."
        />

        {c.consent.sms && (
          <div className="mt-5">
            <p className="mb-2.5 text-xs font-medium">The evidence</p>
            <div className={listCls}>
              <Row label="Given on" value={c.consent.smsAt ? fmtDate(c.consent.smsAt) : "Not recorded"} />
              <Row label="Number" value={c.identity.phone || "No phone on file"} mono />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              This is what a carrier asks for when a messaging campaign is challenged. Turning the
              switch off clears it — it does not archive it.
            </p>
          </div>
        )}

        {!c.consent.sms && (
          <div className="mt-5 flex items-start gap-3 rounded-3xl bg-warning-light/60 px-5 py-4 ring-1 ring-warning/25">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-warning">No SMS may be sent to this customer</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Including the lockbox code — the message that opens the box holding the keys. A
                handover set to lockbox will fall back to email, and if there is no email either it
                cannot complete.
              </p>
              {!c.identity.email && (
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => onJump("identity")}
                  className="mt-1 h-auto p-0 text-warning"
                >
                  There is no email on file either — add one
                </Button>
              )}
            </div>
          </div>
        )}
      </Section>

      <Section
        title="WhatsApp"
        description="A separate permission with its own template rules. Agreeing to SMS is not agreeing to this."
      >
        <Toggle
          checked={c.consent.whatsapp}
          disabled={!canEdit}
          onChange={(v) => set({ whatsapp_opt_in: v })}
          label="This customer has opted in to WhatsApp"
          hint="Used for handover threads where a photo is worth more than a paragraph."
        />
      </Section>

      <Section title="Where messages would go today">
        <div className={listCls}>
          <Row
            label="Email"
            value={c.identity.email || "Nothing on file"}
            tone={c.identity.email ? undefined : "muted"}
          />
          <Row
            label="SMS"
            value={c.consent.sms ? c.identity.phone || "No number on file" : "Not permitted"}
            tone={c.consent.sms && c.identity.phone ? undefined : "warning"}
          />
          <Row
            label="WhatsApp"
            value={c.consent.whatsapp ? c.identity.phone || "No number on file" : "Not permitted"}
            tone={c.consent.whatsapp && c.identity.phone ? undefined : "muted"}
          />
        </div>
      </Section>
    </Panel>
  );
}
