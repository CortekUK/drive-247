"use client";

import { useMemo, useRef, useState } from "react";

import { formatIsoDateLabel } from "@nw/components/booking/time-utils";
import { Button } from "@nw/components/ui/button";
import { Dialog, DialogDescription, DialogTitle } from "@nw/components/ui/dialog";
import { cn } from "@nw/lib/utils";
import { PvDialogContent } from "@nw/portal-v2/dialog";

/**
 * Choosing a time, on a clock. A dialog over the quick book (its scrim blurs
 * everything behind): the time big at the top, a clock face you tap or drag
 * round to pick the hour — the hand swings to it — AM / PM, the minutes as
 * chips (always quarter hours), and one button. Hours outside the operator's
 * first and last time are faded and cannot be picked. `slots` is the
 * operator's times ("HH:MM", 24h); only their range is used here.
 */

const FACE = 248;
const CENTRE = FACE / 2;
const RADIUS = 92;

function parse(slot: string): { h: number; m: number } {
  const [h, m] = slot.split(":").map(Number);
  return { h, m };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function TimeClockDialog({
  open,
  onOpenChange,
  title,
  dateIso,
  value,
  slots,
  onSet,
  confirmLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  dateIso: string;
  /** "HH:MM", 24h. */
  value: string;
  slots: readonly string[];
  onSet: (time: string) => void;
  confirmLabel: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <PvDialogContent className="w-[calc(100%-2rem)] max-w-[380px] gap-0 rounded-[36px] p-6 sm:max-w-[380px] sm:p-7">
          <ClockBody title={title} dateIso={dateIso} value={value} slots={slots} onSet={onSet} confirmLabel={confirmLabel} />
        </PvDialogContent>
      ) : null}
    </Dialog>
  );
}

