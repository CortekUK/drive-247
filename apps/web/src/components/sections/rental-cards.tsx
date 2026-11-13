"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { FlowStory, type FlowTone } from "./verify-story";
import "./rental-cards.css";

/*
 * Four features in one held screen. The list stays on the left and the active one moves down
 * it as you scroll, while the real screen on the right changes to match.
 */
/* A point is one numbered step. `detail` is the line under it, shown while it is the step on screen. */
type Point = string | { title: string; detail: string };
const pointTitle = (point: Point) => (typeof point === "string" ? point : point.title);

const FEATURES: { tone: FlowTone; title: string; lead: string; points: Point[] }[] = [
  {
    tone: "verify",
    title: "ID verification",
    lead: "Know who's driving before you hand over the keys.",
    // The three steps the screen on the right walks through (verify-story.tsx), in order.
    points: [
      {
        title: "Your renter scans the code",
        detail: "They open Verification on your booking site and scan the QR code with their phone. No app to download.",
      },
      {
        title: "Licence and selfie on their phone",
        detail: "They photograph their driving licence, front and back, then take a selfie. It takes about a minute.",
      },
      {
        title: "Verified in your portal",
        detail: "The result lands on their record with the face match, so you know the keys are good to go.",
      },
    ],
  },
  {
    tone: "insurance",
    title: "Insurance",
    lead: "Keep every rental covered without chasing paperwork.",
    // Five steps, in the order the screen on the right walks through them (verify-story.tsx).
    points: [
      {
        title: "Turn on Bonzah from Integrations",
        detail: "Bonzah is built in. Start the application from your portal, and policies are paid from your Bonzah balance.",
      },
      {
        title: "Fill in the Bonzah form",
        detail: "Your business details, people and cover, signed in one place. You never leave your portal.",
      },
      {
        title: "Pick Bonzah cover on the rental",
        detail: "Choose the covers from Bonzah right on the rental. Each one is priced for the car and the dates.",
      },
      {
        title: "Bought from Bonzah in one click",
        detail: "The policy is issued straight away, and Bonzah's certificates are kept on the rental.",
      },
      {
        title: "Or Trax checks their own policy",
        detail: "Renters who are already insured upload their card. Trax reads it and checks the policy and the dates.",
      },
      {
        title: "Inshur fleet cover, coming soon",
        detail: "Cover for your cars between rentals, not just while they are out. Not available yet.",
      },
    ],
  },
  {
    tone: "agreements",
    title: "Agreements",
    lead: "Stop chasing signatures. Renters sign from their phone.",
    points: ["Sent from the rental", "Signed on their phone", "Signed copy kept on the rental"],
  },
  {
    tone: "payments",
    title: "Payments",
    lead: "Get paid into your own account, with no commission to us.",
    points: ["Full price before they pay", "Paid by card, deposit held", "Into your own account"],
  },
];

/*
 * Scroll given to each feature, and the steps its drawing walks through in that scroll:
 * one per point. The total weight sets the track's height in the CSS.
 */
const WEIGHTS = [2, 4, 2, 2];
/* Points per feature, for the phone's scene clock. */
const POINT_COUNTS = FEATURES.map((f) => f.points.length);
const STEPS = [3, 6, 3, 3];

/* Which of a feature's points its drawing is showing. */
const pointOf = (_feature: number, step: number) => step;

/* Keep in step with the media query in the CSS. */
const HOLD = "(min-width: 1000px) and (min-height: 640px) and (prefers-reduced-motion: no-preference)";
/*
 * Phones: each feature's screen sticks at the top of the screen while its steps scroll up
 * under it, and the step crossing just below the screen is the one the screen shows. The
 * held layout above, translated to one column. Keep in step with rental-cards.css.
 */
const PHONE = "(max-width: 767.98px)";

/*
 * On a phone, which step of each feature its screen is showing; null elsewhere. Scroll
 * drives it (user, 2026-11-12: "why aren't these changing as I scroll?"): from when the
 * feature's top reaches a third of the way down the screen until its bottom does, each step
 * gets an equal share of that travel, so every scene shows as you scroll past without any
 * extra empty room under the points. Tapping a point shows its scene until the next scroll.
 */
