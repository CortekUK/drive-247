"use client";

import { useEffect, useRef, useState } from "react";
import { VerifyArt } from "./verify-art";
import { FeatureArt, type ArtTone } from "./feature-art";
import "./rental-cards.css";

/*
 * Four features in one held screen. The list stays on the left and the active one moves down
 * it as you scroll, while the real screen on the right changes to match.
 */
const FEATURES: { tone: "verify" | ArtTone; title: string; lead: string; points: string[] }[] = [
  {
    tone: "verify",
    title: "ID verification",
    lead: "Know who's driving before you hand over the keys.",
    points: ["Licence, front and back", "Selfie matched to the photo", "Verdict on their record"],
  },
  {
    tone: "insurance",
    title: "Insurance",
    lead: "Keep every rental covered without chasing paperwork.",
    points: ["Per-rental cover through Bonzah", "Or renters upload their own", "Every policy in one list"],
  },
  {
    tone: "agreements",
    title: "Agreements",
    lead: "Stop chasing signatures. Renters sign from their phone.",
    points: ["Your own templates", "Sent for e-signature", "Signed copy kept on the rental"],
  },
  {
    tone: "payments",
    title: "Payments",
    lead: "Get paid into your own account, with no commission to us.",
    points: ["Your own Stripe or Square", "Deposits held on their card", "See what you actually kept"],
  },
];

/*
 * Scroll given to each feature, and the steps its drawing walks through in that scroll:
 * ID verification has five (front, back, selfie, checks, verified), the others one per
 * point. The total weight sets the track's height in the CSS.
 */
const WEIGHTS = [3, 2, 2, 2];
const STEPS = [5, 3, 3, 3];

/* Which of a feature's points its drawing is showing. */
const pointOf = (feature: number, step: number) => (feature === 0 ? (step <= 1 ? 0 : step === 2 ? 1 : 2) : step);

/* Keep in step with the media query in the CSS. */
const HOLD = "(min-width: 1000px) and (min-height: 640px) and (prefers-reduced-motion: no-preference)";

function useActiveFeature(count: number) {
  const trackRef = useRef<HTMLElement>(null);
  const pinRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const liveRef = useRef<HTMLSpanElement>(null);
  const [active, setActive] = useState(0);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const hold = matchMedia(HOLD);

    let frame = 0;
    const paint = () => {
      frame = 0;
      if (!hold.matches) return;
      const room = track.offsetHeight - innerHeight;
      const done = room > 0 ? Math.min(1, Math.max(0, -track.getBoundingClientRect().top / room)) : 0;
      const total = WEIGHTS.reduce((sum, weight) => sum + weight, 0);
      const at = done * total;
      let index = 0;
      let before = 0;
      while (index < count - 1 && at >= before + WEIGHTS[index]) before += WEIGHTS[index++];
      setActive(index);
      setStep(Math.min(STEPS[index] - 1, Math.max(0, Math.floor(((at - before) / WEIGHTS[index]) * STEPS[index]))));

      /*
       * The page's thread, carried down the rail. Its tip keeps to 70% of the screen coming
       * in and going out, as it does everywhere else; while the section holds, it walks
       * down the list with the headings.
       */
      const pin = pinRef.current;
      const list = listRef.current;
      const live = liveRef.current;
      if (pin && list && live) {
        const top = pin.getBoundingClientRect().top;
        const reach = innerHeight * 0.7 - top;
        const start = list.offsetTop;
        const end = start + list.offsetHeight;
        const fill = done <= 0 ? Math.min(reach, start) : done < 1 ? start + (end - start) * done : Math.max(end, reach);
        live.style.height = `${Math.min(pin.offsetHeight, Math.max(0, fill))}px`;
        // Its tip goes once it has handed over to the next section, or there would be two.
        live.toggleAttribute("data-handed-over", fill >= pin.offsetHeight);
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    paint();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    hold.addEventListener("change", onScroll);
    return () => {
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
      hold.removeEventListener("change", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [count]);

  const goTo = (i: number) => {
    const track = trackRef.current;
    if (!track || !matchMedia(HOLD).matches) return;
    const room = track.offsetHeight - innerHeight;
    const total = WEIGHTS.reduce((sum, weight) => sum + weight, 0);
    const before = WEIGHTS.slice(0, i).reduce((sum, weight) => sum + weight, 0);
    // Just inside the feature, so ID verification opens on its first step.
    scrollTo({ top: track.getBoundingClientRect().top + scrollY + (room * (before + 0.05)) / total, behavior: "smooth" });
  };

  return { trackRef, pinRef, listRef, liveRef, active, step, goTo };
}

function Graphic({ feature, active, step }: { feature: (typeof FEATURES)[number]; active: boolean; step?: number }) {
  if (feature.tone === "verify") return <VerifyArt active={active} step={step} />;
  return <FeatureArt tone={feature.tone} active={active} step={step} />;
}

export function RentalCards() {
  const { trackRef, pinRef, listRef, liveRef, active, step, goTo } = useActiveFeature(FEATURES.length);

  return (
    <section ref={trackRef} aria-label="Everything around each rental" className="rc-track">
      <div ref={pinRef} className="rc-pin">
        <span className="rc-rail" aria-hidden>
          <span ref={liveRef} />
        </span>
        <ol ref={listRef} className="rc-list">
          {FEATURES.map((feature, i) => (
            <li key={feature.tone} className={i === active ? "is-active" : ""}>
              <button type="button" aria-current={i === active} onClick={() => goTo(i)}>
                <h2>{feature.title}</h2>
              </button>
              <div className="rc-detail">
                <div>
                  <p>{feature.lead}</p>
                  <ul>
                    {feature.points.map((point, p) => (
                      // The point its drawing is showing lights up.
                      <li key={point} data-on={i === active && p === pointOf(i, step) ? "" : undefined}>
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              {/* Where the screen sits when the section does not hold still. */}
              <div className={`rc-panel rc-inline is-${feature.tone}`}>
                <Graphic feature={feature} active />
              </div>
            </li>
          ))}
        </ol>

        <div className="rc-stage">
          {FEATURES.map((feature, i) => (
            <div key={feature.tone} className={`rc-panel is-${feature.tone}${i === active ? " is-active" : ""}`} aria-hidden={i !== active}>
              {/* Ready before its turn, so a screen never arrives blank. */}
              <Graphic feature={feature} active={i === active} step={i === active ? step : 0} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