function ClockBody({
  title,
  dateIso,
  value,
  slots,
  onSet,
  confirmLabel,
}: {
  title: string;
  dateIso: string;
  value: string;
  slots: readonly string[];
  onSet: (time: string) => void;
  confirmLabel: string;
}) {
  /**
   * Every quarter hour from the operator's first time to their last — the
   * minutes are always :00 / :15 / :30 / :45, whatever step the slots use.
   */
  const quarters = useMemo(() => {
    const mins = slots.map((slot) => parse(slot)).map(({ h, m }) => h * 60 + m);
    if (mins.length === 0) return [];
    const out: string[] = [];
    for (let t = Math.ceil(Math.min(...mins) / 15) * 15; t <= Math.max(...mins); t += 15) {
      out.push(`${pad(Math.floor(t / 60))}:${pad(t % 60)}`);
    }
    return out;
  }, [slots]);

  /** Minutes offered in each hour of the day. */
  const byHour = useMemo(() => {
    const map = new Map<number, number[]>();
    for (const slot of quarters) {
      const { h, m } = parse(slot);
      map.set(h, [...(map.get(h) ?? []), m]);
    }
    return map;
  }, [quarters]);

  const start = parse(value || slots[0] || "10:00");
  const [hour, setHour] = useState(start.h);
  const [minute, setMinute] = useState(start.m);
  const pm = hour >= 12;
  const face = useRef<HTMLDivElement>(null);

  const minutes = byHour.get(hour) ?? [];
  const chosen = `${pad(hour)}:${pad(minutes.includes(minute) ? minute : (minutes[0] ?? 0))}`;
  const valid = quarters.includes(chosen);

  const pickHour = (h24: number) => {
    if (!byHour.has(h24)) return;
    setHour(h24);
    const offered = byHour.get(h24) ?? [];
    if (!offered.includes(minute)) setMinute(offered[0] ?? 0);
  };

  const flip = (toPm: boolean) => {
    if (toPm === pm) return;
    const mirrored = toPm ? hour + 12 : hour - 12;
    if (byHour.has(mirrored)) return pickHour(mirrored);
    // The same hour is not offered on the other side: take the first that is.
    const first = [...byHour.keys()].sort((a, b) => a - b).find((h) => (toPm ? h >= 12 : h < 12));
    if (first !== undefined) pickHour(first);
  };

  // Tap or drag on the face: the hour nearest the pointer, on this side of noon.
  const fromPointer = (x: number, y: number) => {
    const box = face.current?.getBoundingClientRect();
    if (!box) return;
    const deg = (Math.atan2(y - box.top - CENTRE, x - box.left - CENTRE) * 180) / Math.PI + 90;
    const n = Math.round((((deg % 360) + 360) % 360) / 30) % 12;
    pickHour(n + (pm ? 12 : 0));
  };

  const hand = ((hour % 12) * 30 + (minute / 60) * 30) % 360;
  const hasAm = [...byHour.keys()].some((h) => h < 12);
  const hasPm = [...byHour.keys()].some((h) => h >= 12);
  const display12 = ((hour + 11) % 12) + 1;

  return (
    <div className="flex flex-col items-center">
      <DialogTitle className="text-center text-[17px] font-semibold text-pv-fg">{title}</DialogTitle>
      <DialogDescription className="mt-0.5 text-center text-[13px] text-pv-muted-fg">
        {formatIsoDateLabel(dateIso).replace(/, \d{4}$/, "")}
      </DialogDescription>

      {/* The time, big. */}
      <div className="mt-4 flex items-baseline gap-2">
        <span key={chosen} className="qb-pop-text text-[44px] font-bold leading-none tracking-[-0.04em] tabular-nums text-pv-fg">
          {display12}:{chosen.slice(3)}
        </span>
        <div className="flex flex-col gap-1">
          {(["AM", "PM"] as const).map((half) => {
            const isPm = half === "PM";
            const offered = isPm ? hasPm : hasAm;
            return (
              <button
                key={half}
                type="button"
                disabled={!offered}
                onClick={() => flip(isPm)}
                className={cn(
                  "h-6 cursor-pointer rounded-full px-2.5 text-[11px] font-bold transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-30",
                  pm === isPm ? "bg-pv-primary text-pv-primary-fg" : "bg-pv-muted text-pv-muted-fg hover:text-pv-fg",
                )}
              >
                {half}
              </button>
            );
          })}
        </div>
      </div>

      {/* The face. */}
      <div
        ref={face}
        className="relative mt-5 touch-none select-none rounded-full bg-pv-muted"
        style={{ width: FACE, height: FACE }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          fromPointer(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (event.buttons) fromPointer(event.clientX, event.clientY);
        }}
      >
        {/* Minute ticks round the rim. */}
        <svg aria-hidden viewBox={`0 0 ${FACE} ${FACE}`} className="pointer-events-none absolute inset-0">
          {Array.from({ length: 60 }, (_, i) => {
            const a = (i * 6 * Math.PI) / 180;
            const long = i % 5 === 0;
            const r1 = CENTRE - 6;
            const r2 = CENTRE - (long ? 13 : 9);
            return (
              <line
                key={i}
                x1={CENTRE + r1 * Math.sin(a)}
                y1={CENTRE - r1 * Math.cos(a)}
                x2={CENTRE + r2 * Math.sin(a)}
                y2={CENTRE - r2 * Math.cos(a)}
                stroke="currentColor"
                className="text-pv-muted-fg"
                strokeOpacity={long ? 0.45 : 0.2}
                strokeWidth={long ? 1.6 : 1}
                strokeLinecap="round"
              />
            );
          })}
        </svg>

        {/* The hand, swinging to the hour. */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 origin-bottom transition-transform duration-300 ease-[cubic-bezier(.34,1.4,.64,1)] motion-reduce:transition-none"
          style={{ width: 3, height: RADIUS, marginLeft: -1.5, marginTop: -RADIUS, transform: `rotate(${hand}deg)` }}
        >
          <span className="block h-full w-full rounded-full bg-pv-primary" />
        </div>
        <span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-pv-primary ring-4 ring-pv-muted" />

        {Array.from({ length: 12 }, (_, i) => {
          const n = i + 1;
          const h24 = (n % 12) + (pm ? 12 : 0);
          const offered = byHour.has(h24);
          const selected = h24 === hour;
          const a = (n * 30 * Math.PI) / 180;
          return (
            <button
              key={n}
              type="button"
              disabled={!offered}
              aria-label={`${n} ${pm ? "PM" : "AM"}`}
              aria-pressed={selected}
              onClick={() => pickHour(h24)}
              className={cn(
                "absolute grid size-10 -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-[15px] font-semibold tabular-nums transition-colors duration-200 disabled:cursor-not-allowed",
                selected
                  ? "qb-pop-text bg-pv-primary text-pv-primary-fg"
                  : offered
                    ? "text-pv-fg hover:bg-pv-card"
                    : "text-pv-muted-fg/35",
              )}
              style={{ left: CENTRE + RADIUS * Math.sin(a), top: CENTRE - RADIUS * Math.cos(a) }}
            >
              {n}
            </button>
          );
        })}
      </div>

      {/* Minutes for that hour. */}
      {minutes.length > 0 ? (
        <div className="mt-5 flex gap-2">
          {minutes.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={chosen.endsWith(`:${pad(m)}`)}
              onClick={() => setMinute(m)}
              className={cn(
                "h-10 min-w-14 cursor-pointer rounded-full px-3.5 text-[14px] font-semibold tabular-nums transition-all duration-200 active:scale-95",
                chosen.endsWith(`:${pad(m)}`) ? "bg-pv-fg text-pv-card" : "bg-pv-muted text-pv-fg hover:bg-pv-tint",
              )}
            >
              :{pad(m)}
            </button>
          ))}
        </div>
      ) : null}

      <Button
        variant="brand"
        disabled={!valid}
        onClick={() => onSet(chosen)}
        className="mt-6 h-12 w-full rounded-full text-[15px] font-semibold transition-transform duration-200 hover:scale-[1.015] active:scale-[0.97]"
      >
        {confirmLabel}
      </Button>
    </div>
  );
}
