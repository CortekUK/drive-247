"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import { ArrowLeft, ArrowRight, Check, Lock, Plus, RotateCw, X } from "lucide-react";

import { slugAvailabilityAnon } from "@/components/onboarding/onboarding-api";
import { saveSignupPrefill } from "@/lib/signup-prefill";
import { checkSlugShape, deriveSlugFromCompanyName, FIELD_MAX } from "@/lib/signup-validation";
import "./portal-glass.css";
import "./name-your-business.css";

/*
 * The closing section. The visitor types their company's name and watches the booking
 * site take it: the logo slot, the tab and the web address all fill in as they type,
 * with a real check of whether that address is still free. "Start free trial" carries
 * the name to the plans, and the signup opens with it already in the business field.
 *
 * Until they type, the field's placeholder types sample names by itself, so the section
 * shows what it does before anyone touches it. That is the section's one animation.
 */

const SAMPLE_NAMES = ["Harbor Car Rentals", "Sunset Drive Co", "Maple Auto Hire"];
const RESTING_NAME = "Your Rentals";
const DOMAIN = ".drive-247.com";

type Check =
  | { state: "checking" | "free" | "unavailable" | "unknown"; slug: string }
  | { state: "taken"; slug: string; suggestion: string | null };

/** Types each sample name, holds it, deletes it, moves on. Stops while `paused`. */
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

export function NameYourBusiness({ signup }: { signup: boolean }) {
  const sectionRef = useRef<HTMLElement>(null);
  const [inView, setInView] = useState(false);
  const [arrived, setArrived] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [name, setName] = useState("");
  const [focused, setFocused] = useState(false);
  const [check, setCheck] = useState<Check | null>(null);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    const onChange = () => setReducedMotion(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setInView(entry.isIntersecting);
        if (entry.isIntersecting) setArrived(true);
      },
      { rootMargin: "0px 0px -25% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const typed = name.trim();
  const sample = useTypedSamples(!inView || reducedMotion || focused || typed.length > 0);
  const shownName = typed || sample || RESTING_NAME;
  const shownSlug = deriveSlugFromCompanyName(shownName) || "yourrentals";
  const initial = (shownName.match(/[a-z0-9]/i)?.[0] ?? "Y").toUpperCase();

  // Is the address their name makes still free? The same one-row lookup the signup's
  // own web-address field uses before an account exists.
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

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!signup) {
      window.location.assign("/strategy-call");
      return;
    }
    saveSignupPrefill(typed);
    const pricing = document.getElementById("pricing");
    if (pricing) pricing.scrollIntoView({ block: "start" });
    else window.location.hash = "pricing";
  };

  return (
    <section ref={sectionRef} className={`nb ${arrived ? "is-in" : ""}`} aria-labelledby="nb-title">
      <div className="nb-row">
        <div className="nb-copy">
          <p className="nb-kicker">Get started</p>
          <h2 id="nb-title" className="nb-title">
            What&apos;s your rental company called?
          </h2>
          <p className="nb-sub">
            Type it in and see your booking site wear it. Sign up and it goes live at that address,
            with your name on it.
          </p>

          <form className="nb-form" onSubmit={onSubmit}>
            <div className="nb-field">
              <input
                className="nb-input"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                placeholder={focused || reducedMotion ? "Your company name" : sample || " "}
                aria-label="Your rental company's name"
                maxLength={FIELD_MAX.companyName}
                autoComplete="organization"
                enterKeyHint="go"
              />
              <button type="submit" className="nb-go">
                {signup ? "Start free trial" : "Book a demo"}
                <ArrowRight strokeWidth={2} aria-hidden />
              </button>
            </div>

            <p className={`nb-status ${check?.state === "free" ? "is-free" : ""}`} aria-live="polite">
              {!check && <>This becomes your booking site&apos;s web address.</>}
              {check?.state === "checking" && (
                <>
                  Checking <span className="nb-addr">{check.slug}{DOMAIN}</span>
                </>
              )}
              {check?.state === "free" && (
                <>
                  <Check strokeWidth={2.5} aria-hidden />
                  <span>
                    <span className="nb-addr">{check.slug}{DOMAIN}</span> is free right now.
                  </span>
                </>
              )}
              {check?.state === "taken" && (
                <span>
                  <span className="nb-addr">{check.slug}{DOMAIN}</span> is taken.{" "}
                  {check.suggestion ? (
                    <>
                      <span className="nb-addr">{check.suggestion}{DOMAIN}</span> is free.
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

          {signup && (
            <p className="nb-alt">
              Rather talk it through first? <a href="/strategy-call">Book a demo</a>
            </p>
          )}
        </div>

        <div className="nb-device" aria-hidden>
          <div className="pg-browser nb-browser">
            <div className="pg-tabs">
              <span className="pg-lights">
                <i />
                <i />
                <i />
              </span>
              <span className="pg-tab">
                <span className="nb-favicon">{initial}</span>
                <span className="pg-tab-label">{shownName}</span>
                <X strokeWidth={2} />
              </span>
              <Plus strokeWidth={2} className="pg-newtab" />
            </div>
            <div className="pg-address">
              <ArrowLeft strokeWidth={2} />
              <ArrowRight strokeWidth={2} className="pg-off" />
              <RotateCw strokeWidth={2} />
              <span className="pg-url">
                <Lock strokeWidth={2} />
                <span className="pg-url-label">
                  <span className="nb-host">{shownSlug}</span>
                  {DOMAIN}
                </span>
              </span>
            </div>
            <div className="pg-screen nb-screen">
              <Image
                src="/v2/site-main.png"
                alt=""
                fill
                sizes="(min-width: 1200px) 58vw, 100vw"
                className="dark:hidden"
              />
              <Image
                src="/v2/site-main-dark.png"
                alt=""
                fill
                sizes="(min-width: 1200px) 58vw, 100vw"
                className="hidden dark:block"
              />
              <span className="nb-logo">
                <span className="nb-mark">{initial}</span>
                <span className="nb-name">{shownName}</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
