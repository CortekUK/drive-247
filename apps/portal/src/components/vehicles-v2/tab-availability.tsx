"use client";

/**
 * OPERATIONS, part one — Availability.
 *
 * One question — can this car be booked, and if not, why — answered in one
 * list, with the lever that fixes each reason next to it.
 *
 * In v1 that answer is spread over four places: a pause card, a blocked-dates
 * card, a banner about an open rental, and a certificate expiry with no UI at
 * all. An operator asking "why can't I book this car?" had to visit all four
 * and know that the fourth existed.
 */

import { useState } from "react";
import { CircleCheck, Pause, Play, Plus, Trash2 } from "lucide-react";
import {
  ActionButton,
  AffixInput,
  DataRow,
  EmptyHint,
  IconButton,
  List,
  Panel,
  Pill,
  Section,
  daysBetween,
  daysUntil,
  fmtDate,
  todayISO,
} from "./kit";
import type { BlockedDate } from "@/hooks/use-blocked-dates";

/** One reason this car cannot be booked. */
export type Blocker = {
  key: string;
  label: string;
  detail: string;
  /** `hard` stops new bookings outright; `soft` blocks only certain dates. */
  severity: "hard" | "soft";
};

export function AvailabilityTab({
  blockers,
  paused,
  pausedReason,
  pausedAt,
  onPause,
  onResume,
  blockedDates,
  onAddBlock,
  onRemoveBlock,
  readOnly,
}: {
  blockers: Blocker[];
  paused: boolean;
  pausedReason: string | null;
  pausedAt: string | null;
  onPause: (reason: string) => void;
  onResume: () => void;
  blockedDates: BlockedDate[];
  onAddBlock: (from: string, to: string, reason: string) => void;
  onRemoveBlock: (id: string) => void;
  readOnly: boolean;
}) {
  const [pauseReason, setPauseReason] = useState("");
  const [draft, setDraft] = useState({ from: "", to: "", reason: "" });
  const canAdd = Boolean(draft.from && draft.to && draft.reason);
  const hard = blockers.filter((b) => b.severity === "hard");
  const today = todayISO();

  return (
    <Panel title="Availability" description="Whether this car can be booked, and what is in the way.">
      <Section
        tourId="vehicle-blockers"
        title={hard.length ? "Not bookable" : "Bookable"}
        action={
          hard.length ? (
            <Pill tone="warning">
              {hard.length} reason{hard.length === 1 ? "" : "s"}
            </Pill>
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
                right={
                  <Pill tone={b.severity === "hard" ? "warning" : "neutral"}>
                    {b.severity === "hard" ? "Blocks booking" : "Some dates"}
                  </Pill>
                }
              />
            ))}
          </List>
        )}
      </Section>

      <Section
        title="Pause"
        hint="Takes the car off the booking site without deleting anything. Rentals already under way carry on."
        action={paused ? <Pill tone="warning">Paused</Pill> : <Pill tone="success">Running</Pill>}
      >
        {paused ? (
          <div className="flex items-center gap-4 rounded-3xl bg-warning-light/60 px-5 py-4 ring-1 ring-warning/30">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{pausedReason || "No reason recorded"}</p>
              {pausedAt && (
                <p className="mt-0.5 text-xs text-muted-foreground">Since {fmtDate(pausedAt)}</p>
              )}
            </div>
            {!readOnly && (
              <ActionButton variant="outline" onClick={onResume}>
                <Play className="size-4" />
                Resume
              </ActionButton>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-[1fr_auto] items-end gap-3">
            <AffixInput
              value={pauseReason}
              onChange={setPauseReason}
              disabled={readOnly}
              placeholder="Why — kept on the record"
            />
            <ActionButton
              variant="outline"
              disabled={readOnly || !pauseReason.trim()}
              onClick={() => {
                onPause(pauseReason.trim());
                setPauseReason("");
              }}
            >
              <Pause className="size-4" />
              Pause
            </ActionButton>
          </div>
        )}
      </Section>

      <Section
        title="Blocked periods"
        hint="Dates this car is unavailable while it stays on the booking site."
      >
        {blockedDates.length > 0 && (
          <List className="mb-4">
            {blockedDates.map((b) => (
              <DataRow
                key={b.id}
                label={`${fmtDate(b.start_date)} → ${fmtDate(b.end_date)}`}
                sub={`${b.reason || "No reason recorded"} · ${daysBetween(b.start_date, b.end_date) + 1} days${
                  b.source_type && b.source_type !== "manual" ? ` · placed by ${b.source_type}` : ""
                }`}
                right={
                  <div className="flex items-center gap-3">
                    {b.start_date <= today && b.end_date >= today ? (
                      <Pill tone="warning">Now</Pill>
                    ) : (
                      <Pill tone="primary">In {daysUntil(b.start_date)}d</Pill>
                    )}
                    {!readOnly && (
                      <IconButton title="Unblock" onClick={() => onRemoveBlock(b.id)}>
                        <Trash2 className="size-3.5" />
                      </IconButton>
                    )}
                  </div>
                }
              />
            ))}
          </List>
        )}
        {!readOnly && (
          <div className="grid grid-cols-2 items-end gap-3 xl:grid-cols-[1fr_1fr_1.4fr_auto]">
            <AffixInput
              type="date"
              value={draft.from}
              onChange={(v) => setDraft((d) => ({ ...d, from: v }))}
            />
            <AffixInput
              type="date"
              value={draft.to}
              onChange={(v) => setDraft((d) => ({ ...d, to: v }))}
            />
            <AffixInput
              value={draft.reason}
              onChange={(v) => setDraft((d) => ({ ...d, reason: v }))}
              placeholder="Reason"
            />
            <ActionButton
              variant="outline"
              disabled={!canAdd}
              onClick={() => {
                onAddBlock(draft.from, draft.to, draft.reason);
                setDraft({ from: "", to: "", reason: "" });
              }}
            >
              <Plus className="size-4" />
              Add
            </ActionButton>
          </div>
        )}
      </Section>
    </Panel>
  );
}
