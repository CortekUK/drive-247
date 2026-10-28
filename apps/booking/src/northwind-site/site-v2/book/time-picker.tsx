"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react-nw";

import { formatClockLabel, zonedWallClockToInstant } from "@nw/components/booking/time-utils";
import { cn } from "@nw/lib/utils";

import { prettyDate, type TripEnd } from "./trip-calendar";

/**
 * Step 1's times, inline beside the calendar rather than in a dialog over it.
 * A card per end of the trip; the one being edited opens onto a clock:
 *
 *   - the time, big, its hour and minutes each a tab for the face below;
 *   - the face: tap or drag round to the hour, and it turns to the minutes —
 *     the quarter hours, at 12, 3, 6 and 9 — for a second tap;
 *   - AM / PM beside the time.
 *
 * Every pick is kept at once; there is no "set". Hours the operator is closed
 * (or that are too soon to book) are faded and can't be picked, and the face
 * says the opening hours under it, so a faded hour never needs explaining.
 *
 * `slots` are the operator's quarter hours ("HH:MM", 24h); `isOpen` says
 * which of them can be booked (a pickup must clear the lead time).
 */

const QUARTERS = [0, 15, 30, 45];
const pad = (n: number) => String(n).padStart(2, "0");
const hourOf = (slot: string) => Number(slot.slice(0, 2));
const minuteOf = (slot: string) => Number(slot.slice(3, 5));

type Mode = "hour" | "minute";

export function TimeCard({
  end,
  active,
  onActivate,
  date,
  value,
  slots,
  isOpen,
  onChange,
  operatorZone,
  viewerZone,
  viewerDiffers,
}: {
  end: TripEnd;
  active: boolean;
  onActivate: () => void;
  date: string;
  value: string;
  slots: readonly string[];
  isOpen: (slot: string) => boolean;
  onChange: (slot: string) => void;
  operatorZone: string;
  viewerZone: string;
  viewerDiffers: boolean;
}) {
  const title = end === "pickup" ? "Pickup" : "Return";

  const viewerTime = useMemo(() => {
    if (!viewerDiffers || !value) return null;
    const instant = zonedWallClockToInstant(date, value, operatorZone);
    if (!instant) return null;
    try {
      return instant.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: viewerZone });
    } catch {
      return null;
    }
  }, [viewerDiffers, value, date, operatorZone, viewerZone]);

  return (
    <section
      aria-label={`${title} time`}
      className={cn(
        "rounded-[24px] border-2 bg-pv-card transition-colors duration-200 motion-reduce:transition-none",
        active ? "border-pv-primary" : "border-pv-border",
      )}
    >
      <button
        type="button"
        onClick={onActivate}
        aria-expanded={active}
        className="flex w-full cursor-pointer items-center gap-3 rounded-[22px] px-4 py-3.5 text-left outline-none focus-visible:ring-4 focus-visible:ring-pv-primary/20 sm:px-5"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 text-[12px] font-semibold",
                active ? "bg-pv-primary text-pv-primary-fg" : "bg-pv-muted text-pv-muted-fg",
              )}
            >
              {title}
            </span>
            <span className="truncate text-[13px] font-medium text-pv-muted-fg">{prettyDate(date)}</span>
          </span>
          {/* Closed, the card shows the time; open, the clock's own readout does. */}
          {!active ? (
            <span className="mt-1.5 block text-[22px] font-extrabold leading-none tracking-[-0.04em] tabular-nums text-pv-fg">
              {value ? formatClockLabel(value) : "—"}
            </span>
          ) : null}
        </span>
        {!active ? <ChevronDown aria-hidden className="size-4 shrink-0 text-pv-muted-fg" /> : null}
      </button>

      {active ? (
        <div className="qb-rise-in border-t border-pv-border px-4 pb-5 pt-4 sm:px-5">
          <Clock key={date} value={value} slots={slots} isOpen={isOpen} onChange={onChange} label={title} />
          {viewerTime ? <p className="mt-1 text-center text-[12px] text-pv-muted-fg">{viewerTime} where you are</p> : null}
        </div>
      ) : null}
    </section>
  );
}

/* ── the clock ─────────────────────────────────────────────────────────── */

/** Where the numbers sit, as a share of the face's radius. */
const RING = 0.78;

