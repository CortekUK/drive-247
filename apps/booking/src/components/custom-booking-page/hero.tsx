"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { CBP, type CbpContent, type CbpSlide } from "./use-site-content";

/* ========================================================================== *
 * The hero.
 *
 * ONE integrated full-width section, not a two-column split: the vehicle
 * photography is the section's own ground, bled to the right edge and faded
 * into the lavender wash on the left so the copy sits in light rather than in
 * a card beside a picture. The booking form belongs to this section too — it
 * spans the bottom and overlaps into the band below.
 *
 * Everything except the photography is fixed: heading, description, benefit
 * points, buttons and the booking form never move while slides change.
 * ========================================================================== */

/** Slide dwell, per the approved behaviour. */
const INTERVAL_MS = 2000;



export function Hero({ c, children }: { c: CbpContent; children?: React.ReactNode }) {
  return (
    <section className="relative isolate overflow-hidden">
      {/* The lavender ground. Sits beneath the photography so the whole
          section reads as one surface. */}
      <div className="cbp-hero-wash" />

      <HeroMedia slides={c.hero.slides} />

      {/* ------------------------------------------------------------ copy */}
      <div className="cbp-wrap relative z-10 pt-9 sm:pt-12 lg:pt-14">
        <div className="max-w-[34rem] lg:max-w-[30rem] xl:max-w-[33rem]">
          {c.tagline && (
            <p className="cbp-eyebrow-pill cbp-rise">
              <Icon name="sparkle" className="h-3.5 w-3.5 text-[var(--brand)]" />
              {c.tagline}
            </p>
          )}

          <h1 className="cbp-display cbp-rise mt-4" style={{ animationDelay: "60ms" }}>
            {c.hero.headline}
            {c.hero.highlight && <> <span className="cbp-grad-text">{c.hero.highlight}</span></>}
          </h1>

          {c.hero.subheading && (
            <p className="cbp-rise mt-3.5 max-w-[26rem] text-[14px] leading-[1.65] text-[var(--body)]" style={{ animationDelay: "110ms" }}>
              {c.hero.subheading}
            </p>
          )}

          {/* The small benefit points under the description. */}
          {c.hero.badges.length > 0 && (
            <ul className="cbp-rise mt-5 flex flex-wrap items-center gap-x-5 gap-y-2.5" style={{ animationDelay: "150ms" }}>
              {c.hero.badges.map(b => (
                <li key={b} className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--ink-2)]">
                  <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]">
                    <Icon name="check" className="h-2.5 w-2.5" />
                  </span>
                  {b}
                </li>
              ))}
            </ul>
          )}

          <div className="cbp-rise mt-7 flex flex-wrap items-center gap-3" style={{ animationDelay: "190ms" }}>
            <a href="#booking" className="cbp-btn cbp-btn-primary">
              {c.hero.bookCta}
              <Icon name="arrow" className="cbp-arrow h-4 w-4 shrink-0" />
            </a>
            <Link href={`${CBP}/fleet`} className="cbp-btn cbp-btn-ghost">
              {c.hero.fleetCta}
              <Icon name="car" className="h-4 w-4 shrink-0" />
            </Link>
          </div>
        </div>
      </div>

      {/* The booking form belongs to the hero: it spans the section's bottom
          and overlaps into the band beneath. `children` is the booking panel,
          passed in so this file stays free of reservation logic. */}
      <div className="cbp-wrap relative z-20 pb-px pt-10 sm:pt-14 lg:pt-20">{children}</div>
    </section>
  );
}

/* ========================================================================== */
/* SLIDER                                                                     */
/* ========================================================================== */

/**
 * The crossfading vehicle photography.
 *
 * Every frame is absolutely positioned in one fixed-height box and stacked, so
 * only opacity animates — the page cannot shift as slides change, and there is
 * no flash of empty space between them. A single slide renders as a still
 * image with no controls and no timer.
 *
 * Loading is staged: the first frame is eager and high priority, the next is
 * preloaded so its crossfade never starts on an empty element, and the rest
 * are lazy.
 */
