"use client";

import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import "./turo-story.css";

/*
 * The Turo story (Ghulam, 2026-11-10: "start with the Turo story, make it a bit dramatic", then
 * "put it all in here, five slides, the landing page is already long"). One dark, held screen
 * that tells the whole Turo part of the page in five slides as you scroll:
 *
 *   1 The story       one car, listed on Turo
 *   2 The cut         its month's $1,780, Turo's cut draining out, what that is a year
 *   3 The difference  Turo vs Drive247, side by side
 *   4 The way out     keep Turo, grow direct bookings beside it
 *   5 The first step  Turo Sync brings the Turo trips in; start a trial
 *
 * It replaces turo-section, beyond-turo and turo-sync-section on the page (their files stay).
 * What it must never say, so the page stays true (from beyond-turo.tsx):
 * - that Turo renters should be moved off Turo: direct renters come from your own channels;
 * - that Turo Sync is included or on general release: it is early access.
 *
 * The car: a Kia Telluride out 20 days a month at $89 a day = $1,780 a month. Turo keeps up to
 * 30% (its US plans let hosts keep 70%, 80% or 90%), so up to $534 a month, $6,408 a year.
 */
export const TELLURIDE = { car: "Kia Telluride", days: 20, rate: 89, gross: 1780, turoCut: 534 };
const KEPT = TELLURIDE.gross - TELLURIDE.turoCut;
const A_YEAR = TELLURIDE.turoCut * 12;

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

/* Slide 3: the two sides, row by row. */
const COMPARE = [
  ["Renters book on Turo", "Renters book on your own site"],
  ["Paid through Turo", "Paid into your own account"],
  ["The renters are Turo's", "The renters are yours"],
];

/* Slide 4: the same $10,000 of trips a month; only where they book changes. Turo keeps 20%. */
const TRIPS = 10_000;
const GROW = [
  { direct: 0, title: "Turo only" },
  { direct: 10, title: "Your own site" },
  { direct: 30, title: "Your own renters" },
  { direct: 50, title: "Half direct" },
];
const keptAt = (direct: number) => (TRIPS * (100 - direct) * 0.8) / 100 + (TRIPS * direct) / 100;

const RISE = GROW.map((g) => ({ ...g, keep: keptAt(g.direct) }));


const SLIDES = ["The story", "The cut", "The difference", "The way out", "The first step"];

/** A line whose words rise in one after another when its slide comes. */
function Words({ text, from = 0 }: { text: string; from?: number }) {
  return (
    <>
      {text.split(" ").map((w, i, all) => (
        <Fragment key={i}>
          <span className="tso-w" style={{ "--i": from + i } as CSSProperties}>
            {w}
          </span>
          {i < all.length - 1 ? " " : null}
        </Fragment>
      ))}
    </>
  );
}

/* Chrome's mark, drawn to its real geometry: three segments meeting on tangents round a white ring, the blue centre. */
export function ChromeLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 14L43.596 14A22 22 0 0 0 5.542 12.029L15.34 29L24 24Z" />
      <path fill="#34A853" d="M15.34 29L5.542 12.029A22 22 0 0 0 22.862 45.971L32.66 29L24 24Z" />
      <path fill="#FBBC04" d="M32.66 29L22.862 45.971A22 22 0 0 0 43.596 14L24 14L24 24Z" />
      <circle cx="24" cy="24" r="10" fill="#fff" />
      <circle cx="24" cy="24" r="8" fill="#1A73E8" />
    </svg>
  );
}

/* Safari's compass: the blue face, the ticks, the red and white needle. */
export function SafariLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden>
      <defs>
        <linearGradient id="tso-safari" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#19D7FF" />
          <stop offset="1" stopColor="#1E64F0" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="22" fill="#fff" />
      <circle cx="24" cy="24" r="20" fill="url(#tso-safari)" />
      {Array.from({ length: 24 }, (_, i) => (
        <line key={i} x1="24" y1="6" x2="24" y2={i % 6 === 0 ? 10 : 8} stroke="#fff" strokeOpacity="0.85" strokeWidth="0.8" transform={`rotate(${i * 15} 24 24)`} />
      ))}
      <path d="M24 24L36 12L26.2 26.2Z" fill="#FF3B30" />
      <path d="M24 24L12 36L21.8 21.8Z" fill="#fff" />
    </svg>
  );
}

type ChartPoint = { value: number; title: string; sub: string };

/**
 * The story's one chart, in two shapes: a rising `line` (what Turo takes as the fleet grows) or
 * `steps`, a staircase with one tread per stage (what you keep as direct bookings grow).
 * `drawn` plays it in: the shape reveals from the left, then its figures come up one by one.
 */
