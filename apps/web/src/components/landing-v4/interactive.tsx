"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SignupPlan } from "@/lib/plans";
import { ArrowDown, ArrowRight, Check } from "lucide-react";
import { Laptop, Phone } from "./frames";
import { FLOWS } from "./screens/flows";
import { DashboardScreen } from "./screens/dashboard";
import { VerificationScreen } from "./screens/verification";
import { FinancesScreen } from "./screens/finances";
import { CalendarScreen } from "./screens/calendar";
import { InsightsScreen } from "./screens/insights";

/* ---------------------------------------------------------------------------
 * Page-wide effects: mark JS as on (so reveals never hide content without it),
 * fade sections in as they arrive, play the integrations wall's entrance,
 * and give the nav its hairline once scrolled.
 * Plain native scrolling — nothing here holds or hijacks the scroll.
 * ------------------------------------------------------------------------- */
export function LandingEffects() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".l4");
    if (!root) return;
    root.classList.add("js");
    const io = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }),
      { rootMargin: "0px 0px -6% 0px" },
    );
    root.querySelectorAll(".l4-rv").forEach((el) => io.observe(el));

    const nav = root.querySelector(".l4-nav");
    const onScroll = () => nav?.classList.toggle("scrolled", scrollY > 8);

    // the integrations wall plays its entrance as it comes within a third of a
    // screen of the viewport — before it is visible, so a fast scroll finds it
    // built — and resets once it is well away, so coming back plays it again (landing-v4.css)
    const ix = root.querySelector(".ix-field");
    const ixIo = new IntersectionObserver(
      ([e]) => e.target.classList.toggle("ix-on", e.isIntersecting),
      { rootMargin: "35% 0px 35% 0px" },
    );
    if (ix) ixIo.observe(ix);

    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    return () => {
      io.disconnect();
      ixIo.disconnect();
      removeEventListener("scroll", onScroll);
    };
  }, []);
  return null;
}

/** True while `ref` is at least partly on screen. */
function useOnScreen<T extends HTMLElement>(ref: React.RefObject<T | null>) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setOn(e.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return on;
}

/*
 * Auto-advance driven by the progress bar's own CSS animation: when the bar
 * finishes, the next item opens. Hovering or scrolling away pauses the bar, so
 * the timer and the bar can never drift apart.
 */
function Progress({ ms, paused, onDone }: { ms: number; paused: boolean; onDone: () => void }) {
  return (
    <span className="bar">
      <i
        style={{ ["--dur" as string]: `${ms}ms`, animationPlayState: paused ? "paused" : "running" }}
        onAnimationEnd={onDone}
      />
    </span>
  );
}

/* ---------------------------------------------------------------------------
 * Hero — DRIVE / 24⁄7 / Rent cars, cut by one diagonal into two halves that
 * slide apart as the page scrolls, opening onto the portal.
 *
 * Scroll-LINKED, never scroll-blocking: the hero is pinned (sticky) for the
 * first stretch of a normal scroll and --open follows the scroll position. v3
 * sealed the page until a wheel gesture played the doors, and a plain scroll
 * did nothing — the review's first complaint.
 *
 * Each half carries the full copy in its own colours and is clipped to its
 * side, so the words split cleanly along the cut. The right half's copy is
 * hidden from assistive tech and the keyboard; it is only the other colour.
 * ------------------------------------------------------------------------- */
/*
 * The copy is laid out three times on one grid: once in each half (the words
 * that split along the cut) and once on top (the paragraph and the buttons, on
 * a frosted card, so they read on both colours and are never cut in two). Each
 * layer hides what the others show, so all three line up exactly.
 */