function HeroMedia({ slides }: { slides: CbpSlide[] }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const many = slides.length > 1;

  const go = useCallback((n: number) => setI(((n % slides.length) + slides.length) % slides.length), [slides.length]);

  useEffect(() => {
    if (!many || paused) return;
    // Honour the OS setting: auto-advancing photography is motion.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI(v => (v + 1) % slides.length), INTERVAL_MS);
    return () => clearInterval(t);
  }, [many, paused, slides.length]);

  // Pause while the tab is hidden — a timer firing against an invisible page
  // burns work and lands the user on an arbitrary frame when they return.
  useEffect(() => {
    const onVis = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  return (
    <div
      className="cbp-hero-media"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="relative h-full w-full">
        {slides.map((s, n) => (
          <picture key={s.url + n} className="cbp-slide" data-on={n === i} aria-hidden={n !== i}>
            <source media="(max-width: 767px)" srcSet={s.mobileUrl} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={s.url}
              alt={n === i ? s.alt : ""}
              style={{ objectPosition: s.focal }}
              fetchPriority={n === 0 ? "high" : undefined}
              loading={n <= 1 ? "eager" : "lazy"}
              decoding="async"
            />
          </picture>
        ))}
        {/* Feathers the photography into the ground on its left and bottom
            edges, so it is part of the section rather than a pasted card. */}
        <span className="cbp-hero-feather" />
      </div>

      {many && (
        <>
          <button
            type="button" onClick={() => go(i - 1)} aria-label="Previous image"
            className="cbp-slide-arrow left-3 sm:left-5"
          >
            <Icon name="chevronLeft" className="h-4 w-4" />
          </button>
          <button
            type="button" onClick={() => go(i + 1)} aria-label="Next image"
            className="cbp-slide-arrow right-3 sm:right-5"
          >
            <Icon name="chevronRight" className="h-4 w-4" />
          </button>

          <div className="cbp-slide-dots" role="tablist" aria-label="Hero images">
            {slides.map((_, n) => (
              <button
                key={n} type="button" role="tab"
                aria-selected={n === i} aria-label={`Image ${n + 1} of ${slides.length}`}
                onClick={() => go(n)} data-on={n === i}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ========================================================================== */
/* BENEFIT ROW                                                                */
/* ========================================================================== */

/**
 * The four compact items directly below the booking form. Fed by the
 * operator's own CMS service highlights, so every claim is one they wrote.
 */
export function BenefitRow({ c }: { c: CbpContent }) {
  if (!c.features.length) return null;
  return (
    <section className="cbp-wrap pt-9 sm:pt-11">
      <ul className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-[var(--line)] lg:gap-0">
        {c.features.slice(0, 4).map(f => (
          <li key={f.title} className="flex items-center gap-3 lg:px-6 lg:first:pl-0 lg:last:pr-0">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]">
              <Icon name={featureIcon(f.icon)} className="h-[18px] w-[18px]" />
            </span>
            <span className="min-w-0">
              <span className="block text-[13.5px] font-bold leading-tight text-[var(--ink)]">{f.title}</span>
              {f.copy && <span className="mt-0.5 block truncate text-[12px] text-[var(--body)]">{f.copy}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* The CMS stores lucide icon names; map onto this design's stroke set. */
const ICONS: Record<string, string> = {
  ThumbsUp: "sparkle", Users: "users", MapPin: "pin", Settings: "gear",
  Headphones: "headset", Shield: "shield", Clock: "clock", Phone: "phone",
  Sparkles: "sparkle", Car: "car", Award: "diamond", Fuel: "fuel",
  CreditCard: "wallet", DollarSign: "wallet", Calendar: "calendar",
  CheckCircle: "checkCircle", Star: "star", Crown: "diamond", Gift: "gift",
  Tag: "tag", Key: "car", Gauge: "gear", Zap: "sparkle",
};
const featureIcon = (n: string | undefined) => ICONS[n ?? ""] ?? "checkCircle";