function usePhoneSteps(listRef: RefObject<HTMLOListElement | null>, counts: number[]) {
  const [steps, setSteps] = useState<number[] | null>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const phone = matchMedia(PHONE);
    let frame = 0;
    const paint = () => {
      frame = 0;
      if (!phone.matches) {
        setSteps(null);
        return;
      }
      const line = innerHeight / 3;
      const next = (Array.from(list.children).slice(0, counts.length) as HTMLElement[]).map((item, i) => {
        const box = item.getBoundingClientRect();
        if (box.height <= 0) return 0;
        const progress = Math.min(0.999, Math.max(0, (line - box.top) / box.height));
        return Math.floor(progress * counts[i]);
      });
      setSteps((prev) => (prev && prev.length === next.length && prev.every((v, k) => v === next[k]) ? prev : next));
    };
    const queue = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    paint();
    addEventListener("scroll", queue, { passive: true });
    addEventListener("resize", queue);
    phone.addEventListener("change", queue);
    return () => {
      removeEventListener("scroll", queue);
      removeEventListener("resize", queue);
      phone.removeEventListener("change", queue);
      cancelAnimationFrame(frame);
    };
  }, [listRef, counts]);

  const pick = (feature: number, step: number) => {
    setSteps((prev) => (prev ? prev.map((v, i) => (i === feature ? step : v)) : prev));
  };

  return { steps, pick };
}

