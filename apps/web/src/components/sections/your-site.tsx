"use client";

import { openBookDemo } from "@/components/book-demo/book-demo-dialog";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type RefObject } from "react";
import { ArrowRight, Check, RotateCcw } from "lucide-react";

import { slugAvailabilityAnon } from "@/components/onboarding/onboarding-api";
import { saveSignupPrefill } from "@/lib/signup-prefill";
import { SITE_COLOURS, SITE_TEMPLATES, setSiteColour, setSiteName, setSiteTemplate, useSitePreview } from "@/lib/site-preview";
import { checkSlugShape, deriveSlugFromCompanyName, FIELD_MAX } from "@/lib/signup-validation";
import { BookingDemoStage, JOURNEY_STEPS, type DemoJourney, type DemoView } from "./booking-demo";
import { demoArrowX } from "./demo-intro";
import { LINE_MEDIA } from "./launch-section";
import { useReveal } from "./operations-dashboard";
import { Accent } from "./section-heading";
import "./your-site.css";

/*
 * Your booking site, in one section and on ONE SCREEN (Ghulam, 2026-11-10). It used to be
 * three sections: pick a template and colour, type your name, then try a demo, each with its
 * own browser window showing the same site. Now there is one window and it is the working one:
 *
 *   left   (about 75%) the demo (booking-demo.tsx), which wears your choices as you make them;
 *   right  (about 25%) the setup, top to bottom: your name, your colour, your template
 *          (lib/site-preview holds them), then the demo's four screens as cards, then
 *          the way in to signup.
 *
 * On a wide screen the section is exactly one screen tall. The demo's window is laid out at a
 * fixed design width and scaled to the space it gets, so its own layout never has to squeeze.
 * On a narrow or short screen the two parts stack and the page scrolls as usual.
 *
 * The name's address is checked for real, with the same one-row lookup the signup's own
 * web-address field uses. "Start free trial" carries the name to the plans, and the signup
 * opens with it already in the business field. Nothing else is saved or sent.
 */

const SAMPLE_NAMES = ["Harbor Car Rentals", "Sunset Drive Co", "Maple Auto Hire"];
const DOMAIN = ".drive-247.com";

/* Keep in step with the media query in the CSS: where the section is one screen tall. */
const FRAME = "(min-width: 1100px) and (min-height: 700px)";
/* The width the demo's window is laid out at before it is scaled to fit. */
const DESIGN_WIDTH = 1180;

type AddressCheck =
  | { state: "checking" | "free" | "unavailable" | "unknown"; slug: string }
  | { state: "taken"; slug: string; suggestion: string | null };

/** Types each sample name into the empty field, holds it, deletes it, moves on. Stops while `paused`. */
function useTypedSamples(paused: boolean): string {
  const [text, setText] = useState("");

  useEffect(() => {
    if (paused) return;
    let alive = true;
    let timer = 0;
    let index = 0;
    let length = 0;
    let deleting = false;

    const tick = () => {
      if (!alive) return;
      const target = SAMPLE_NAMES[index];
      if (!deleting) {
        length += 1;
        setText(target.slice(0, length));
        if (length === target.length) {
          deleting = true;
          timer = window.setTimeout(tick, 1900);
          return;
        }
        timer = window.setTimeout(tick, 75);
        return;
      }
      length -= 1;
      setText(target.slice(0, length));
      if (length === 0) {
        deleting = false;
        index = (index + 1) % SAMPLE_NAMES.length;
        timer = window.setTimeout(tick, 450);
        return;
      }
      timer = window.setTimeout(tick, 32);
    };

    timer = window.setTimeout(tick, 600);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [paused]);

  return text;
}

/** Is the address this name makes still free? Asked 450ms after the typing stops. */
function useAddressCheck(typed: string): AddressCheck | null {
  const [check, setCheck] = useState<AddressCheck | null>(null);

  useEffect(() => {
    if (!typed) {
      setCheck(null);
      return;
    }
    const shape = checkSlugShape(deriveSlugFromCompanyName(typed));
    if (!shape.ok) {
      setCheck(shape.problem === "empty" ? null : { state: "unavailable", slug: shape.slug });
      return;
    }
    setCheck({ state: "checking", slug: shape.slug });
    let live = true;
    const timer = window.setTimeout(async () => {
      try {
        const result = await slugAvailabilityAnon(shape.slug);
        if (!live) return;
        setCheck(
          result.available
            ? { state: "free", slug: result.slug }
            : { state: "taken", slug: result.slug, suggestion: result.suggestions[0] ?? null },
        );
      } catch {
        if (live) setCheck({ state: "unknown", slug: shape.slug });
      }
    }, 450);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [typed]);

  return check;
}

/*
 * In the one-screen layout, the demo's window keeps its design width and is scaled to the
 * column it sits in; its height is whatever is left under the tabs and the guide.
 */
function useFittedWindow() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = ref.current;
    const slot = host?.querySelector<HTMLElement>(".bd-window");
    const win = slot?.querySelector<HTMLElement>(".pg-browser");
    if (!host || !slot || !win) return;
    const frame = window.matchMedia(FRAME);

    const fit = () => {
      if (!frame.matches) {
        win.style.width = win.style.height = win.style.zoom = "";
        return;
      }
      const scale = slot.clientWidth / DESIGN_WIDTH;
      win.style.width = `${DESIGN_WIDTH}px`;
      win.style.zoom = String(scale);
      win.style.height = `${slot.clientHeight / scale}px`;
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(slot);
    frame.addEventListener("change", fit);
    return () => {
      watch.disconnect();
      frame.removeEventListener("change", fit);
    };
  }, []);

  return ref;
}