function HeroCopy({ layer }: { layer: "l" | "r" | "front" }) {
  const tab = layer === "front" ? undefined : -1;
  return (
    <div className="stack" aria-hidden={layer === "r" || undefined}>
      <span className="word">DRIVE</span>
      <div className="num" aria-hidden="true">
        <span>24</span>
        <span />
        <span>7</span>
      </div>
      <div className="rest">
        {layer === "l" ? <h1>Rent cars while you sleep</h1> : <p className="h1">Rent cars while you sleep</p>}
        <div className="panel">
          <p className="lead">
            Your booking site, customer portal, driver checks, agreements, keys and payments, running on their own, day and night.
          </p>
          <div className="ctas">
            <a className="l4-btn lg primary" href="/strategy-call" tabIndex={tab}>
              Book a demo <ArrowRight />
            </a>
            <a className="l4-btn lg outline" href="#x-showcase" tabIndex={tab}>
              See the product
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SplitHero() {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      // fully open after 70% of a screen of scrolling; the rest of the pinned
      // stretch holds the portal on screen before the page moves on
      const p = Math.min(1, Math.max(0, -el.getBoundingClientRect().top / (innerHeight * 0.7)));
      el.style.setProperty("--open", p.toFixed(4));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    addEventListener("scroll", schedule, { passive: true });
    addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("scroll", schedule);
      removeEventListener("resize", schedule);
    };
  }, []);

  return (
    <section ref={ref} className="l4-split" id="top" aria-label="Drive247 — rent cars while you sleep">
      <div className="pin">
        <div className="under">
          <span className="l4-kick">One portal</span>
          <h2 className="l4-h2">Everything runs from here</h2>
          <div className="dev">
            <Laptop>
              <DashboardScreen />
            </Laptop>
          </div>
        </div>
        <div className="l4-door l">
          <HeroCopy layer="l" />
        </div>
        <div className="l4-door r">
          <HeroCopy layer="r" />
        </div>
        <div className="l4-front">
          <HeroCopy layer="front" />
        </div>
        <span className="cue" aria-hidden="true">
          <ArrowDown />
          Scroll to open
        </span>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * Bookings showcase — four real surfaces on a laptop, one tab each.
 * ------------------------------------------------------------------------- */
/*
 * The seven things Drive247 sells, in its own words (the live site's
 * PLATFORM_FEATURES, DASHBOARD_SLIDES and product showcase in lib/constants.ts
 * and sections/product-showcase.tsx), each on the real screen that does it.
 */
// The portal's own tabs, named as its sidebar names them, each showing that tab
// as a new tenant sees it (screens/*.tsx mirror the portal's v2 code).
const SHOW = [
  {
    t: "Dashboard",
    d: "Money in over the last 30 days, Trax's read on what needs you first, and the requests and to-dos waiting on you.",
    Screen: DashboardScreen,
  },
  {
    t: "Rentals",
    d: "Every car and every booking on one calendar, with blocked dates alongside.",
    Screen: CalendarScreen,
  },
  {
    t: "Customers",
    d: "Licence and selfie checked against each other, with a face-match score and the documents on file for every renter.",
    Screen: VerificationScreen,
  },
  {
    t: "Finances",
    d: "Every invoice and the payments against it, with saved cards charged automatically.",
    Screen: FinancesScreen,
  },
  {
    t: "Insights",
    d: "What you took in, what you spent and what you kept, and what a change in fleet, price or costs would do.",
    Screen: InsightsScreen,
  },
];

export function Showcase() {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useOnScreen(ref);
  const [i, setI] = useState(0);
  const [hover, setHover] = useState(false);
  const paused = hover || !visible;
  const tabs = useRef<HTMLDivElement>(null);

  // On a phone the tab row scrolls sideways: keep the open tab in its middle.
  // Only the row scrolls (scrollIntoView would move the page too).
  useEffect(() => {
    const row = tabs.current;
    const tab = row?.children[i] as HTMLElement | undefined;
    if (!row || !tab || row.scrollWidth <= row.clientWidth) return;
    row.scrollTo({ left: tab.offsetLeft - (row.clientWidth - tab.offsetWidth) / 2, behavior: "smooth" });
  }, [i]);

  return (
    <div ref={ref} className="l4-show l4-rv">
      {/* the tabs sit in one row above the screen, so the laptop gets the section's full width */}
      <div ref={tabs} className="l4-tabs" role="tablist" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        {SHOW.map((s, k) => (
          <button
            key={s.t}
            role="tab"
            aria-selected={k === i}
            className={`l4-tab${k === i ? " on" : ""}`}
            onClick={() => setI(k)}
          >
            {s.t}
            {k === i ? <Progress key={k} ms={1500} paused={paused} onDone={() => setI((k + 1) % SHOW.length)} /> : <span className="bar" />}
          </button>
        ))}
      </div>
      <p className="l4-show-d" aria-live="polite">{SHOW[i].d}</p>
      <div className="l4-stage">
        <div className="stack">
          {SHOW.map(({ t, Screen }, k) => (
            <div key={t} className={`pane${k === i ? " is-on" : ""}`} aria-hidden={k !== i}>
              <Laptop>
                <Screen />
              </Laptop>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * How it works — what renters do on their phone, flow by flow.
 *
 * A list of real renter flows (screens/flows/index.ts: each is a flow of the
 * ORIGINAL booking design every new tenant gets, drawn from its code) and one
 * phone that plays the chosen flow step by step. The steps run on the
 * progress bar's own clock (Progress); after a flow's last step the next flow
 * opens. Hovering the list, or scrolling away, pauses it.
 * ------------------------------------------------------------------------- */

const HALF = Math.ceil(FLOWS.length / 2);

export function FlowPicker({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const visible = useOnScreen(ref);
  const [f, setF] = useState(0);
  const [s, setS] = useState(0);
  const [hover, setHover] = useState(false);
  const paused = hover || !visible;
  const flow = FLOWS[f];
  const step = flow.steps[s];

  const choose = (k: number) => {
    setF(k);
    setS(0);
  };
  const next = () => {
    if (s + 1 < flow.steps.length) setS(s + 1);
    else choose((f + 1) % FLOWS.length);
  };

  // on a phone the list is a row that scrolls sideways: keep the open flow in its middle
  useEffect(() => {
    const row = list.current;
    const item = row?.children[f] as HTMLElement | undefined;
    if (!row || !item || row.scrollWidth <= row.clientWidth) return;
    row.scrollTo({ left: item.offsetLeft - (row.clientWidth - item.offsetWidth) / 2, behavior: "smooth" });
  }, [f]);

  return (
    <div ref={ref} className="l4-flows">
      <div className="l4-head l4-rv">{children}</div>
      {/* the phone in the middle, five flows either side of it (one sideways row on phones) */}
      <div className="l4-flows-stage l4-rv">
        <div ref={list} className="l4-flow-list" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
          {FLOWS.map((fl, k) => {
            const on = k === f;
            return (
              <button
                key={fl.id}
                type="button"
                className={`l4-flow${on ? " on" : ""}${k >= HALF ? " r" : ""}`}
                style={{ ["--row" as string]: (k % HALF) + 1 }}
                onClick={() => choose(k)}
                aria-pressed={on}
              >
                <span className="no">{String(k + 1).padStart(2, "0")}</span>
                <span className="tx">
                  <b>{fl.title}</b>
                  <span className="bl">{fl.blurb}</span>
                  {fl.note ? <small>{fl.note}</small> : null}
                </span>
                {/* the open flow's clock (invisible): when a step's time is up, the next one plays */}
                {on ? <Progress key={`${f}-${s}`} ms={step.ms} paused={paused} onDone={next} /> : null}
              </button>
            );
          })}
        </div>
        <div className="l4-flows-r">
          <div className="phone-col">
            {/* hiw-paused freezes the screens' own animations with the progress bar */}
            <div className={paused ? "hiw-paused" : undefined} style={{ display: "contents" }}>
              {/* a wide phone screen (480 design px across, vs the 390 default), so the screens read larger */}
              <Phone width={480}>
                <div key={flow.id} className="l4-flow-screen">
                  <flow.Screen step={s} />
                </div>
              </Phone>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Pricing — the real signup catalogue (signup_plans, via fetchSignupPlans),
 * so the page always quotes what checkout charges. Monthly only: that is the
 * only interval the catalogue and the edge functions support.
 * ------------------------------------------------------------------------- */
export function Pricing({ plans }: { plans: readonly SignupPlan[] }) {
  return (
    <>
      <div className="l4-head l4-rv">
        <span className="l4-kick">Pricing</span>
        <h2 className="l4-h2">Simple plans. No booking fees.</h2>
        <p className="l4-lead">One monthly price, sized to your fleet. Every plan gets the full platform.</p>
      </div>
      <div className="l4-plans-grid">
        {plans.map((p) => (
          <article key={p.id} className={`l4-card l4-plan l4-rv${p.highlighted ? " pop" : ""}`}>
            {p.highlighted ? <span className="l4-badge badge">Most popular</span> : null}
            <h3>{p.name}</h3>
            <p className="d">{p.tagline}</p>
            <div className="amt">
              <b>${p.priceUsd}</b>
              <span>/month</span>
            </div>
            <div className="bill">{p.fleetBand}</div>
            <ul>
              {p.bullets.map((x) => (
                <li key={x}>
                  <Check />
                  {x}
                </li>
              ))}
            </ul>
            <a className={`l4-btn lg ${p.highlighted ? "primary" : "outline"}`} href="/strategy-call">
              Get started
            </a>
          </article>
        ))}
      </div>
    </>
  );
}
