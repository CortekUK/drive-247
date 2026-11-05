"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronsLeftRight } from "lucide-react";
import { useFadeIn } from "@/hooks/use-fade-in";
import { SIGNUP_PLANS, smallestPlanFor, type SignupPlan } from "@/lib/plans";
import "./turo-section.css";

/*
 * Turo's US earnings plans, from its own help centre, for plans available from January 7,
 * 2026 (checked 2026-11-05): hosts keep 70%, 80% or 90%. The example uses the middle one.
 */
const TURO_CUT = 20;
const TURO_SOURCE = "https://help.turo.com/en_us/earnings-plans-in-detail-us-hosts-ByMOIVxEc";

/* The two sides of the comparison, drawn on top of each other in the same layout. Their figures come from the visitor's own numbers. */
const SIDES = [
  {
    key: "turo",
    name: "On Turo",
    rows: [
      "On Turo's marketplace, beside other hosts' cars.",
      "Through Turo. Its gray market policy bars taking payment outside the platform.",
      "Turo can close your account. Your cars leave search right away, and trips more than 72 hours out are cancelled.",
    ],
  },
  {
    key: "ours",
    name: "On Drive247",
    rows: [
      "On your own booking site, on your own domain if you choose.",
      "Into your own Stripe or Square account, with your own deposits and extensions.",
      "No marketplace stands between you and your renters. Your customer records stay with your business.",
    ],
  },
];
const ROW_LABELS = ["Where renters book", "How you get paid", "If it all stops"];

/* An example fleet, growing over the same scroll: what it pays Turo grows, and our flat plan barely moves. */
const FLEET = { cars: [5, 50], perCar: [800, 1500] };

/*
 * Scrolling moves the divider from right to left while the panel holds on screen; moving across
 * the panel takes it wherever you like (a mouse only has to hover, touch drags, the keyboard
 * uses a slider). Scrolling then carries on from there rather than jumping back. The position
 * goes straight to the page rather than through state, as it changes on every frame.
 */
