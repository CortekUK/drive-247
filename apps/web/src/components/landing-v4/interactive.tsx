"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SignupPlan } from "@/lib/plans";
import { ArrowDown, ArrowRight, Check } from "lucide-react";
import { Laptop, Phone } from "./frames";
import { PhoneVerifyScreen, VERIFY_MS } from "./screens/phone-verify";
import { PhoneSignScreen, SIGN_MS } from "./screens/phone-sign";
import { PhoneKeysScreen, KEYS_MS } from "./screens/phone-keys";
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

    // the integrations wall plays its entrance once a third of it is on screen,
    // and resets when it has left, so scrolling back to it plays it again (landing-v4.css)
    const ix = root.querySelector(".ix-field");
    const ixIo = new IntersectionObserver(
      ([e]) => {
        if (e.intersectionRatio >= 0.3) e.target.classList.add("ix-on");
        else if (!e.isIntersecting) e.target.classList.remove("ix-on");
      },
      { threshold: [0, 0.3] },
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

  return (
    <div ref={ref} className="l4-show l4-rv">
      <div className="l4-tabs" role="tablist" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        {SHOW.map((s, k) => (
          <button
            key={s.t}
            role="tab"
            aria-selected={k === i}
            className={`l4-tab${k === i ? " on" : ""}`}
            onClick={() => setI(k)}
          >
            {k === i ? <Progress key={k} ms={1500} paused={paused} onDone={() => setI((k + 1) % SHOW.length)} /> : <span className="bar" />}
            <span className="t">{s.t}</span>
            <span className="d">{s.d}</span>
          </button>
        ))}
      </div>
      <div>
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
 * Handover — the renter's phone: verify, sign, get the lockbox code.
 *
 * Every claim below is what the code does for an ordinary tenant (every tenant
 * but `northwind`, so every new signup, gets the ORIGINAL booking design —
 * apps/booking/src/lib/booking-design.ts, src/middleware.ts):
 *  1. MultiStepBookingWidget → create-ai-verification-session returns
 *     {booking site}/verify/{token}; AIVerificationQR shows it as a QR code
 *     (with a manual link). app/(legacy)/verify/[token]/page.tsx runs in the
 *     phone's browser: front of ID, back (optional), selfie. process-ai-
 *     verification: OpenAI reads the ID (ai-document-ocr), ai-face-match
 *     compares the selfie — ≥90% verified, 70–89% "Manual Review Required".
 *  2. InvoiceDialog "Continue to Sign Agreement" → /api/esign (BoldSign,
 *     DisableEmails) → send-signing-email: our "Rental Agreement Ready to
 *     Sign" email with a "Review and Sign" button. boldsign-webhook sets
 *     'completed'; portal/agreements/page.tsx shows Completed, Signed
 *     Document, and View / Download.
 *  3. notify-lockbox-code: default SMS "{tenant}: Your lockbox code is …
 *     Vehicle: … Address: … Do not share this code." via the tenant's Twilio
 *     number, sent when staff confirm a Lockbox handover
 *     (key-handover-section.tsx) or by send-lockbox-scheduled. Lockbox is
 *     opt-in (lockbox_enabled default false) and SMS must be one of
 *     lockbox_notification_methods (default ["email"]).
 * Each step lasts as long as its phone animation (min 1.5s).
 * ------------------------------------------------------------------------- */
const STEPS = [
  {
    b: "They prove who they are",
    s: "When they book, they scan a QR code and take a photo of their licence and a selfie. We check that the face matches the ID, and anything unclear comes to you to review.",
    by: "ID and face check",
    ms: VERIFY_MS,
  },
  {
    b: "They sign the rental agreement",
    s: "We email them the agreement to sign on their phone. Once it's signed, they can see it and download it in their account.",
    by: "E-signature by BoldSign",
    ms: SIGN_MS,
  },
  {
    b: "They get the key code by text",
    s: "If you use a lockbox, we text them the code, which car it is and the address. They collect the keys themselves.",
    by: "Sent from your Twilio number",
    ms: KEYS_MS,
  },
].map((s) => ({ ...s, ms: Math.max(1500, s.ms) }));

export function Handover({ children, after }: { children?: ReactNode; after?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useOnScreen(ref);
  const [i, setI] = useState(0);
  const [hover, setHover] = useState(false);
  const paused = hover || !visible;

  return (
    <div ref={ref} className="l4-hand">
      <div className="phone-col l4-rv">
        {/* hiw-paused freezes the phone's animation with the progress bar. On its own
            (display: contents) wrapper: LandingEffects adds `is-in` to .l4-rv by hand,
            and a changing className here would let React wipe it. */}
        <div className={paused ? "hiw-paused" : undefined} style={{ display: "contents" }}>
          <Phone>
            <PhoneVerifyScreen on={i === 0} />
            <PhoneSignScreen on={i === 1} />
            <PhoneKeysScreen on={i === 2} />
          </Phone>
        </div>
      </div>
      <div className="l4-rv">
        {children}
        <div className="l4-steps" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
          {STEPS.map((s, k) => (
            <button key={s.b} className={`l4-step${k === i ? " on" : ""}`} onClick={() => setI(k)}>
              <span className="n">{k + 1}</span>
              <span>
                <b>{s.b}</b>
                <span>{s.s}</span>
                <small>{s.by}</small>
              </span>
              {k === i ? <Progress key={k} ms={s.ms} paused={paused} onDone={() => setI((k + 1) % STEPS.length)} /> : null}
            </button>
          ))}
        </div>
        {after}
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
