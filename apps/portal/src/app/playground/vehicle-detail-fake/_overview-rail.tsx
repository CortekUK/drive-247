"use client";

/**
 * Right rail of the vehicle screen — DESIGN SANDBOX. Nothing here is real.
 *
 * This is where the state of the record lives. The left rail is navigation and
 * says the same thing every time you look at it; this side answers "how is this
 * car doing?" without anything being opened, and keeps answering it while you
 * work in the middle.
 *
 * The rail is SECONDARY. The middle column is where the car is decided; this
 * side reports on it. 12px body, 10px meta, `size-4` icons — the left rail's
 * rhythm. If anything in here pulls the eye away from the middle, it is wrong.
 *
 * Two icon-only tabs in an `h-11` strip that matches the left rail's back-link
 * row exactly, so the two headers agree across the screen. Bare icons, no
 * labels: the title and aria-label carry the name, and two words up here would
 * be the only text competing with the panel underneath.
 *
 *   Overview   status, what needs attention, and the numbers that matter
 *   Activity   everything that has happened to this car, and who did it
 *
 * ATTENTION IS CLICKABLE, and that is the point of the whole rail. An amber
 * line that tells you something is wrong but not where to fix it just moves the
 * hunt somewhere else; each row here jumps to the tab that owns the problem.
 *
 * Amber means one thing in this sandbox — "produced from something that has
 * since moved" — so a car with an expired certificate is amber, and nothing in
 * here is red.
 */

import { useState } from "react";
import Image from "next/image";
import {
  Car,
  ChevronRight,
  CircleCheck,
  FileText,
  Globe,
  History,
  ImageIcon,
  LayoutDashboard,
  Plus,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { HeroChip } from "@/app/playground/_shared";
import type { EventKind, VehicleEvent } from "./_data";

/* ══════════════════════════════════════════════════════════════════════════
 * Shape
 * ═════════════════════════════════════════════════════════════════════════ */

type TabId = "overview" | "activity";

/** One thing that wants dealing with, and the tab that owns it. */
export type Attention<K extends string = string> = {
  key: string;
  /** The tab to open when this row is clicked. */
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

const TABS: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "activity", label: "Activity", icon: History },
];

/** Each kind of event gets the icon of the tab it came from. */
const EVENT_ICON: Record<EventKind, React.ComponentType<{ className?: string }>> = {
  created: Plus,
  listing: Globe,
  pricing: TrendingUp,
  rental: Car,
  service: Wrench,
  photo: ImageIcon,
  compliance: ShieldCheck,
  document: FileText,
};

/* ══════════════════════════════════════════════════════════════════════════
 * Rail
 * ═════════════════════════════════════════════════════════════════════════ */

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
  onJump,
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
  onJump: (target: K) => void;
}) {
  const [tab, setTab] = useState<TabId>("overview");

  return (
    <>
      {/* Tab strip — h-11 to line up with the left rail's back-link row. */}
      <div className="flex h-11 shrink-0 items-center gap-0.5 px-2">
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              title={t.label}
              aria-label={t.label}
              aria-pressed={active}
              className={cn(
                "flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              <t.icon className="size-4" />
            </button>
          );
        })}

        {tab === "overview" && attention.length > 0 && (
          <span className="ml-auto pr-1.5">
            <HeroChip tone="warning" dot={false}>
              {attention.length}
            </HeroChip>
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {tab === "overview" ? (
          <Overview
            name={name}
            plate={plate}
            coverSrc={coverSrc}
            statusLabel={statusLabel}
            statusTone={statusTone}
            listingLine={listingLine}
            attention={attention}
            vitals={vitals}
            onJump={onJump}
          />
        ) : (
          <Activity events={events} />
        )}
      </div>
    </>
  );
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
            <Image src={coverSrc} alt={name} fill sizes="22rem" className="object-cover" />
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

      {/* Needs attention */}
      <Block label="Needs attention">
        {attention.length === 0 ? (
          <div className="flex items-center gap-2.5 rounded-2xl bg-success/5 px-3.5 py-3 ring-1 ring-success/20">
            <CircleCheck className="size-4 shrink-0 text-success" />
            <p className="text-[12px] text-muted-foreground">
              Nothing wants doing. Everything produced from this record is up to date.
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

      {/* At a glance */}
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
                {v.hint && (
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">{v.hint}</span>
                )}
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

function Activity({ events }: { events: VehicleEvent[] }) {
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
          const Icon = EVENT_ICON[e.kind];
          const automatic = e.actor === "System";
          return (
            <li key={e.id} className="relative">
              <span className="absolute -left-[27px] top-0.5 flex size-4 items-center justify-center rounded-full bg-background ring-1 ring-foreground/10">
                <Icon className="size-2.5 text-muted-foreground" />
              </span>
              <p className="text-[12px] font-medium leading-snug">{e.label}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                {automatic && <Sparkles className="size-2.5 shrink-0" />}
                {e.actor} · {e.at}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * Chrome
 * ═════════════════════════════════════════════════════════════════════════ */

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