function useReveal(onProgress: (share: number) => void) {
  const track = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const motion = useRef({ target: 0, current: 0, frame: 0, still: false });

  const place = (share: number) => {
    panel.current?.style.setProperty("--tu-x", `${share}%`);
    panel.current?.toggleAttribute("data-full", share < 1.5);
    if (input.current) input.current.value = String(Math.round(share));
  };

  // Glides to the target, so a mouse coming in from far away doesn't make the divider jump.
  const moveTo = (share: number) => {
    const m = motion.current;
    m.target = share;
    if (m.still) {
      m.current = share;
      place(share);
      return;
    }
    if (m.frame) return;
    const tick = () => {
      m.current += (m.target - m.current) * 0.22;
      if (Math.abs(m.target - m.current) < 0.05) m.current = m.target;
      place(m.current);
      m.frame = m.current === m.target ? 0 : requestAnimationFrame(tick);
    };
    m.frame = requestAnimationFrame(tick);
  };

  const follow = (event: ReactPointerEvent<HTMLDivElement>) => {
    // The browser also reports a mouse "move" when the page scrolls under a still mouse.
    if (event.type === "pointermove" && event.pointerType === "mouse" && event.movementX === 0) return;
    const box = event.currentTarget.getBoundingClientRect();
    moveTo(Math.min(100, Math.max(0, ((event.clientX - box.left) / box.width) * 100)));
  };

  useEffect(() => {
    const el = panel.current;
    const rail = track.current;
    if (!el || !rail) return;
    const m = motion.current;
    m.still = matchMedia("(prefers-reduced-motion: reduce)").matches;

    // It starts in the panel's right padding, grip and all, so no words are cut, and ends with Drive247 filling the panel.
    const ends = () => {
      const pad = (parseFloat(getComputedStyle(el.querySelector(".tu-side")!).paddingLeft) / el.offsetWidth) * 60;
      return { right: 100 - pad, left: 0 };
    };
    const range = () => {
      const top = rail.getBoundingClientRect().top + scrollY;
      if (getComputedStyle(el).position === "sticky") {
        const start = top - parseFloat(el.style.top);
        return { start, end: start + innerHeight * 0.85 };
      }
      return { start: top - innerHeight * 0.8, end: top - innerHeight * 0.2 };
    };

    // Centred under the nav while it holds; a panel too tall for the screen doesn't hold.
    const fit = () => {
      const height = el.offsetHeight;
      el.classList.toggle("is-flow", height + 84 > innerHeight);
      el.style.top = getComputedStyle(el).position === "sticky" ? `${Math.max(84, (innerHeight + 33 - height) / 2)}px` : "";
    };
    fit();
    const size = new ResizeObserver(fit);
    size.observe(el);

    const start = ends().right;
    m.target = m.current = start;
    place(start);
    if (m.still) return () => size.disconnect();

    let last = scrollY;
    const onScroll = () => {
      const now = scrollY;
      const { start: from, end: to } = range();
      const { right, left } = ends();
      const clip = (y: number) => Math.min(to, Math.max(from, y));
      const moved = clip(now) - clip(last);
      if (moved !== 0) {
        const next = m.target - (moved / (to - from)) * (right - left);
        moveTo(now >= to ? left : now <= from ? right : Math.min(right, Math.max(left, next)));
      }
      last = now;
      onProgress((clip(now) - from) / (to - from));
    };
    onScroll();
    if (scrollY >= range().end) moveTo(ends().left);
    addEventListener("scroll", onScroll, { passive: true });
    return () => {
      size.disconnect();
      removeEventListener("scroll", onScroll);
      cancelAnimationFrame(m.frame);
      m.frame = 0;
    };
  }, []);

  return { track, panel, input, moveTo, follow };
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function TuroSection({ plans = SIGNUP_PLANS }: { plans?: readonly SignupPlan[] }) {
  const { ref, visible } = useFadeIn();
  const largest = Math.max(...plans.map((plan) => plan.maxVehicles));
  // Reduced motion doesn't scroll them, so it rests on an ordinary fleet.
  const [cars, setCars] = useState(Math.min(10, largest));
  const [perCar, setPerCar] = useState(1000);
  const reveal = useReveal((share) => {
    const [fewest, most] = FLEET.cars;
    const [low, high] = FLEET.perCar;
    setCars(Math.round(fewest + (Math.min(most, largest) - fewest) * share));
    setPerCar(Math.round((low + (high - low) * share) / 100) * 100);
  });

  const plan = smallestPlanFor(cars, plans) ?? plans[plans.length - 1];
  const turoCut = cars * perCar * (TURO_CUT / 100);
  const flat = plan.priceUsd;
  const saved = (turoCut - flat) * 12;
  const top = Math.max(turoCut, flat, 1);

  return (
    <section id="turo" aria-labelledby="turo-heading" className="tu-section">
      <div ref={ref} className={`tu-inner ${visible ? "fade-in-visible" : "fade-in-hidden"}`}>
        <div className="tu-head">
          <h2
            id="turo-heading"
            className="text-3xl font-bold tracking-tighter sm:text-4xl lg:text-[56px] lg:leading-[1.05]"
          >
            Turo keeps up to 30% of every trip. <span className="tu-accent">We keep 0%.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            Drive247 is a flat monthly price with no commission. Your renters book on your site, pay into your account
            and stay your customers.
          </p>
        </div>

        <div ref={reveal.track} className="tu-reveal-track">
        <div
          ref={reveal.panel}
          className="tu-reveal"
        >
          <div className="tu-reveal-stage" onPointerMove={reveal.follow} onPointerDown={reveal.follow}>
          {SIDES.map((side) => (
            <div key={side.key} className={`tu-side is-${side.key}`}>
              <div className="tu-side-lead">
                <p className="tu-side-name">{side.name}</p>
                <p className="tu-side-figure">{money(side.key === "turo" ? turoCut : flat)}</p>
                <p className="tu-side-caption">
                  {side.key === "turo" ? (
                    <>a month goes to Turo at a {TURO_CUT}% cut. That&apos;s {money(turoCut * 12)} a year, and it grows with you.</>
                  ) : (
                    <>
                      a month, flat, on the {plan.name} plan, with 0% commission.{" "}
                      {saved > 0 ? (
                        <>That&apos;s <b>{money(saved)}</b> more a year in your business.</>
                      ) : (
                        <>At this size Turo&apos;s cut is the smaller cost, until your fleet earns more.</>
                      )}
                    </>
                  )}
                </p>
              </div>
              <dl className="tu-side-rows">
                {side.rows.map((row, i) => (
                  <div key={ROW_LABELS[i]}>
                    <dt>{ROW_LABELS[i]}</dt>
                    <dd>{row}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
          <input
            ref={reveal.input}
            className="tu-reveal-input"
            type="range"
            min={0}
            max={100}
            defaultValue={95}
            aria-label="Compare Turo and Drive247: left shows more of Drive247, right shows more of Turo"
            onChange={(e) => reveal.moveTo(+e.target.value)}
          />
          <span className="tu-reveal-line" aria-hidden>
            <i>
              <ChevronsLeftRight strokeWidth={2.25} />
            </i>
          </span>
          </div>

          {/* The example the figures are worked out from. It grows as you scroll. */}
          <dl className="tu-example">
            <div>
              <dt>Cars in the fleet</dt>
              <dd>{cars}</dd>
            </div>
            <div>
              <dt>Monthly trip price per car</dt>
              <dd>{money(perCar)}</dd>
            </div>
            <div>
              <dt>Turo&apos;s cut</dt>
              <dd>{TURO_CUT}%</dd>
            </div>
          </dl>
        </div>
        <i className="tu-reveal-room" aria-hidden />
        </div>

        <p className="tu-honest">
          An example, before card fees, which Stripe or Square charge separately. Turo does bring you renters, and its plans include damage protection. With Drive247 you bring your own
          traffic and arrange your own cover, with Bonzah ready to connect.{" "}
          <a href={TURO_SOURCE} target="_blank" rel="noreferrer">
            Turo&apos;s US plan terms
          </a>
          , as of November 2026.
        </p>

        <p className="tu-motto">
          Your business. <span className="tu-accent">Driven forward.</span>
        </p>
      </div>
    </section>
  );
}
