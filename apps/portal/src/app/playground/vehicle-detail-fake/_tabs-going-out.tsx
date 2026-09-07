"use client";

/**
 * OPERATIONS, part one — Availability and Pickup & handover.
 *
 * Availability answers one question — can this car be booked, and if not, why
 * — in one list, with the lever to fix each reason next to it. In v1 that
 * answer is spread over four screens: a pause card, a blocked-dates card, a
 * banner about an open rental, and a certificate expiry with no UI at all.
 */

import { useState } from "react";
import { CircleCheck, KeyRound, Pause, Play, Plus, Trash2 } from "lucide-react";
import { ActionButton, EmptyHint, Field, OptionCard, Panel, Pill, fmtDate, textareaCls } from "@/app/playground/_shared";
import {
  HANDOVER_METHODS,
  PICKUP_LOCATIONS,
  TODAY,
  type Availability,
  type Handling,
  daysBetween,
  daysUntil,
} from "./_data";
import { AffixInput, Aside, DataRow, IconButton, List, Section } from "./_ui";

/** One reason this car cannot be booked. */
export type Blocker = {
  key: string;
  label: string;
  detail: string;
  /** `hard` stops new bookings outright; `soft` blocks only certain dates. */
  severity: "hard" | "soft";
};

/* ══════════════════════════════════════════════════════════════════════════
 * Availability
 * ═════════════════════════════════════════════════════════════════════════ */

