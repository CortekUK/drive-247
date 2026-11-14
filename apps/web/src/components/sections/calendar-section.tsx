"use client";

import { CalendarDays, Check, ChevronLeft, ChevronRight, FileSignature, Plus, Search, ShieldCheck, Wallet } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { TIP_AT } from "@/components/tour/tour-layout";
import { useReveal } from "./operations-dashboard";
import { Accent, SectionHeading } from "./section-heading";
import { BrowserChrome } from "./portal-glass";
import { CalendarSheet, type SheetBooking } from "./calendar-sheet";
import { CalloutBand, CalloutLeaders, type Callout } from "./calendar-callouts";
import "./calendar-section.css";

/*
 * The booking calendar, drawn after the portal's own (vehicle timeline, views, block dates,
 * weekend surcharge strip) with made-up rentals. One booking is open to show what a single
 * click gives you.
 */
const DAYS = Array.from({ length: 14 }, (_, i) => {
  const date = 9 + i;
  const name = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i % 7];
  return { name, date, weekend: i % 7 >= 5 };
});
const TODAY = 2;

type Bar = { from: number; span: number; who: string; state: "out" | "booked" | "pending" | "blocked" | "returning"; open?: boolean; note?: string };
/** Free days drawn as an empty slot, with a word on what they are. Shown on the sliding track only. */
type Free = { from: number; span: number; label: [title: string, line: string] };
const ROWS: { car: string; plate: string; tone: string; rate?: number; bars: Bar[]; free?: Free }[] = [
  { car: "Kia Telluride", rate: 89, plate: "8XKR214", tone: "#4f44d8", bars: [{ from: 0, span: 3, who: "Noah Bennett", state: "returning" }, { from: 4, span: 5, who: "Mia Chen", state: "booked", open: true, note: "Click any booking to open it" }, { from: 10, span: 3, who: "Daniel Okafor", state: "pending" }] },
  { car: "Tesla Model Y", rate: 109, plate: "7TSL903", tone: "#0e7490", bars: [{ from: 0, span: 6, who: "Liam Foster", state: "out", note: "Out with a renter now" }, { from: 8, span: 6, who: "Emma Stone", state: "booked" }] },
  { car: "Ford Mustang", rate: 129, plate: "9FMG551", tone: "#c2410c", bars: [{ from: 1, span: 2, who: "Ava Morgan", state: "out" }, { from: 4, span: 2, who: "Owen Price", state: "booked" }, { from: 7, span: 4, who: "Sophia Martinez", state: "booked" }], free: { from: 11, span: 3, label: ["Free days", "Open on your site"] } },
  { car: "Jeep Wrangler", rate: 99, plate: "6JPW118", tone: "#15803d", bars: [{ from: 2, span: 7, who: "Priya Nair", state: "booked" }, { from: 11, span: 3, who: "James Carter", state: "pending", note: "Waiting on payment" }] },
  { car: "Honda Civic", rate: 59, plate: "5HCV740", tone: "#be185d", bars: [{ from: 5, span: 2, who: "Service", state: "blocked", note: "In service, hidden from your site" }, { from: 9, span: 4, who: "Marco Rossi", state: "booked" }] },
  { car: "Toyota RAV4", rate: 79, plate: "4TRV225", tone: "#a16207", bars: [{ from: 0, span: 4, who: "Chloe Adams", state: "out" }, { from: 6, span: 5, who: "Rosalind Achebe", state: "booked" }] },
];

/* The labels, numbered in reading order (car by car), as the screen numbers them. On a phone
   the first two sit above the calendar and the rest below it (calendar-callouts.tsx). */
const CALLOUTS: (Callout & { car: string; who: string })[] = ROWS.flatMap((row) =>
  row.bars.filter((bar) => bar.note).map((bar) => ({ car: row.car, who: bar.who, note: bar.note! })),
).map((c, i) => ({ ...c, n: i + 1 }));
const CALLOUTS_BELOW_FROM = 3;
const calloutOf = (car: string, who: string) => CALLOUTS.find((c) => c.car === car && c.who === who)?.n;

/** The booking the docked sheet shows until another is clicked. */
const FIRST: SheetBooking = { who: "Mia Chen", car: "Kia Telluride", plate: "8XKR214", rate: 89, state: "booked", start: DAYS[4], days: 5 };
/** product-track.tsx MEDIA: where the track slides, and so where the sheet is docked. */
const DOCK_MEDIA = "(min-width: 1100px) and (min-height: 640px) and (prefers-reduced-motion: no-preference)";

const STATES = [
  ["out", "On rent"],
  ["returning", "Back today"],
  ["booked", "Booked"],
  ["pending", "Awaiting payment"],
  ["blocked", "Blocked"],
] as const;

