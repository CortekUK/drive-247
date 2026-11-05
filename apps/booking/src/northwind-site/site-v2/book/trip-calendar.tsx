"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react-nw";

import { formatClockLabel, localDateToIso } from "@nw/components/booking/time-utils";
import { cn } from "@nw/lib/utils";

import type { BookingFlow } from "./use-booking-flow";

/**
 * Step 1's calendar — the quick book's desk calendar (`quick-book/trip-picker`)
 * on the booking page. Drag from the pickup day to the return day, or tap one
 * then the other; pickup and return are circled in pen, the days between are
 * shaded. What changed from the dialog: choosing a day no longer opens a clock
 * over everything — it hands focus to the time picker beside the calendar
 * (`onPicked`), so the dates, the times and the overview all stay in view.
 */

export type TripEnd = "pickup" | "return";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function dateOf(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** "Thu 29 Oct". */
export function prettyDate(iso: string): string {
  const d = dateOf(iso);
  return `${SHORT_DAYS[d.getDay()]} ${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}`;
}

/** A month as whole weeks, Monday first, with the neighbouring months' days filled in. */
function monthWeeks(year: number, month: number): string[][] {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - ((first.getDay() + 6) % 7));
  const last = new Date(year, month + 1, 0);
  const weeks: string[][] = [];
  for (let d = new Date(start); d <= last || weeks.length === 0; ) {
    const week: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      week.push(localDateToIso(d));
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

type Drag = { anchor: string; current: string; moved: boolean };

export function TripCalendar({
  flow,
  onPicked,
  notice,
}: {
  flow: BookingFlow;
  onPicked: (end: TripEnd) => void;
  /** Said under the calendar while nothing is being picked, e.g. that no car is free. */
  notice?: string | null;
}) {
  const pickup = dateOf(flow.trip.pickupDate);
  const [view, setView] = useState({ year: pickup.getFullYear(), month: pickup.getMonth() });
  const [drag, setDrag] = useState<Drag | null>(null);
  /** A pickup tapped on its own, waiting for its return. */
  const [pending, setPending] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  const today = new Date();
  const canGoBack = view.year > today.getFullYear() || (view.year === today.getFullYear() && view.month > today.getMonth());
  const shift = (n: number) =>
    setView(({ year, month }) => {
      const d = new Date(year, month + n, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });

  const isBlocked = (iso: string) => flow.isPickupDateDisabled(dateOf(iso));

  const [from, to] = useMemo(() => {
    if (drag) return drag.anchor <= drag.current ? [drag.anchor, drag.current] : [drag.current, drag.anchor];
    if (pending) return [pending, hover && hover > pending ? hover : pending];
    return [flow.trip.pickupDate, flow.trip.dropoffDate];
  }, [drag, pending, hover, flow.trip.pickupDate, flow.trip.dropoffDate]);

  const cellAt = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-iso]");
    const iso = el?.dataset.iso ?? null;
    return iso && !isBlocked(iso) ? iso : null;
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const iso = cellAt(event.clientX, event.clientY);
    if (!iso) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ anchor: iso, current: iso, moved: false });
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const iso = cellAt(event.clientX, event.clientY);
    if (drag) {
      if (iso && iso !== drag.current) setDrag({ ...drag, current: iso, moved: drag.moved || iso !== drag.anchor });
    } else if (event.pointerType === "mouse") {
      setHover(iso);
    }
  };

  const onPointerUp = () => {
    if (!drag) return;
    if (drag.moved) {
      flow.setTripRange(drag.anchor, drag.current);
      setPending(null);
      onPicked("pickup");
    } else if (pending && drag.anchor > pending) {
      flow.setTripRange(pending, drag.anchor);
      setPending(null);
      onPicked("return");
    } else {
      flow.startTripOn(drag.anchor);
      setPending(drag.anchor);
      onPicked("pickup");
    }
    setDrag(null);
  };

  /** Keyboard: Enter on a day does what a tap does. */
  const onKeyDay = (iso: string) => {
    if (isBlocked(iso)) return;
    if (pending && iso > pending) {
      flow.setTripRange(pending, iso);
      setPending(null);
      onPicked("return");
    } else {
      flow.startTripOn(iso);
      setPending(iso);
      onPicked("pickup");
    }
  };

  const weeks = monthWeeks(view.year, view.month);
  const todayIso = localDateToIso(today);
  const onToday = view.year === today.getFullYear() && view.month === today.getMonth();
  const hint = drag?.moved
    ? "Let go on your return day"
    : pending
      ? "Now tap your return day"
      : (notice ?? "Tap your pickup day, or drag across your trip");

  return (
    <div>
      {/* A desk calendar: ring binding, the printed month band, the next
          pages peeking out below, and the trip marked on the page by hand. */}
      <div className="relative mx-1 pb-2 pt-2.5">
        <div aria-hidden className="absolute inset-x-4 bottom-0 top-6 rounded-[22px] border border-pv-border bg-pv-card" />
        <div aria-hidden className="absolute inset-x-2 bottom-1 top-4 rounded-[22px] border border-pv-border bg-pv-card" />

        <div aria-hidden className="absolute inset-x-9 top-0 z-10 flex justify-between">
          {Array.from({ length: 12 }, (_, i) => (
            <span
              key={i}
              className={cn(
                "h-[18px] w-2 rounded-full bg-gradient-to-r from-zinc-300 via-zinc-100 to-zinc-400 ring-1 ring-zinc-400/70",
                i >= 8 && "hidden sm:block",
              )}
            />
          ))}
        </div>

        <div className="relative overflow-hidden rounded-[22px] border border-pv-border bg-pv-card">
          <div className="relative flex items-center gap-2 bg-pv-primary px-4 pb-2.5 pt-4 text-pv-primary-fg sm:px-5">
            <div aria-hidden className="absolute inset-x-8 top-2 flex justify-between">
              {Array.from({ length: 12 }, (_, i) => (
                <span key={i} className={cn("size-2 rounded-full bg-black/25", i >= 8 && "hidden sm:block")} />
              ))}
            </div>
            <p key={`${view.year}-${view.month}`} aria-live="polite" className="qb-rise-in mr-auto flex items-baseline gap-2">
              <span className="text-[19px] font-extrabold uppercase tracking-[0.12em] sm:text-[21px]">{MONTHS[view.month]}</span>
              <span className="text-[14px] font-medium opacity-75">{view.year}</span>
            </p>
            <button
              type="button"
              disabled={onToday}
              onClick={() => setView({ year: today.getFullYear(), month: today.getMonth() })}
              className="h-8 cursor-pointer rounded-full bg-white/15 px-3.5 text-[13px] font-medium transition-colors duration-200 hover:bg-white/25 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-white/15"
            >
              Today
            </button>
            <NavButton label="Earlier month" disabled={!canGoBack} onClick={() => shift(-1)}>
              <ChevronLeft aria-hidden className="size-4" />
            </NavButton>
            <NavButton label="Later month" onClick={() => shift(1)}>
              <ChevronRight aria-hidden className="size-4" />
            </NavButton>
          </div>

          <div className="grid grid-cols-7 border-b border-pv-border">
            {WEEKDAYS.map((w, i) => (
              <span
                key={w}
                className={cn(
                  "py-1.5 text-center text-[11px] font-bold uppercase tracking-[0.1em]",
                  i === 6 ? "text-rose-500" : "text-pv-muted-fg",
                )}
              >
                {w}
              </span>
            ))}
          </div>

          <div
            className="touch-none select-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => setDrag(null)}
            onPointerLeave={() => setHover(null)}
          >
            {weeks.map((week, r) => (
              <div key={week[0]} className={cn("grid grid-cols-7", r > 0 && "border-t border-pv-border")}>
                {week.map((iso, c) => {
                  const d = dateOf(iso);
                  const inMonth = d.getMonth() === view.month;
                  const blocked = isBlocked(iso);
                  const isFrom = iso === from;
                  const isTo = iso === to && from !== to;
                  const inTrip = iso >= from && iso <= to;
                  return (
                    <div
                      key={iso}
                      data-iso={iso}
                      role="button"
                      tabIndex={blocked ? -1 : 0}
                      aria-label={`${prettyDate(iso)}${isFrom ? ", pickup" : isTo ? ", return" : ""}`}
                      aria-disabled={blocked || undefined}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onKeyDay(iso);
                        }
                      }}
                      className={cn(
                        "relative flex flex-col items-end px-1.5 pt-1 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-pv-primary/40 sm:px-2",
                        weeks.length > 5 ? "h-[44px] sm:h-[52px]" : "h-[50px] sm:h-[60px]",
                        c > 0 && "border-l border-pv-border",
                        inTrip
                          ? "cursor-pointer bg-pv-primary/10"
                          : blocked
                            ? "bg-[repeating-linear-gradient(135deg,transparent_0_6px,var(--pv-muted)_6px_7px)]"
                            : "cursor-pointer hover:bg-pv-muted/50",
                      )}
                    >
                      <span
                        className={cn(
                          "relative inline-grid h-7 min-w-7 place-items-center whitespace-nowrap rounded-full px-1 text-[13px] font-bold tabular-nums sm:text-[15px]",
                          isFrom || isTo
                            ? "text-pv-primary"
                            : iso === todayIso
                              ? "bg-pv-fg text-pv-card"
                              : blocked || (!inMonth && !inTrip)
                                ? "text-pv-muted-fg/40"
                                : c === 6
                                  ? "text-rose-500"
                                  : "text-pv-fg",
                        )}
                      >
                        {d.getDate() === 1 && !inMonth ? `1 ${SHORT_MONTHS[d.getMonth()]}` : d.getDate()}
                        {isFrom || isTo ? <PenLoop key={`${iso}-loop`} /> : null}
                      </span>
                      {(isFrom || isTo) && !drag && !pending ? (
                        <span className="mb-1 mt-auto hidden whitespace-nowrap text-[9.5px] font-bold uppercase leading-none tracking-[0.04em] text-pv-primary sm:block">
                          {isFrom ? "Pickup" : "Return"} {formatClockLabel(isFrom ? flow.trip.pickupTime : flow.trip.dropoffTime)}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <p key={hint} className={cn("qb-rise-in mt-2 text-center text-[13px]", hint === notice ? "font-medium text-pv-warning" : "text-pv-muted-fg")}>
        {hint}
      </p>
    </div>
  );
}

/** A pen loop round the date, scribbled by hand (the quick book's). */
function PenLoop() {
  const pass = { fill: "none", stroke: "var(--pv-primary)", strokeLinecap: "round" as const, pathLength: 1 };
  return (
    <svg
      aria-hidden
      viewBox="0 0 100 70"
      className="qb-pen pointer-events-none absolute left-1/2 top-1/2 h-[30px] w-[44px] -translate-x-1/2 -translate-y-[54%] -rotate-6 overflow-visible"
    >
      <path {...pass} strokeWidth="4.6" d="M97 22 Q 93 17 88 14 C 74 2, 30 0, 12 14 C -4 27, 2 54, 26 63 C 50 72, 86 65, 96 46 C 104 30, 92 11, 68 6 C 54 3, 40 5, 26 12" />
      <path {...pass} strokeWidth="2.8" opacity=".6" d="M10 26 C 18 8, 60 -3, 86 10 C 103 20, 100 50, 78 61 C 55 71, 17 67, 5 49 C -3 36, 3 21, 21 13 L 30 9" transform="rotate(-5 50 35)" />
    </svg>
  );
}

function NavButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="relative z-10 inline-flex size-8 cursor-pointer items-center justify-center rounded-full bg-white/15 transition-transform duration-200 hover:scale-105 hover:bg-white/25 active:scale-95 disabled:cursor-default disabled:opacity-30 disabled:hover:scale-100"
    >
      {children}
    </button>
  );
}
