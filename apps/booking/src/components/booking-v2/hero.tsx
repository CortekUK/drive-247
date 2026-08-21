"use client";

import { BOOKING_RANGES, BUSINESS_TYPES, CAR_SHOTS, NAV } from "./data";
import { Icon, Wordmark } from "./icons";

/* ========================================================================== */
/* NAV                                                                        */
/* ========================================================================== */

export function Nav() {
  return (
    <header className="bv2-wrap flex items-center justify-between gap-6 py-6">
      <a href="#top" aria-label="Drive247 home"><Wordmark /></a>

      <nav className="hidden items-center gap-9 md:flex">
        {NAV.map(item => (
          <a key={item} href="#top"
            className="text-[13px] text-[var(--body)] transition-colors hover:text-[var(--ink)]">
            {item}
          </a>
        ))}
      </nav>

      <a href="#demo" className="bv2-btn-ghost shrink-0">
        Book a demo
        <Icon name="arrowUpRight" className="h-3.5 w-3.5" />
      </a>
    </header>
  );
}

/* ========================================================================== */
/* HERO                                                                       */
/* ========================================================================== */

export function Hero() {
  return (
    <section id="top" className="bv2-wrap relative pb-4 pt-6 sm:pt-10">
      <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,.86fr)_minmax(0,1.14fr)]">
        {/* ------------------------------------------------------- copy */}
        <div className="bv2-rise relative z-10">
          <p className="bv2-label mb-7">Drive247 / Rental Operations</p>

          <h1 className="bv2-serif bv2-display">
            Move<br />Better<span className="text-[var(--red)]">.</span>
          </h1>

          <p className="bv2-body mt-7 max-w-[21rem]">
            The all-in-one platform to run your rental business with clarity,
            control and confidence.
          </p>
        </div>

        {/* -------------------------------------------------------- car */}
        <div className="bv2-rise" style={{ animationDelay: "120ms" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={CAR_SHOTS[0]}
            alt="Compact rental car"
            className="bv2-car-mask w-full object-cover"
            style={{ aspectRatio: "16 / 10" }}
            fetchPriority="high"
            decoding="async"
          />
        </div>
      </div>
    </section>
  );
}

/* ========================================================================== */
/* DEMO FORM                                                                  */
/* ========================================================================== */

const FIELDS = [
  { label: "Full name",   placeholder: "Your name",        type: "text"  as const, name: "name" },
  { label: "Work email",  placeholder: "you@company.com",  type: "email" as const, name: "email" },
  { label: "Company",     placeholder: "Company name",     type: "text"  as const, name: "company" },
];

/**
 * The full-width band directly under the hero.
 *
 * Design only — the fields carry no submit handler and post nowhere. They are
 * marked `readOnly`-free so the page still feels alive to type in, but nothing
 * leaves the browser.
 */
export function DemoForm() {
  return (
    <section id="demo" className="bv2-wrap pb-16 pt-8 sm:pb-20">
      <form
        onSubmit={e => e.preventDefault()}
        className="bv2-card grid gap-6 p-6 sm:p-7
                   lg:grid-cols-[minmax(0,1.3fr)_repeat(5,minmax(0,.94fr))_auto] lg:items-end lg:gap-5">
        <p className="max-w-[15rem] text-[13px] leading-relaxed text-[var(--body)] lg:pb-2">
          Build a stronger rental operation.<br />Tell us a bit about your business.
        </p>

        {FIELDS.map(f => (
          <label key={f.name} className="block">
            <span className="bv2-field-label mb-2.5 block">{f.label}</span>
            <span className="bv2-field-wrap block">
              <input type={f.type} name={f.name} placeholder={f.placeholder} className="bv2-field" />
            </span>
          </label>
        ))}

        <label className="block">
          <span className="bv2-field-label mb-2.5 block">Business type</span>
          <span className="bv2-field-wrap relative flex items-center">
            <select name="businessType" defaultValue="" className="bv2-field appearance-none pr-5 text-[var(--body)]">
              <option value="" disabled>Select type</option>
              {BUSINESS_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
            <Icon name="chevron" className="pointer-events-none absolute right-0 h-3.5 w-3.5 text-[var(--muted)]" />
          </span>
        </label>

        <label className="block">
          <span className="bv2-field-label mb-2.5 block">Monthly bookings</span>
          <span className="bv2-field-wrap relative flex items-center">
            <select name="volume" defaultValue="" className="bv2-field appearance-none pr-5 text-[var(--body)]">
              <option value="" disabled>Select range</option>
              {BOOKING_RANGES.map(t => <option key={t}>{t}</option>)}
            </select>
            <Icon name="chevron" className="pointer-events-none absolute right-0 h-3.5 w-3.5 text-[var(--muted)]" />
          </span>
        </label>

        <button type="submit" className="bv2-btn-red h-[42px] w-full lg:w-auto">Book a demo</button>
      </form>
    </section>
  );
}