/*
 * The page line and this section. The arrow on the screen above (demo-intro.tsx) ends the
 * line pointing at the demo, so no line is drawn across this screen. It starts again under
 * the window's left corner, and the page line carries it on from there down the left.
 */
function useLineEnds(section: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = section.current;
    if (!el) return;
    const media = matchMedia(LINE_MEDIA);
    const mark = () => {
      const win = el.querySelector(".bd-window")?.getBoundingClientRect();
      if (!media.matches || !win) {
        delete el.dataset.lineIn;
        delete el.dataset.lineOut;
        return;
      }
      el.dataset.lineIn = String(demoArrowX());
      el.dataset.lineOut = String(Math.round(win.left + Math.min(72, win.width * 0.08)));
    };
    mark();
    const sizes = new ResizeObserver(mark);
    sizes.observe(el);
    addEventListener("resize", mark);
    media.addEventListener("change", mark);
    return () => {
      sizes.disconnect();
      removeEventListener("resize", mark);
      media.removeEventListener("change", mark);
    };
  }, [section]);
}

export function YourSite({ signup }: { signup: boolean }) {
  const { ref, visible } = useReveal();
  const site = useSitePreview();
  const demoRef = useFittedWindow();
  const sectionRef = useRef<HTMLElement>(null);
  useLineEnds(sectionRef);
  // Which of the demo's screens is showing: chosen on the cards here, or inside the demo itself.
  const [view, setView] = useState<DemoView>("home");
  // Where the visitor is in the demo's journey, and what to do next (reported by the demo).
  const [journey, setJourney] = useState<DemoJourney | null>(null);
  const [name, setName] = useState("");
  const [focused, setFocused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    const onChange = () => setReducedMotion(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // On screen right now (useReveal's `visible` stays true once seen). The typing re-renders the
  // whole site preview 20 times a second, so it stops while the section is off screen.
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);

  const typed = name.trim();
  const sample = useTypedSamples(!visible || !onScreen || reducedMotion || focused || typed.length > 0);
  const check = useAddressCheck(typed);
  // The address signup would give them: the free one if theirs is taken, else the one their name makes.
  const address = `${check?.state === "taken" && check.suggestion ? check.suggestion : site.slug}${DOMAIN}`;

  const start = (event?: FormEvent) => {
    event?.preventDefault();
    if (!signup) {
      openBookDemo();
      return;
    }
    saveSignupPrefill(typed);
    const pricing = document.getElementById("pricing");
    if (pricing) pricing.scrollIntoView({ block: "start" });
    else window.location.hash = "pricing";
  };

  return (
    <section ref={sectionRef} id="your-site" aria-labelledby="your-site-heading" className="ys" style={{ "--ys-a": site.colour.hex } as CSSProperties}>
      <div ref={ref} className={`ys-inner${visible ? " is-in" : ""}`}>
        <h2 id="your-site-heading" className="ys-title">
          Name it. Style it. <Accent>Try it.</Accent>
        </h2>

        {/* The site itself, working: home page, booking, renter's portal, your portal. */}
        <div ref={demoRef} className="ys-demo">
          <BookingDemoStage view={view} onView={setView} onJourney={setJourney} />
        </div>

        <div className="ys-side">
          {/* The setup: name, colour, template. */}
          <div id="templates" className="ys-bar">
            <form className="ys-set" onSubmit={start}>
              <label className="ys-label" htmlFor="ys-name">
                Your company&apos;s name
              </label>
              <input
                id="ys-name"
                className="ys-input"
                type="text"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setSiteName(event.target.value);
                }}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                placeholder={focused || reducedMotion ? "Your company name" : sample || " "}
                maxLength={FIELD_MAX.companyName}
                autoComplete="organization"
                enterKeyHint="go"
              />
              <p className={`ys-status${check?.state === "free" ? " is-free" : ""}`} aria-live="polite">
                {!check && <>This becomes your site&apos;s web address.</>}
                {check?.state === "checking" && (
                  <span>
                    Checking <b>{check.slug}{DOMAIN}</b>
                  </span>
                )}
                {check?.state === "free" && (
                  <>
                    <Check strokeWidth={2.5} aria-hidden />
                    <span>
                      <b>{check.slug}{DOMAIN}</b> is free right now.
                    </span>
                  </>
                )}
                {check?.state === "taken" && (
                  <span>
                    <b>{check.slug}{DOMAIN}</b> is taken.{" "}
                    {check.suggestion ? (
                      <>
                        <b>{check.suggestion}{DOMAIN}</b> is free.
                      </>
                    ) : (
                      <>You can pick another when you sign up.</>
                    )}
                  </span>
                )}
                {check?.state === "unavailable" && <>That address can&apos;t be used. You can pick another when you sign up.</>}
                {check?.state === "unknown" && <>You&apos;ll confirm your address when you sign up.</>}
              </p>
            </form>

            <div className="ys-set">
              <p className="ys-label" id="ys-colour-label">
                Your colour <span>{site.colour.name}</span>
              </p>
              <div className="ys-swatches" role="radiogroup" aria-labelledby="ys-colour-label">
                {SITE_COLOURS.map((c) => {
                  const on = c.id === site.colour.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={c.name}
                      title={c.name}
                      className={on ? "is-on" : undefined}
                      style={{ "--sw": c.hex } as CSSProperties}
                      onClick={() => setSiteColour(c.id)}
                    >
                      {on && <Check strokeWidth={3} aria-hidden />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="ys-set">
              <p className="ys-label" id="ys-template-label">
                Your template
              </p>
              <div className="ys-temps" role="radiogroup" aria-labelledby="ys-template-label">
                {SITE_TEMPLATES.map((t) => {
                  const on = t.id === site.template;
                  return (
                    <button key={t.id} type="button" role="radio" aria-checked={on} className={on ? "is-on" : undefined} onClick={() => setSiteTemplate(t.id)}>
                      {/* A small sign for the template, not a picture of it: the window beside this shows the real thing. */}
                      <i className={`ys-emblem is-${t.id}`} aria-hidden />
                      <b>{t.name}</b>
                      <small>{t.feel}</small>
                      <span className="ys-radio" aria-hidden>
                        {on && <Check strokeWidth={3} />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/*
              The guide: the journey's four steps, ticked as they are done, and one line on what
              to do now. A step opens its screen. On a small screen the demo's own tabs and tip do this.
            */}
            <div className="ys-set ys-nav">
              <p className="ys-label" id="ys-nav-label">
                Your tour
                <span>{Math.min(journey?.step ?? 0, JOURNEY_STEPS.length)} of {JOURNEY_STEPS.length} done</span>
                {journey?.started && (
                  <button type="button" className="ys-reset" onClick={journey.reset}>
                    <RotateCcw aria-hidden />
                    Start over
                  </button>
                )}
              </p>
              <ol className="ys-cards" aria-labelledby="ys-nav-label">
                {JOURNEY_STEPS.map((step, i) => {
                  const done = (journey?.step ?? 0) > i;
                  const here = step.view === view;
                  // The screen the journey wants next, when it is not the one showing.
                  const next = (journey?.step ?? 0) === i && !here;
                  return (
                    <li key={step.view}>
                      <button type="button" aria-current={here ? "step" : undefined} className={`${here ? "is-on" : ""}${done ? " is-done" : ""}`} onClick={() => setView(step.view)}>
                        <span className="ys-step-no">{done ? <Check strokeWidth={3} aria-hidden /> : i + 1}</span>
                        <b>
                          {step.label}
                          {done && <span className="sr-only"> (done)</span>}
                        </b>
                        {next && <span className="ys-next">Next</span>}
                      </button>
                    </li>
                  );
                })}
              </ol>
              <p className="ys-tip" aria-live="polite">
                {journey?.tip}
              </p>
            </div>
          </div>

          {/* The way in. On a phone it waits until after the demo (ys-close-end below). */}
          <div className="ys-close">
            <button type="button" className="ys-go" onClick={() => start()}>
              {signup ? "Start free trial" : "Book a demo"}
              <ArrowRight strokeWidth={2} aria-hidden />
            </button>
            <p className="ys-close-line">
              Goes live at <b>{address}</b>
            </p>
          </div>
        </div>

        {/*
          On a phone only: the way in comes after the demo, once the visitor has played with it,
          rather than between the setup and the site it sets up.
        */}
        <div className="ys-close ys-close-end">
          <p className="ys-close-line">
            Like it? It goes live at <b>{address}</b>
          </p>
          <button type="button" className="ys-go" onClick={() => start()}>
            {signup ? "Start free trial" : "Book a demo"}
            <ArrowRight strokeWidth={2} aria-hidden />
          </button>
        </div>
      </div>
    </section>
  );
}