function StoryChart({ kind, points, min, max, drawn, tone, label }: { kind: "line" | "steps"; points: ChartPoint[]; min: number; max: number; drawn: boolean; tone: "red" | "indigo"; label: string }) {
  const n = points.length;
  const y = (v: number) => 100 - ((v - min) / (max - min)) * 100;
  // Line: points evenly across. Steps: each tread a quarter of the width, its figure at its middle.
  const at = (i: number) => (kind === "line" ? 6 + i * (88 / (n - 1)) : (i + 0.5) * (100 / n));
  const d =
    kind === "line"
      ? points.map((p, i) => `${i ? "L" : "M"}${at(i)} ${y(p.value)}`).join("")
      : points.map((p, i) => `${i ? `V${y(p.value)}` : `M0 ${y(p.value)}`}H${(i + 1) * (100 / n)}`).join("");
  const area = kind === "line" ? `${d}L${at(n - 1)} 100L${at(0)} 100Z` : `${d}V100H0Z`;
  const id = `tso-fill-${kind}`;
  return (
    <div className={`tso-chart is-${kind} is-${tone}${drawn ? " is-drawn" : ""}`}>
      <div className="tso-chart-plot" role="img" aria-label={label}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="currentColor" stopOpacity={kind === "steps" ? 0.28 : 0.32} />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path className="tso-chart-area" d={area} fill={`url(#${id})`} />
          <path className="tso-chart-line" d={d} />
        </svg>
        {points.map((p, i) => (
          <span key={p.title} className={`tso-dot${i === n - 1 ? " is-top" : ""}`} style={{ left: `${at(i)}%`, top: `${y(p.value)}%`, "--i": i } as CSSProperties}>
            <b>{money(p.value)}</b>
          </span>
        ))}
      </div>
      <ol className="tso-axis">
        {points.map((p, i) => (
          <li key={p.title} style={{ left: `${at(i)}%` }} className={kind === "line" && i === 0 ? "is-first" : kind === "line" && i === n - 1 ? "is-last" : ""}>
            {p.title}
            <small>{p.sub}</small>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Slide({ n, at, className = "", children }: { n: number; at: number; className?: string; children: ReactNode }) {
  return <div className={`tso-slide ${className}${at === n ? " is-on" : at > n ? " is-past" : ""}`}>{children}</div>;
}

export function TuroStory() {
  const track = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  // Steps inside a slide: 0, 1, 2 as you scroll through it.
  const [step, setStep] = useState(0);
  const [shown, setShown] = useState(TELLURIDE.gross);

  useEffect(() => {
    const el = track.current;
    const st = stage.current;
    if (!el || !st) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      const box = el.getBoundingClientRect();
      const run = box.height - innerHeight;
      const p = Math.min(1, Math.max(0, -box.top / run));
      st.style.setProperty("--p", p.toFixed(4));
      const f = Math.min(SLIDES.length - 0.0001, p * SLIDES.length);
      const sub = f - Math.floor(f);
      setAt(Math.floor(f));
      setStep(sub < 0.28 ? 0 : sub < 0.58 ? 1 : 2);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    return () => {
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  // The month's money: $1,780, then Turo's cut drains out of it.
  const cut = at > 1 || (at === 1 && step >= 1);
  useEffect(() => {
    const to = cut ? KEPT : TELLURIDE.gross;
    const from = shown;
    if (from === to) return;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 1400);
      setShown(from + (to - from) * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // `shown` is where it is now; only crossing into the cut starts a new count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cut]);

  /** Is this part of the current slide showing yet? */
  const by = (n: number, s: number) => (at > n || (at === n && step >= s) ? " is-in" : "");

  return (
    <section id="turo" className="tso" aria-labelledby="tso-title">
      <div ref={track} className="tso-track">
        <div ref={stage} className="tso-stage" data-slide={at} data-cut={cut || undefined}>
          <i className="tso-glow" aria-hidden />

          {/* 1 · The story */}
          <Slide n={0} at={at} className="is-words">
            <p className="tso-kicker">The Turo story</p>
            <h2 id="tso-title" className="tso-line">
              <Words text="It starts with one car." />
            </h2>
            <p className={`tso-line is-soft tso-later${by(0, 1)}`}>
              <Words text="You list it on Turo. The renters come." />
            </p>
          </Slide>

          {/* 2 · The cut: the month draining on the left; the year, fleet by fleet, on the right */}
          <Slide n={1} at={at} className="is-versus">
            <div className="tso-vs is-rise">
              <div className="tso-vs-col is-ours is-cut-col">
                <small>One {TELLURIDE.car}, one month</small>
                <b className={`tso-money${cut ? " is-cut" : ""}`}>{money(shown)}</b>
                <p className="tso-caption">
                  <span className={`tso-swap${!cut ? " is-on" : ""}`}>
                    Earned this month. {TELLURIDE.days} days out, at ${TELLURIDE.rate} a day.
                  </span>
                  <span className={`tso-swap${cut ? " is-on" : ""}`}>
                    Then Turo takes its cut. <em>Up to {money(TELLURIDE.turoCut)}</em>, gone. Every month.
                  </span>
                </p>
              </div>
              <div className={`tso-vs-col is-chart tso-later${cut ? " is-in" : ""}`}>
                <small>What Turo takes a year</small>
                <StoryChart
                  kind="line"
                  tone="red"
                  drawn={cut}
                  min={0}
                  max={A_YEAR * 10 * 1.15}
                  label={`Up to ${money(A_YEAR)} a year for one car, ${money(A_YEAR * 10)} for ten`}
                  points={[1, 3, 5, 10].map((cars) => ({ value: A_YEAR * cars, title: `${cars} ${cars === 1 ? "car" : "cars"}`, sub: `${money(TELLURIDE.turoCut * cars)} a month` }))}
                />
              </div>
            </div>
          </Slide>

          {/* 3 · The difference */}
          <Slide n={2} at={at} className="is-versus">
            <h3 className="tso-sr">Turo keeps up to 30%. Drive247 keeps 0%.</h3>
            <div className="tso-vs" aria-hidden>
              {(["turo", "ours"] as const).map((side) => (
                <div key={side} className={`tso-vs-col is-${side}${side === "ours" ? ` tso-later${by(2, 0)}` : ""}`} style={{ "--i": side === "ours" ? 5 : 0 } as CSSProperties}>
                  <small>{side === "turo" ? "Turo keeps up to" : "Drive247 keeps"}</small>
                  <b>{side === "turo" ? "30%" : "0%"}</b>
                  <ul>
                    {COMPARE.map((row) => (
                      <li key={row[0]}>{side === "turo" ? row[0] : row[1]}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Slide>

          {/* 4 · The way out: one figure, and the line it climbs */}
          <Slide n={3} at={at} className="is-versus">
            <div className="tso-vs is-rise">
              <div className="tso-vs-col is-ours">
                <small>Keep Turo. Grow beside it.</small>
                <b>+{money(keptAt(50) - keptAt(0))}</b>
                <p className="tso-rise-sub">
                  more a month from the same {money(TRIPS)} of trips, once half of them book on your own site. Your Turo trips stay on Turo.
                </p>
              </div>
              <div className="tso-vs-col is-chart">
                <small>What you keep a month</small>
                <StoryChart
                  kind="steps"
                  tone="indigo"
                  drawn={at === 3}
                  min={7600}
                  max={9300}
                  label={`From ${money(RISE[0].keep)} to ${money(RISE[3].keep)} a month as direct bookings grow to 50%`}
                  points={RISE.map((p) => ({ value: p.keep, title: p.title, sub: `${p.direct}% direct` }))}
                />
              </div>
            </div>
          </Slide>

          {/* 5 · The first step: the answer, on its own. Name first, then one line on what it does. */}
          <Slide n={4} at={at} className="is-finale">
            <p className="tso-kicker">So we built the fix</p>
            <span className="tso-reveal-logo">
              <ChromeLogo />
            </span>
            <h3 className="tso-reveal-name">Turo Sync</h3>
            <p className={`tso-reveal-what tso-later${by(4, 1)}`}>
              A Chrome extension that brings every Turo trip into Drive247, so your whole fleet runs on one calendar and nothing is booked twice.
            </p>
            <p className={`tso-reveal-soon tso-later${by(4, 1)}`} style={{ "--i": 4 } as CSSProperties}>
              <SafariLogo />
              Safari coming soon
            </p>
          </Slide>

          <ol className="tso-progress" aria-hidden>
            {SLIDES.map((s, i) => (
              <li key={s} className={i === at ? "is-on" : i < at ? "is-done" : ""}>
                <i />
                <span>{s}</span>
              </li>
            ))}
          </ol>
          {at === 0 && (
            <span className="tso-down" aria-hidden>
              <ChevronDown strokeWidth={1.75} />
            </span>
          )}
          {/* The lights coming up into the next section. */}
          <i className="tso-dawn" aria-hidden />
        </div>
      </div>
    </section>
  );
}

const NUMBER = ["One", "Two", "Three"];

/** "Chapter one · The cut": kept for the separate Turo sections, which are off the page for now. */
export function Chapter({ n, title, align = "center" }: { n: 1 | 2 | 3; title: ReactNode; align?: "center" | "left" }) {
  return (
    <p className={`ts-chapter${align === "left" ? " is-left" : ""}`}>
      <span>Chapter {NUMBER[n - 1]}</span>
      <i aria-hidden />
      <b>{title}</b>
    </p>
  );
}