const STATS = [
  ["5", "Out today"],
  ["1", "Back today"],
  ["14", "Bookings this fortnight"],
  ["78%", "Fleet booked"],
];

export function CalendarSection() {
  // The tablet's border turns the accent colour once the page line's tip reaches it.
  const tabletRef = useRef<HTMLDivElement>(null);
  const [lit, setLit] = useState(false);
  useEffect(() => {
    let frame = 0;
    const check = () => {
      frame = 0;
      const el = tabletRef.current;
      if (el) setLit(el.getBoundingClientRect().top <= innerHeight * TIP_AT);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    check();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    return () => {
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);
  const { ref, visible } = useReveal();
  // A click on any booking opens its sheet (calendar-sheet.tsx).
  const [sheet, setSheet] = useState<SheetBooking | null>(null);
  const closeSheet = useCallback(() => setSheet(null), []);
  // On the wide sliding track the sheet is part of the screen: always open, docked on the
  // right, and a click on a booking switches it (Ghulam, 2026-11-10: "it should always be like
  // this"). Anywhere else it opens over the page and closes again.
  const sectionRef = useRef<HTMLElement>(null);
  const [docked, setDocked] = useState(false);
  useEffect(() => {
    const media = matchMedia(DOCK_MEDIA);
    const check = () => setDocked(media.matches && !!sectionRef.current?.closest(".pt-panel"));
    check();
    media.addEventListener("change", check);
    return () => media.removeEventListener("change", check);
  }, []);
  /*
   * In the phone track's frame (track-embed.tsx): as each numbered label is read below the
   * screen, that label's booking opens in the sheet, the click the desktop visitor makes.
   */
  useEffect(() => {
    if (window.self === window.top) return;
    const onMessage = (event: MessageEvent<{ type?: string; n?: number }>) => {
      if (event.origin !== location.origin || event.data?.type !== "d247-track-focus") return;
      const callout = CALLOUTS.find((c) => c.n === event.data.n);
      const row = callout && ROWS.find((r) => r.car === callout.car);
      const bar = row?.bars.find((b) => b.who === callout?.who);
      if (!row || !bar) return;
      setSheet({ who: bar.who, car: row.car, plate: row.plate, rate: row.rate ?? 89, state: bar.state, start: DAYS[bar.from], days: bar.span });
    };
    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
  }, []);
  const shown = sheet ?? (docked ? FIRST : null);
  let step = 0;
  let label = 0;

  return (
    <section ref={sectionRef} id="calendar" aria-labelledby="calendar-heading" className={`cs-section${docked ? " has-sheet" : ""}`}>
      <div ref={ref} className={`cs-inner${visible ? " is-in" : ""}`}>
        <SectionHeading
          id="calendar-heading"
          title={
            <>
              See every car, every booking and every return in <Accent>one&nbsp;calendar.</Accent>
            </>
          }
          subClassName="cs-sub"
          sub="Your whole fleet on one timeline, by car, rental or customer. Spot the free days, see what goes out and comes back, and never double-book a car."
        />

        <CalloutBand side="top" items={CALLOUTS.filter((c) => c.n < CALLOUTS_BELOW_FROM)} />
        <div ref={tabletRef} className={`pg-tablet cs-tablet${lit ? " is-lit" : ""}`}>
          <i className="pg-tablet-camera" />
        <div className="cs-window">
          <BrowserChrome tab="Calendar · Your portal" url="northwind.portal.drive-247.com/rentals">
          <div className="cs-board">
            {/* Top bar */}
            <div className="cs-top">
              <span className="cs-title">
                <CalendarDays strokeWidth={2} />
                <b>November 9 to 22</b>
                <span className="cs-nav">
                  <ChevronLeft strokeWidth={2} />
                  <i>Today</i>
                  <ChevronRight strokeWidth={2} />
                </span>
              </span>
              <span className="cs-search">
                <Search strokeWidth={2} />
                Search cars or renters
              </span>
              <span className="cs-seg">
                <i className="is-on">Vehicle</i>
                <i>Rental</i>
                <i>Customer</i>
              </span>
              <span className="cs-seg">
                <i>Week</i>
                <i className="is-on">2 weeks</i>
                <i>Month</i>
              </span>
              <u>
                <Plus strokeWidth={2.4} />
                New booking
              </u>
            </div>

            {/* Today, at a glance */}
            <div className="cs-stats">
              {STATS.map(([n, label]) => (
                <span key={label}>
                  <b>{n}</b>
                  {label}
                </span>
              ))}
              <span className="cs-legend">
                {STATES.map(([state, label]) => (
                  <em key={state}>
                    <i className={`is-${state}`} />
                    {label}
                  </em>
                ))}
              </span>
            </div>

            <div className="cs-grid" style={{ "--cs-days": DAYS.length, "--cs-today": TODAY } as CSSProperties}>
              <span className="cs-corner">{ROWS.length} cars</span>
              <span className="cs-days">
                {DAYS.map((d, i) => (
                  <span key={d.date} className={`cs-day${i === TODAY ? " is-today" : ""}${d.weekend ? " is-weekend" : ""}`}>
                    <small>{d.name}</small>
                    <b>{d.date}</b>
                    {d.weekend && <em>+15%</em>}
                  </span>
                ))}
              </span>

              {ROWS.map((row) => (
                <div key={row.car} className="cs-row">
                  <span className="cs-car">
                    <i style={{ background: row.tone }}>{row.car[0]}</i>
                    <span>
                      <b>{row.car}</b>
                      <small>{row.plate}</small>
                    </span>
                  </span>
                  <span className="cs-lane">
                    {row.bars.map((bar) => (
                      <button
                        type="button"
                        key={bar.who}
                        className={`cs-bar is-${bar.state}${(shown ? shown.who === bar.who && shown.car === row.car : bar.open) ? " is-open" : ""}`}
                        style={{ "--cs-from": bar.from, "--cs-span": bar.span, "--cs-at": `${250 + step++ * 70}ms` } as CSSProperties}
                        aria-label={`${bar.who}, ${row.car}: open`}
                        data-callout={calloutOf(row.car, bar.who)}
                        onClick={() =>
                          setSheet({ who: bar.who, car: row.car, plate: row.plate, rate: row.rate ?? 89, state: bar.state, start: DAYS[bar.from], days: bar.span })
                        }
                      >
                        {bar.state !== "blocked" && <span className="cs-avatar">{bar.who.split(" ").map((p) => p[0]).join("")}</span>}
                        {bar.who}
                      </button>
                    ))}
                    {/* The screen's labels: a word under a booking, and the free days. */}
                    {row.bars
                      .filter((bar) => bar.note)
                      .map((bar) => (
                        <span
                          key={`note-${bar.who}`}
                          className={`cs-note is-${bar.state}${bar.from + bar.span > DAYS.length - 3 ? " is-left" : ""}`}
                          style={{ "--cs-from": bar.from, "--cs-span": bar.span } as CSSProperties}
                          aria-hidden
                          data-n={label + 1}
                        >
                          <span>
                            <i>{++label}</i>
                            <b>{bar.note}</b>
                          </span>
                        </span>
                      ))}
                    {row.free && (
                      <span className="cs-free" style={{ "--cs-from": row.free.from, "--cs-span": row.free.span } as CSSProperties} aria-hidden>
                        <b>{row.free.label[0]}</b>
                        <small>{row.free.label[1]}</small>
                      </span>
                    )}
                  </span>
                </div>
              ))}
              <span className="cs-now">
                <span className="cs-now-label" aria-hidden>Today</span>
              </span>
            </div>

            {/* One booking, opened */}
            <div className="cs-pop">
              <div className="cs-pop-head">
                <span className="cs-avatar is-big">MC</span>
                <span>
                  <b>Mia Chen</b>
                  <small>Kia Telluride · R-4f3bbe</small>
                </span>
                <em>Booked</em>
              </div>
              <div className="cs-pop-dates">
                <span>
                  <small>Pick-up</small>
                  Fri 13 · 10:00 AM
                </span>
                <span>
                  <small>Return</small>
                  Wed 18 · 10:00 AM
                </span>
              </div>
              <ul>
                <li>
                  <Wallet strokeWidth={2} />
                  Paid <b>$742.50</b>
                  <Check strokeWidth={3} />
                </li>
                <li>
                  <FileSignature strokeWidth={2} />
                  Agreement signed
                  <Check strokeWidth={3} />
                </li>
                <li>
                  <ShieldCheck strokeWidth={2} />
                  ID verified
                  <Check strokeWidth={3} />
                </li>
              </ul>
            </div>

            <div className="cs-cursor">
              <svg viewBox="0 0 24 24">
                <path d="M3 2.5 20.5 10l-7.4 2.3-3 7.2Z" />
              </svg>
              <span>
                <b>You</b>
                Checking Mia&apos;s booking
              </span>
            </div>
            {docked && <CalendarSheet booking={shown} onClose={closeSheet} docked />}
          </div>
          </BrowserChrome>
        </div>
        </div>
        <CalloutBand side="bottom" items={CALLOUTS.filter((c) => c.n >= CALLOUTS_BELOW_FROM)} />
        <CalloutLeaders rootRef={ref} count={CALLOUTS.length} bottomFrom={CALLOUTS_BELOW_FROM} />

      </div>
      {!docked && <CalendarSheet booking={sheet} onClose={closeSheet} />}
    </section>
  );
}
