"use client";

/**
 * The right rail — where the state of the record lives.
 *
 * The left rail is navigation and says the same thing every time you look at
 * it. This side answers "how is this car doing?" without anything being
 * opened, and keeps answering it while you work in the middle.
 *
 * The rail is SECONDARY. The middle column is where the car is decided; this
 * side reports on it. 12px body, 10px meta, `size-4` icons — the left rail's
 * rhythm. If anything in here pulls the eye away from the middle, it is wrong.
 *
 * ATTENTION IS CLICKABLE, and that is the point of the whole rail. An amber
 * line that tells you something is wrong but not where to fix it just moves
 * the hunt somewhere else; every row here jumps to the tab that owns it.
 *
 * Amber means one thing on this screen — "something wants doing" — and nothing
 * in here is red. A certificate that lapsed last week is a Tuesday, not an
 * incident.
 *
 * The Activity tab is fed by `vehicle_events`, a real table with a real hook
 * (`use-vehicle-events.ts`) and, in v1, ZERO UI consumers. The pipe has been
 * sitting there ready the whole time; there has simply never been a surface to
 * put a vehicle's own history on.
 */

import {
  Banknote,
  Car,
  ChevronRight,
  CircleCheck,
  FileText,
  History,
  ImageIcon,
  LayoutDashboard,
  Plus,
  Receipt,
  Trash2,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { HeroChip, fmtDateTime } from "./kit";
import type { VehicleEvent } from "@/hooks/use-vehicle-events";
import { ContextTabs } from "@/components/timeline-v2/context-rail";


/** One thing that wants dealing with, and the tab that owns it. */
export type Attention<K extends string = string> = {
  key: string;
  target: K;
  label: string;
  detail: string;
};

/** A number worth seeing without opening anything. */
export type Vital = {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "warning" | "success";
};

/** Each event kind gets the icon of the thing it happened to. */
const EVENT_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  acquisition_created: Plus,
  acquisition_updated: Banknote,
  rental_started: Car,
  rental_ended: Car,
  expense_added: Receipt,
  expense_removed: Receipt,
  fine_assigned: Receipt,
  fine_closed: Receipt,
  file_uploaded: FileText,
  file_deleted: Trash2,
  disposal: Banknote,
  service_added: Wrench,
  service_updated: Wrench,
  service_removed: Wrench,
};

export function OverviewRail<K extends string>({
  name,
  plate,
  coverSrc,
  statusLabel,
  statusTone,
  listingLine,
  attention,
  vitals,
  events,
  eventsLoading,
  onJump,
  timeline,
}: {
  name: string;
  plate: string;
  coverSrc: string | null;
  statusLabel: string;
  statusTone: "muted" | "success" | "warning" | "primary";
  /** One line on where the public listing stands. */
  listingLine: string;
  attention: Attention<K>[];
  vitals: Vital[];
  events: VehicleEvent[];
  eventsLoading: boolean;
  onJump: (target: K) => void;
  timeline?: React.ReactNode;
}) {
  return <ContextTabs label="Vehicle context" defaultValue="overview" tabs={[
    { id: "overview", label: "Overview", content: <Overview name={name} plate={plate} coverSrc={coverSrc} statusLabel={statusLabel} statusTone={statusTone} listingLine={listingLine} attention={attention} vitals={vitals} onJump={onJump} /> },
    { id: "activity", label: "Activity", content: <Activity events={events} loading={eventsLoading} /> },
    ...(timeline ? [{ id: "timeline", label: "Timeline", content: timeline }] : []),
  ]} />;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Overview
 * ═════════════════════════════════════════════════════════════════════════ */

function Overview<K extends string>({
  name,
  plate,
  coverSrc,
  statusLabel,
  statusTone,
  listingLine,
  attention,
  vitals,
  onJump,
}: {
  name: string;
  plate: string;
  coverSrc: string | null;
  statusLabel: string;
  statusTone: "muted" | "success" | "warning" | "primary";
  listingLine: string;
  attention: Attention<K>[];
  vitals: Vital[];
  onJump: (target: K) => void;
}) {
  return (
    <div className="space-y-5">
      {/* The car itself — a photograph is how anyone recognises which one this
          is, faster than a plate and much faster than a name. */}
      <div className="overflow-hidden rounded-3xl bg-card shadow-md ring-1 ring-foreground/5 dark:ring-foreground/10">
        <div className="relative aspect-[16/10] w-full bg-muted">
          {coverSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coverSrc} alt="" className="size-full object-cover" />
          ) : (
            <span className="flex h-full items-center justify-center">
              <ImageIcon className="size-6 text-muted-foreground/40" />
            </span>
          )}
          <span className="absolute left-3 top-3">
            <HeroChip tone={statusTone}>{statusLabel}</HeroChip>
          </span>
        </div>
        <div className="px-4 py-3">
          <p className="truncate font-heading text-[13px] font-semibold">{name || "Untitled vehicle"}</p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {plate || "No registration"} · {listingLine}
          </p>
        </div>
      </div>

      <Block label="Needs attention">
        {attention.length === 0 ? (
          <div className="flex items-center gap-2.5 rounded-2xl bg-success/5 px-3.5 py-3 ring-1 ring-success/20">
            <CircleCheck className="size-4 shrink-0 text-success" />
            <p className="text-[12px] text-muted-foreground">
              Nothing wants doing. This car is bookable and up to date.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {attention.map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={() => onJump(a.target)}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-2xl bg-warning-light/60 px-3.5 py-2.5 text-left ring-1 ring-warning/25 transition-colors hover:bg-warning-light"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium">{a.label}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                    {a.detail}
                  </span>
                </span>
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        )}
      </Block>

      <Block label="At a glance">
        <div className="divide-y divide-foreground/5 overflow-hidden rounded-2xl bg-muted/40 ring-1 ring-foreground/5">
          {vitals.map((v) => (
            <div key={v.label} className="flex items-baseline gap-3 px-3.5 py-2.5">
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                {v.label}
              </span>
              <span className="shrink-0 text-right">
                <span
                  className={cn(
                    "block text-[12px] font-medium tabular-nums",
                    v.tone === "warning" && "text-warning",
                    v.tone === "success" && "text-success",
                  )}
                >
                  {v.value}
                </span>
                {v.hint && <span className="mt-0.5 block text-[10px] text-muted-foreground">{v.hint}</span>}
              </span>
            </div>
          ))}
        </div>
      </Block>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * Activity
 * ═════════════════════════════════════════════════════════════════════════ */

function Activity({ events, loading }: { events: VehicleEvent[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="space-y-3 pt-1">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-10 animate-pulse rounded-2xl bg-muted/50" />
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="rounded-2xl bg-muted/40 px-3.5 py-6 text-center ring-1 ring-foreground/5">
        <p className="text-[12px] text-muted-foreground">Nothing has happened to this car yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
        Everything that has happened to this car, newest first — including what the platform did on
        its own.
      </p>

      <ol className="relative ml-1 space-y-4 border-l border-foreground/10 pl-5">
        {events.map((e) => {
          const Icon = EVENT_ICON[e.event_type] ?? History;
          return (
            <li key={e.id} className="relative">
              <span className="absolute -left-[27px] top-0.5 flex size-4 items-center justify-center rounded-full bg-background ring-1 ring-foreground/10">
                <Icon className="size-2.5 text-muted-foreground" />
              </span>
              <p className="text-[12px] font-medium leading-snug">{e.summary}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{fmtDateTime(e.event_date)}</p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
        {label}
      </p>
      {children}
    </div>
  );
}