function Clock({
  value,
  slots,
  isOpen,
  onChange,
  label,
}: {
  value: string;
  slots: readonly string[];
  isOpen: (slot: string) => boolean;
  onChange: (slot: string) => void;
  label: string;
}) {
  const open = useMemo(() => new Set(slots.filter(isOpen)), [slots, isOpen]);
  const [mode, setMode] = useState<Mode>("hour");
  const face = useRef<HTMLDivElement>(null);
  /** The hour last aimed at by a drag, so letting go turns the face to the minutes. */
  const dragged = useRef(false);

  const hour = value ? hourOf(value) : 10;
  const minute = value ? minuteOf(value) : 0;
  const pm = hour >= 12;

  const hourOpen = (h24: number) => QUARTERS.some((m) => open.has(`${pad(h24)}:${pad(m)}`));
  const hasAm = Array.from({ length: 12 }, (_, h) => h).some(hourOpen);
  const hasPm = Array.from({ length: 12 }, (_, h) => h + 12).some(hourOpen);

  /** A new hour keeps the minutes when it can, else takes its first open quarter. */
  const pickHour = (h24: number) => {
    if (!hourOpen(h24)) return false;
    const keep = `${pad(h24)}:${pad(minute)}`;
    if (open.has(keep)) onChange(keep);
    else {
      const first = QUARTERS.map((m) => `${pad(h24)}:${pad(m)}`).find((slot) => open.has(slot));
      if (first) onChange(first);
    }
    return true;
  };
  const pickMinute = (m: number) => {
    const slot = `${pad(hour)}:${pad(m)}`;
    if (open.has(slot)) onChange(slot);
  };

  const flip = (toPm: boolean) => {
    if (toPm === pm) return;
    if (pickHour(toPm ? hour + 12 : hour - 12)) return;
    // That hour is closed on the other side of noon: the first open one there.
    const first = Array.from({ length: 12 }, (_, h) => h + (toPm ? 12 : 0)).find(hourOpen);
    if (first !== undefined) pickHour(first);
  };

  /** The pointer's angle on the face, in degrees clockwise from 12. */
  const angleAt = (x: number, y: number) => {
    const box = face.current?.getBoundingClientRect();
    if (!box) return null;
    const deg = (Math.atan2(y - box.top - box.height / 2, x - box.left - box.width / 2) * 180) / Math.PI + 90;
    return ((deg % 360) + 360) % 360;
  };
  const aim = (x: number, y: number) => {
    const deg = angleAt(x, y);
    if (deg === null) return;
    if (mode === "hour") {
      if (pickHour((Math.round(deg / 30) % 12) + (pm ? 12 : 0))) dragged.current = true;
    } else {
      pickMinute(QUARTERS[Math.round(deg / 90) % 4]);
    }
  };

  // The hand points at the number picked, not between hours as a wall clock's would.
  const hand = mode === "hour" ? (hour % 12) * 30 : minute * 6;
  const display12 = ((hour + 11) % 12) + 1;
  const hours = [...open].map(hourOf);
  const opening =
    slots.length > 0 && !(slots[0] === "00:00" && slots[slots.length - 1] >= "23:45")
      ? `Open ${formatClockLabel(slots[0])} – ${formatClockLabel(slots[slots.length - 1])}`
      : null;

  return (
    <div className="flex flex-col items-center">
      {/* The time: its hour and its minutes say which the face is showing. */}
      <div className="flex items-center gap-3">
        <div role="tablist" aria-label={`${label}: hour or minutes`} className="flex items-baseline text-[44px] font-extrabold leading-none tracking-[-0.04em] tabular-nums">
          <ReadoutTab selected={mode === "hour"} onClick={() => setMode("hour")} label="Hour">
            {display12}
          </ReadoutTab>
          <span aria-hidden className="px-0.5 text-pv-muted-fg/60">
            :
          </span>
          <ReadoutTab selected={mode === "minute"} onClick={() => setMode("minute")} label="Minutes">
            {pad(minute)}
          </ReadoutTab>
        </div>
        <div className="flex flex-col gap-1">
          {(["AM", "PM"] as const).map((half) => {
            const isPm = half === "PM";
            return (
              <button
                key={half}
                type="button"
                aria-pressed={pm === isPm}
                disabled={!(isPm ? hasPm : hasAm)}
                onClick={() => flip(isPm)}
                className={cn(
                  "h-7 w-12 cursor-pointer rounded-full text-[12px] font-bold transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-30 motion-reduce:transition-none",
                  pm === isPm ? "bg-pv-fg text-pv-card" : "bg-pv-muted text-pv-muted-fg hover:text-pv-fg",
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
        className="relative mt-4 aspect-square w-full max-w-[248px] touch-none select-none rounded-full bg-pv-muted"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          dragged.current = false;
          aim(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (event.buttons && event.currentTarget.hasPointerCapture(event.pointerId)) aim(event.clientX, event.clientY);
        }}
        onPointerUp={() => {
          if (mode === "hour" && dragged.current) setMode("minute");
          dragged.current = false;
        }}
      >
        {/* Ticks round the rim, and the hand. */}
        <svg aria-hidden viewBox="-50 -50 100 100" className="pointer-events-none absolute inset-0 size-full">
          {Array.from({ length: 60 }, (_, i) => {
            const a = (i * 6 * Math.PI) / 180;
            const long = i % 5 === 0;
            return (
              <line
                key={i}
                x1={47 * Math.sin(a)}
                y1={-47 * Math.cos(a)}
                x2={(long ? 43.5 : 45) * Math.sin(a)}
                y2={-(long ? 43.5 : 45) * Math.cos(a)}
                className="stroke-pv-muted-fg"
                strokeOpacity={long ? 0.4 : 0.18}
                strokeWidth={long ? 0.8 : 0.5}
                strokeLinecap="round"
              />
            );
          })}
          <g
            className="transition-transform duration-300 ease-[cubic-bezier(.34,1.4,.64,1)] motion-reduce:transition-none"
            style={{ transform: `rotate(${hand}deg)` }}
          >
            <line x1="0" y1="0" x2="0" y2={-RING * 50 + 7} className="stroke-pv-primary" strokeWidth="1.4" strokeLinecap="round" />
          </g>
          <circle r="2.4" className="fill-pv-primary" />
        </svg>

        {mode === "hour"
          ? Array.from({ length: 12 }, (_, i) => {
              const n = i + 1;
              const h24 = (n % 12) + (pm ? 12 : 0);
              const offered = hours.includes(h24);
              const selected = h24 === hour;
              return (
                <FaceNumber
                  key={`h${n}`}
                  angle={n * 30}
                  selected={selected}
                  disabled={!offered}
                  label={`${n} ${pm ? "PM" : "AM"}`}
                  onClick={() => {
                    if (pickHour(h24)) setMode("minute");
                  }}
                >
                  {n}
                </FaceNumber>
              );
            })
          : QUARTERS.map((m) => (
              <FaceNumber
                key={`m${m}`}
                angle={m * 6}
                selected={m === minute}
                disabled={!open.has(`${pad(hour)}:${pad(m)}`)}
                label={formatClockLabel(`${pad(hour)}:${pad(m)}`)}
                onClick={() => pickMinute(m)}
              >
                {pad(m)}
              </FaceNumber>
            ))}
      </div>

      <p className="mt-3 text-center text-[12px] leading-snug text-pv-muted-fg">
        {mode === "hour" ? "Tap or drag to the hour" : "Now pick the minutes"}
        {opening ? <span className="block">{opening}</span> : null}
      </p>
    </div>
  );
}

function ReadoutTab({ selected, onClick, label, children }: { selected: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "cursor-pointer rounded-xl px-1.5 py-1 outline-none transition-colors duration-200 focus-visible:ring-4 focus-visible:ring-pv-primary/20 motion-reduce:transition-none",
        selected ? "bg-pv-tint text-pv-primary" : "text-pv-fg hover:bg-pv-muted",
      )}
    >
      {children}
    </button>
  );
}

function FaceNumber({
  angle,
  selected,
  disabled,
  label,
  onClick,
  children,
}: {
  angle: number;
  selected: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const a = (angle * Math.PI) / 180;
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "absolute grid size-10 -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-[15px] font-semibold tabular-nums outline-none transition-colors duration-200 focus-visible:ring-4 focus-visible:ring-pv-primary/25 disabled:cursor-not-allowed motion-reduce:transition-none",
        selected ? "bg-pv-primary text-pv-primary-fg" : disabled ? "text-pv-muted-fg/35" : "text-pv-fg hover:bg-pv-card",
      )}
      style={{ left: `${50 + RING * 50 * Math.sin(a)}%`, top: `${50 - RING * 50 * Math.cos(a)}%` }}
    >
      {children}
    </button>
  );
}
