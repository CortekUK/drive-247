"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Moon, Sun, Sunrise } from "lucide-react-nw";

import { formatClockLabel, localDateToIso } from "@nw/components/booking/time-utils";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@nw/components/ui/popover";
import { cn } from "@nw/lib/utils";

import type { QuickBook } from "./use-quick-book";

/**
 * The quick book's dates: a real month calendar — boxed days, weekends
 * shaded, today marked — that you DRAG across from the pickup day to the
 * return day. Pickup and return are circled in pen with their times under
 * them (tap a time to change it); the days between are shaded.
 * Tapping works too: tap the pickup, then the return; while a pickup is
 * waiting, hovering shows the range it would make. The rules (lead time,
 * minimum and maximum rental) live in `use-quick-book`.
 */

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dateOf(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function pretty(iso: string): string {
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
type Target = "pickup" | "return";

export function TripPicker({ qb }: { qb: QuickBook }) {
  const pickup = dateOf(qb.trip.pickupDate);
  const [view, setView] = useState({ year: pickup.getFullYear(), month: pickup.getMonth() });
  const [drag, setDrag] = useState<Drag | null>(null);
  /** A pickup tapped on its own, waiting for its return. */
  const [pending, setPending] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  /** Which time the pop-over by the chosen day is asking for, if any. */
  const [askTime, setAskTime] = useState<{ which: Target; thenReturn: boolean } | null>(null);

  const today = new Date();
  const canGoBack = view.year > today.getFullYear() || (view.year === today.getFullYear() && view.month > today.getMonth());
  const shift = (n: number) =>
    setView(({ year, month }) => {
      const d = new Date(year, month + n, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });

  const isBlocked = (iso: string) => qb.isPickupDateDisabled(dateOf(iso));

  // What the calendar paints: the drag in progress, a waiting pickup and the
  // day under the pointer, or the trip as it stands.
  const [from, to] = useMemo(() => {
    if (drag) return drag.anchor <= drag.current ? [drag.anchor, drag.current] : [drag.current, drag.anchor];
    if (pending) {
      const end = hover && hover > pending ? hover : pending;
      return [pending, end];
    }
    return [qb.trip.pickupDate, qb.trip.dropoffDate];
  }, [drag, pending, hover, qb.trip.pickupDate, qb.trip.dropoffDate]);

  const cellAt = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-iso]");
    const iso = el?.dataset.iso ?? null;
    return iso && !isBlocked(iso) ? iso : null;
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest("[data-time]")) return;
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
      // A dragged range: ask the pickup time, then the return time.
      qb.setTripRange(drag.anchor, drag.current);
      setPending(null);
      setAskTime({ which: "pickup", thenReturn: true });
    } else if (pending && drag.anchor > pending) {
      qb.setTripRange(pending, drag.anchor);
      setPending(null);
      setAskTime({ which: "return", thenReturn: false });
    } else {
      qb.startTripOn(drag.anchor);
      setPending(drag.anchor);
      setAskTime({ which: "pickup", thenReturn: false });
    }
    setDrag(null);
  };

  const weeks = monthWeeks(view.year, view.month);
  const todayIso = localDateToIso(today);
  const onToday = view.year === today.getFullYear() && view.month === today.getMonth();

  return (
    <div className="space-y-4">
      {/* A desk calendar: ring binding, the printed month band, the next
          pages peeking out below, and the trip marked on the page by hand. */}
      <div className="relative mx-1 pb-2 pt-2.5">
        <div aria-hidden className="absolute inset-x-4 bottom-0 top-6 rounded-[22px] border border-pv-border bg-pv-card" />
        <div aria-hidden className="absolute inset-x-2 bottom-1 top-4 rounded-[22px] border border-pv-border bg-pv-card" />

        {/* The wire rings, through the holes in the band. */}
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
          {/* The printed band, with the binding's holes along its top. */}
          <div className="relative flex items-center gap-2 bg-pv-primary px-4 pb-2.5 pt-4 text-pv-primary-fg sm:px-5">
            <div aria-hidden className="absolute inset-x-8 top-2 flex justify-between">
              {Array.from({ length: 12 }, (_, i) => (
                <span key={i} className={cn("size-2 rounded-full bg-black/25", i >= 8 && "hidden sm:block")} />
              ))}
            </div>
            <p key={`${view.year}-${view.month}`} className="qb-rise-in mr-auto flex items-baseline gap-2">
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
            {weeks.map((week, r) => {
              return (
                <div key={week[0]} className={cn("relative grid grid-cols-7", r > 0 && "border-t border-pv-border")}>
                  {week.map((iso, c) => {
                    const d = dateOf(iso);
                    const inMonth = d.getMonth() === view.month;
                    const blocked = isBlocked(iso);
                    const sunday = c === 6;
                    const isFrom = iso === from;
                    const isTo = iso === to && from !== to;
                    const inTrip = iso >= from && iso <= to;
                    return (
                      <div
                        key={iso}
                        data-iso={iso}
                        aria-label={pretty(iso)}
                        aria-disabled={blocked || undefined}
                        style={{ gridRow: 1, gridColumn: c + 1 }}
                        className={cn(
                          "relative flex flex-col px-1.5 sm:px-2",
                          "items-end pt-1",
                          weeks.length > 5 ? "h-[40px] sm:h-[44px]" : "h-[46px] sm:h-[52px]",
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
                            "relative inline-grid min-w-7 place-items-center whitespace-nowrap rounded-full px-1 text-[13px] font-bold tabular-nums sm:text-[15px]",
                            isFrom || isTo
                              ? "h-7 text-pv-primary"
                              : iso === todayIso
                                ? "h-7 bg-pv-fg text-pv-card"
                                : blocked || (!inMonth && !inTrip)
                                  ? "h-7 text-pv-muted-fg/40"
                                  : sunday
                                    ? "h-7 text-rose-500"
                                    : "h-7 text-pv-fg",
                          )}
                        >
                          {d.getDate() === 1 && !inMonth ? `1 ${SHORT_MONTHS[d.getMonth()]}` : d.getDate()}
                          {isFrom || isTo ? <PenLoop key={`${iso}-loop`} /> : null}
                        </span>
                        {askTime && ((askTime.which === "pickup" && isFrom) || (askTime.which === "return" && isTo)) ? (
                          <AskTime
                            qb={qb}
                            which={askTime.which}
                            iso={iso}
                            onDone={() => setAskTime(askTime.thenReturn ? { which: "return", thenReturn: false } : null)}
                            onClose={() => setAskTime(null)}
                          />
                        ) : null}
                        {isFrom || isTo ? (
                          <TimeButton
                            qb={qb}
                            which={isFrom ? "pickup" : "return"}
                            className="mt-auto mb-1 hidden whitespace-nowrap text-[9.5px] font-bold uppercase leading-none tracking-[0.04em] sm:inline-flex"
                          >
                            {isFrom ? "Pickup" : "Return"} {formatClockLabel(isFrom ? qb.trip.pickupTime : qb.trip.dropoffTime)}
                          </TimeButton>
                        ) : null}
                      </div>
                    );
                  })}

                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* On a phone the day boxes are too small for the times: they sit here. */}
      <div className="flex justify-center gap-5 text-[13px] font-semibold sm:hidden">
        <TimeButton qb={qb} which="pickup">Pickup {formatClockLabel(qb.trip.pickupTime)}</TimeButton>
        <TimeButton qb={qb} which="return">Return {formatClockLabel(qb.trip.dropoffTime)}</TimeButton>
      </div>

      <StatusLine qb={qb} pending={pending !== null} dragging={drag?.moved === true} />
    </div>
  );
}

/** Only while a choice is half made: what the next tap does. */
function StatusLine({ qb, pending, dragging }: { qb: QuickBook; pending: boolean; dragging: boolean }) {
  const text = dragging
    ? "Let go on your return day."
    : pending
      ? "Now tap your return day."
      : !qb.carsLoading && qb.cars.length === 0
        ? "Nothing is free those days. Try moving them."
        : null;
  return (
    <p key={text ?? "none"} className="qb-rise-in h-5 text-center text-[13px] text-pv-muted-fg">
      {text}
    </p>
  );
}

/** The pop-over that opens by a day you just chose, asking what time. */
function AskTime({
  qb,
  which,
  iso,
  onDone,
  onClose,
}: {
  qb: QuickBook;
  which: Target;
  iso: string;
  onDone: () => void;
  onClose: () => void;
}) {
  return (
    <Popover open onOpenChange={(open) => !open && onClose()}>
      <PopoverAnchor asChild>
        <span aria-hidden className="pointer-events-none absolute inset-0" />
      </PopoverAnchor>
      <PopoverContent
        side="bottom"
        align="center"
        sideOffset={6}
        collisionPadding={12}
        className="pv2-tokens qb-rise-in w-[min(360px,calc(100vw-1.5rem))] rounded-[28px] border-0 bg-pv-card p-0 text-pv-fg shadow-xl ring-1 ring-black/5"
      >
        <p className="px-5 pt-4 text-center text-[15px] font-semibold text-pv-fg">
          {which === "pickup" ? "Pickup time" : "Return time"}
          <span className="font-normal text-pv-muted-fg"> · {pretty(iso)}</span>
        </p>
        <TimeChips qb={qb} target={which} onDone={onDone} />
      </PopoverContent>
    </Popover>
  );
}

/** A time you can change: tap it, pick a time chip in the pop-over. */
function TimeButton({
  qb,
  which,
  className,
  children,
}: {
  qb: QuickBook;
  which: "pickup" | "return";
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          // Marked so a press here opens the times instead of starting a drag.
          data-time
          className={cn(
            "inline-flex cursor-pointer items-center gap-0.5 rounded-full text-pv-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30",
            className,
          )}
        >
          {children}
          <ChevronRight aria-hidden className="size-3 shrink-0 rotate-90" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        sideOffset={8}
        collisionPadding={12}
        className="pv2-tokens w-[min(360px,calc(100vw-1.5rem))] rounded-[28px] border-0 bg-pv-card p-0 text-pv-fg shadow-xl ring-1 ring-black/5"
      >
        <TimeChips qb={qb} target={which} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * A pen loop round the date, scribbled by hand: lopsided, tilted, gone round
 * twice with passes that don't agree, the ends crossing and sticking out.
 */
function PenLoop() {
  const pass = { fill: "none", stroke: "var(--pv-primary)", strokeLinecap: "round" as const, pathLength: 1 };
  return (
    <svg
      aria-hidden
      viewBox="0 0 100 70"
      className="qb-pen pointer-events-none absolute left-1/2 top-1/2 h-[30px] w-[44px] -translate-x-1/2 -translate-y-[54%] -rotate-6 overflow-visible"
    >
      {/* First pass: a lopsided egg, starting with a flick, overshooting
          well past where it began so the ends cross and stick out. */}
      <path {...pass} strokeWidth="4.6" d="M97 22 Q 93 17 88 14 C 74 2, 30 0, 12 14 C -4 27, 2 54, 26 63 C 50 72, 86 65, 96 46 C 104 30, 92 11, 68 6 C 54 3, 40 5, 26 12" />
      {/* Second pass: lighter, a few degrees off and a different size, so
          the two never quite agree. */}
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

/* ── times ──────────────────────────────────────────────────────────────── */

const PARTS_OF_DAY = [
  { key: "morning", label: "Morning", icon: Sunrise, test: (t: string) => t < "12:00" },
  { key: "afternoon", label: "Afternoon", icon: Sun, test: (t: string) => t >= "12:00" && t < "17:00" },
  { key: "evening", label: "Evening", icon: Moon, test: (t: string) => t >= "17:00" },
] as const;
type PartKey = (typeof PARTS_OF_DAY)[number]["key"];

const partOf = (time: string): PartKey => PARTS_OF_DAY.find((p) => p.test(time))?.key ?? "morning";

function TimeChips({ qb, target, onDone }: { qb: QuickBook; target: "pickup" | "return"; onDone: () => void }) {
  const time = target === "pickup" ? qb.trip.pickupTime : qb.trip.dropoffTime;
  const [dayPart, setDayPart] = useState<PartKey>(() => partOf(time));
  const slots = qb.rules.timeSlots.filter(PARTS_OF_DAY.find((p) => p.key === dayPart)!.test);

  return (
    <div className="p-4">
      <div className="flex justify-center gap-1">
        {PARTS_OF_DAY.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setDayPart(key)}
            aria-pressed={dayPart === key}
            className={cn(
              "inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-medium transition-all duration-200",
              dayPart === key ? "bg-pv-muted text-pv-fg" : "text-pv-muted-fg hover:text-pv-fg",
            )}
          >
            <Icon aria-hidden className="size-4" strokeWidth={2} />
            {label}
          </button>
        ))}
      </div>
      {slots.length === 0 ? (
        <p className="py-4 text-center text-[13px] text-pv-muted-fg">No times then. Try another part of the day.</p>
      ) : (
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {slots.map((slot) => (
            <button
              key={slot}
              type="button"
              aria-pressed={slot === time}
              onClick={() => {
                qb.updateTrip(target === "pickup" ? { pickupTime: slot } : { dropoffTime: slot });
                onDone();
              }}
              className={cn(
                "h-11 shrink-0 cursor-pointer rounded-full px-5 text-[14px] font-medium tabular-nums transition-all duration-200 ease-out active:scale-95",
                slot === time ? "qb-pop-text bg-pv-fg text-pv-card" : "bg-pv-card text-pv-fg ring-1 ring-pv-border hover:ring-pv-primary/50",
              )}
            >
              {formatClockLabel(slot)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