function useActiveFeature(count: number) {
  const trackRef = useRef<HTMLElement>(null);
  const pinRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const liveRef = useRef<HTMLSpanElement>(null);
  const branchRef = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const hold = matchMedia(HOLD);

    let frame = 0;
    let lastKey = -1;
    let settleUntil = 0;
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
      const stepNow = Math.min(STEPS[index] - 1, Math.max(0, Math.floor(((at - before) / WEIGHTS[index]) * STEPS[index])));
      setActive(index);
      setStep(stepNow);

      /*
       * The page's thread, carried down the rail. Its tip keeps to 70% of the screen coming
       * in and going out, as it does everywhere else; while the section holds, it stops level
       * with the number of the step on screen, so the line and the filled circle meet.
       */
      const pin = pinRef.current;
      const list = listRef.current;
      const live = liveRef.current;
      if (pin && list && live) {
        const top = pin.getBoundingClientRect().top;
        const reach = innerHeight * 0.7 - top;
        /*
         * The rail runs down to the feature's first number and turns into it; from there the
         * steps' own line runs down through the numbers to the step on screen.
         */
        const item = list.children[index];
        const circles = item ? Array.from(item.querySelectorAll<HTMLElement>(".rc-step-n")) : [];
        const first = circles[0]?.getBoundingClientRect();
        const target = first ? first.top + first.height / 2 - top : list.offsetTop;
        const fill = done <= 0 ? Math.min(reach, target) : done < 1 ? target : Math.max(target, reach);
        live.style.height = `${Math.min(pin.offsetHeight, Math.max(0, fill))}px`;
        // Its tip goes once it has handed over to the next section, or there would be two.
        live.toggleAttribute("data-handed-over", fill >= pin.offsetHeight);

        // The turn into the first number, once the rail has reached it.
        const branch = branchRef.current;
        if (branch && first) {
          const railX = branch.parentElement!.getBoundingClientRect().left;
          branch.style.top = `${target}px`;
          branch.style.width = `${Math.max(0, first.left - railX)}px`;
          branch.toggleAttribute("data-on", fill >= target - 1);
          live.toggleAttribute("data-turned", fill >= target - 1 && done < 1);
        }

        // The steps' line, from the first number to the last, filled down to the step on screen.
        const steps = item?.querySelector<HTMLElement>(".rc-steps-line");
        if (steps && circles.length > 1) {
          const base = steps.parentElement!.getBoundingClientRect().top;
          const centre = (el: HTMLElement) => {
            const r = el.getBoundingClientRect();
            return r.top + r.height / 2 - base;
          };
          const c0 = centre(circles[0]);
          steps.style.top = `${c0}px`;
          steps.style.height = `${centre(circles[circles.length - 1]) - c0}px`;
          (steps.firstElementChild as HTMLElement).style.height = `${centre(circles[stepNow]) - c0}px`;
        }

        // The list opens and closes as the step changes, so follow the circle until it settles.
        const key = index * 10 + stepNow;
        if (key !== lastKey) {
          lastKey = key;
          settleUntil = performance.now() + 400;
        }
        if (performance.now() < settleUntil && !frame) frame = requestAnimationFrame(paint);
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    paint();
    // Fonts, screens and the opening steps can move the circles without a scroll.
    const resize = new ResizeObserver(onScroll);
    if (listRef.current) resize.observe(listRef.current);
    if (pinRef.current) resize.observe(pinRef.current);
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    hold.addEventListener("change", onScroll);
    return () => {
      resize.disconnect();
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

  return { trackRef, pinRef, listRef, liveRef, branchRef, active, step, goTo };
}

function Graphic({ feature, active, step }: { feature: (typeof FEATURES)[number]; active: boolean; step?: number }) {
  return <FlowStory tone={feature.tone} active={active} step={step} />;
}

export function RentalCards() {
  const { trackRef, pinRef, listRef, liveRef, branchRef, active, step, goTo } = useActiveFeature(FEATURES.length);
  const { steps: phoneSteps, pick: pickPhoneStep } = usePhoneSteps(listRef, POINT_COUNTS);

  return (
    <section ref={trackRef} aria-label="Everything around each rental" className="rc-track">
      <div ref={pinRef} className="rc-pin">
        <span className="rc-rail" aria-hidden>
          <span ref={liveRef} />
          <i ref={branchRef} className="rc-branch" />
        </span>
        <ol ref={listRef} className="rc-list">
          {FEATURES.map((feature, i) => {
            // The step lit in the list: the held screen's on desktop, the scrolled-to one on a phone.
            const lit = phoneSteps ? phoneSteps[i] : i === active ? pointOf(i, step) : -1;
            return (
            <li key={feature.tone} className={i === active ? "is-active" : ""}>
              <button type="button" aria-current={i === active} onClick={() => goTo(i)}>
                <h2>{feature.title}</h2>
              </button>
              <div className="rc-detail">
                <div>
                  <p>{feature.lead}</p>
                  <div className="rc-steps">
                  <span className="rc-steps-line" aria-hidden>
                    <span />
                  </span>
                  <ul>
                    {feature.points.map((point, p) => (
                      // The point its drawing is showing lights up; the ones the line has passed stay filled.
                      <li
                        key={pointTitle(point)}
                        className="rc-step"
                        data-on={p === lit ? "" : undefined}
                        data-done={p < lit ? "" : undefined}
                        onClick={phoneSteps ? () => pickPhoneStep(i, p) : undefined}
                      >
                        <span className="rc-step-n" aria-hidden>
                          {p + 1}
                        </span>
                        <span className="rc-step-body">
                          <span className="rc-step-title">
                            <span className="sr-only">Step {p + 1}: </span>
                            {pointTitle(point)}
                          </span>
                          {typeof point !== "string" && (
                            <span className="rc-step-detail">
                              <span>{point.detail}</span>
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                  </div>
                </div>
              </div>
              {/* Where the screen sits when the section does not hold still. */}
              <div className={`rc-panel rc-inline is-${feature.tone}`}>
                {/* Phones only: the heading and line again, so they stick with the screen as one
                    piece (rental-cards.css). Hidden from screen readers, which read the real ones. */}
                <div className="rc-phone-head" aria-hidden>
                  <p className="rc-phone-title">{feature.title}</p>
                  <p className="rc-phone-lead">{feature.lead}</p>
                </div>
                <Graphic feature={feature} active step={phoneSteps ? phoneSteps[i] : undefined} />
              </div>
            </li>
            );
          })}
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
