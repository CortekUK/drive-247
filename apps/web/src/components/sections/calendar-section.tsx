"use client";

import { CalendarDays, Check, ChevronLeft, ChevronRight, FileSignature, Plus, Search, ShieldCheck, Wallet } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { TIP_AT } from "@/components/tour/tour-layout";
import { useReveal } from "./operations-dashboard";
import { SectionHeading } from "./section-heading";
import { TypedText } from "./typed-text";
import { BrowserChrome } from "./portal-glass";
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

type Bar = { from: number; span: number; who: string; state: "out" | "booked" | "pending" | "blocked" | "returning"; open?: boolean };
const ROWS: { car: string; plate: string; tone: string; bars: Bar[] }[] = [
  { car: "Kia Telluride", plate: "8XKR214", tone: "#4f44d8", bars: [{ from: 0, span: 3, who: "Noah Bennett", state: "returning" }, { from: 4, span: 5, who: "Mia Chen", state: "booked", open: true }, { from: 10, span: 3, who: "Daniel Okafor", state: "pending" }] },
  { car: "Tesla Model Y", plate: "7TSL903", tone: "#0e7490", bars: [{ from: 0, span: 6, who: "Liam Foster", state: "out" }, { from: 8, span: 6, who: "Emma Stone", state: "booked" }] },
  { car: "Ford Mustang", plate: "9FMG551", tone: "#c2410c", bars: [{ from: 1, span: 2, who: "Ava Morgan", state: "out" }, { from: 4, span: 2, who: "Owen Price", state: "booked" }, { from: 7, span: 4, who: "Sophia Martinez", state: "booked" }] },
  { car: "Jeep Wrangler", plate: "6JPW118", tone: "#15803d", bars: [{ from: 2, span: 7, who: "Priya Nair", state: "booked" }, { from: 11, span: 3, who: "James Carter", state: "pending" }] },
  { car: "Honda Civic", plate: "5HCV740", tone: "#be185d", bars: [{ from: 5, span: 2, who: "Service", state: "blocked" }, { from: 9, span: 4, who: "Marco Rossi", state: "booked" }] },
  { car: "Toyota RAV4", plate: "4TRV225", tone: "#a16207", bars: [{ from: 0, span: 4, who: "Chloe Adams", state: "out" }, { from: 6, span: 5, who: "Rosalind Achebe", state: "booked" }] },
];

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
  let step = 0;

  return (
    <section id="calendar" aria-labelledby="calendar-heading" className="cs-section">
      <div ref={ref} className={`cs-inner${visible ? " is-in" : ""}`}>
        <SectionHeading
          id="calendar-heading"
          title={
            <TypedText
              parts={[
                { text: "See every car, every booking and every return in " },
                { text: "one\u00a0calendar.", accent: true },
              ]}
            />
          }
          subClassName="cs-sub"
          sub="Your whole fleet on one timeline, by car, rental or customer. Spot the free days, see what goes out and comes back, and never double-book a car."
        />

        <div ref={tabletRef} className={`pg-tablet cs-tablet${lit ? " is-lit" : ""}`} aria-hidden>
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
                      <i
                        key={bar.who}
                        className={`cs-bar is-${bar.state}${bar.open ? " is-open" : ""}`}
                        style={{ "--cs-from": bar.from, "--cs-span": bar.span, "--cs-at": `${250 + step++ * 70}ms` } as CSSProperties}
                      >
                        {bar.state !== "blocked" && <span className="cs-avatar">{bar.who.split(" ").map((p) => p[0]).join("")}</span>}
                        {bar.who}
                      </i>
                    ))}
                  </span>
                </div>
              ))}
              <span className="cs-now" />
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
          </div>
          </BrowserChrome>
        </div>
        </div>

      </div>
    </section>
  );
}