export function AvailabilityTab({
  availability,
  onChange,
  blockers,
  makeId,
}: {
  availability: Availability;
  onChange: (fn: (a: Availability) => Availability) => void;
  blockers: Blocker[];
  makeId: () => string;
}) {
  const [draft, setDraft] = useState({ from: "", to: "", reason: "" });
  const canAdd = Boolean(draft.from && draft.to && draft.reason);
  const hard = blockers.filter((b) => b.severity === "hard");

  const add = () => {
    if (!canAdd) return;
    onChange((a) => ({ ...a, blackouts: [...a.blackouts, { id: makeId(), ...draft }] }));
    setDraft({ from: "", to: "", reason: "" });
  };

  return (
    <Panel title="Availability" description="Whether this car can be booked, and what is in the way.">
      <Section
        title={hard.length ? "Not bookable" : "Bookable"}
        action={
          hard.length ? (
            <Pill tone="warning">{hard.length} reason{hard.length === 1 ? "" : "s"}</Pill>
          ) : (
            <Pill tone="success">
              <CircleCheck className="size-3" />
              Open
            </Pill>
          )
        }
      >
        {blockers.length === 0 ? (
          <EmptyHint>Nothing in the way.</EmptyHint>
        ) : (
          <List>
            {blockers.map((b) => (
              <DataRow
                key={b.key}
                label={b.label}
                sub={b.detail}
                right={<Pill tone={b.severity === "hard" ? "warning" : "neutral"}>{b.severity === "hard" ? "Blocks booking" : "Some dates"}</Pill>}
              />
            ))}
          </List>
        )}
      </Section>

      <Section
        title="Pause"
        hint="Takes the car off the site without unlisting it. Rentals under way carry on."
        action={availability.paused ? <Pill tone="warning">Paused</Pill> : <Pill tone="success">Running</Pill>}
      >
        {availability.paused ? (
          <div className="flex items-center gap-4 rounded-3xl bg-warning-light/60 px-5 py-4 ring-1 ring-warning/30">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{availability.pausedReason || "No reason recorded"}</p>
              {availability.pausedAt && <p className="mt-0.5 text-xs text-muted-foreground">Since {fmtDate(availability.pausedAt)}</p>}
            </div>
            <ActionButton variant="outline" onClick={() => onChange((a) => ({ ...a, paused: false, pausedReason: "", pausedAt: "" }))}>
              <Play className="size-4" />
              Resume
            </ActionButton>
          </div>
        ) : (
          <div className="grid grid-cols-[1fr_auto] items-end gap-3">
            <AffixInput
              value={availability.pausedReason}
              onChange={(v) => onChange((a) => ({ ...a, pausedReason: v }))}
              placeholder="Why — kept on the record"
            />
            <ActionButton
              variant="outline"
              disabled={!availability.pausedReason.trim()}
              onClick={() => onChange((a) => ({ ...a, paused: true, pausedAt: TODAY }))}
            >
              <Pause className="size-4" />
              Pause
            </ActionButton>
          </div>
        )}
      </Section>

      <Section title="Blocked periods" hint="Dates the car is unavailable while staying on the site.">
        {availability.blackouts.length > 0 && (
          <List className="mb-4">
            {availability.blackouts.map((b) => (
              <DataRow
                key={b.id}
                label={`${fmtDate(b.from)} → ${fmtDate(b.to)}`}
                sub={`${b.reason} · ${daysBetween(b.from, b.to)} days`}
                right={
                  <div className="flex items-center gap-3">
                    {b.to < TODAY ? <Pill tone="neutral">Passed</Pill> : <Pill tone="primary">In {daysUntil(b.from)}d</Pill>}
                    <IconButton
                      title="Remove"
                      onClick={() => onChange((a) => ({ ...a, blackouts: a.blackouts.filter((r) => r.id !== b.id) }))}
                    >
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  </div>
                }
              />
            ))}
          </List>
        )}
        <div className="grid grid-cols-2 items-end gap-3 xl:grid-cols-[1fr_1fr_1.4fr_auto]">
          <AffixInput type="date" value={draft.from} onChange={(v) => setDraft((d) => ({ ...d, from: v }))} />
          <AffixInput type="date" value={draft.to} onChange={(v) => setDraft((d) => ({ ...d, to: v }))} />
          <AffixInput value={draft.reason} onChange={(v) => setDraft((d) => ({ ...d, reason: v }))} placeholder="Reason" />
          <ActionButton onClick={add} disabled={!canAdd} variant="outline">
            <Plus className="size-4" />
            Add
          </ActionButton>
        </div>
      </Section>
    </Panel>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * Pickup & handover
 * ═════════════════════════════════════════════════════════════════════════ */

export function PickupTab({
  handling,
  onChange,
}: {
  handling: Handling;
  onChange: (fn: (h: Handling) => Handling) => void;
}) {
  return (
    <Panel title="Pickup & handover" description="Where the customer collects this car, and how they get the keys.">
      <Section title="Pickup location">
        <div className="space-y-2.5">
          {PICKUP_LOCATIONS.map((loc) => (
            <OptionCard
              key={loc.id}
              selected={handling.pickupId === loc.id}
              onClick={() => onChange((h) => ({ ...h, pickupId: loc.id }))}
              title={loc.name}
              subtitle={loc.detail}
            />
          ))}
        </div>
        <div className="mt-5 max-w-xs">
          <Field label="Garaged in" hint="The state it is kept and insured in.">
            <AffixInput value={handling.garagingState} onChange={(v) => onChange((h) => ({ ...h, garagingState: v }))} placeholder="Colorado" />
          </Field>
        </div>
      </Section>

      <Section title="Handover" hint="The default for this car. A rental can still override it.">
        <div className="space-y-2.5">
          {HANDOVER_METHODS.map((m) => (
            <OptionCard
              key={m.id}
              selected={handling.handover === m.id}
              onClick={() => onChange((h) => ({ ...h, handover: m.id }))}
              title={m.name}
              subtitle={m.detail}
            />
          ))}
        </div>

        {handling.handover === "lockbox" && (
          <div className="mt-5 space-y-5 rounded-3xl bg-primary-light/50 p-5 ring-1 ring-primary/20">
            <div className="grid grid-cols-[8rem_1fr] gap-5">
              <Field label="Lockbox code">
                <AffixInput value={handling.lockboxCode} onChange={(v) => onChange((h) => ({ ...h, lockboxCode: v }))} placeholder="4471" />
              </Field>
              <Field label="Where to find it" hint="Sent to the customer with the code.">
                <textarea
                  value={handling.lockboxInstructions}
                  onChange={(e) => onChange((h) => ({ ...h, lockboxInstructions: e.target.value }))}
                  rows={2}
                  placeholder="Rear left wheel arch"
                  className={textareaCls}
                />
              </Field>
            </div>
            {!handling.lockboxCode && (
              <Aside tone="warning">
                <span className="inline-flex items-center gap-1.5">
                  <KeyRound className="size-3.5" />
                  No code set — the customer would get instructions and nothing to open the box.
                </span>
              </Aside>
            )}
          </div>
        )}
      </Section>
    </Panel>
  );
}
