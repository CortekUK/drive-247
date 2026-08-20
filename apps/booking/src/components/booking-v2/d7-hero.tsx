"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import {
  HERO_POINTS, HERO_SHOT, LOCATIONS, STRIP, TIMES, VEHICLE_TYPES,
} from "./d7-data";
import { Icon, Skyline } from "./d7-icons";
import {
  AnimatedShinyText, AuroraBackground, BlurFade, BorderBeam, HoverBorderGradient,
  Magnetic, Meteors, Particles, ShimmerButton, WordsPullUp,
} from "./d7-ui";

const EASE = [0.16, 1, 0.3, 1] as const;

/* ========================================================================== */

export function Hero() {
  return (
    <section id="top" className="relative isolate overflow-hidden pt-[74px]">
      {/* ---------------------------------------------------------- sky */}
      <div aria-hidden className="absolute inset-0 -z-10">
        <div className="d7-sky absolute inset-0" />
        <AuroraBackground className="absolute inset-0" />
        <Particles quantity={54} color="#8b5cf6" className="opacity-70" />
        <Meteors number={12} className="opacity-40" />
        {/* two slow blobs so the sky is never static */}
        <div className="d7-blob absolute -left-[12%] top-[6%] h-[46vh] w-[46vh] rounded-full bg-[#7dd3fc]/35 blur-[90px]" />
        <div className="d7-blob absolute right-[4%] top-[2%] h-[52vh] w-[52vh] rounded-full bg-[#c4b5fd]/45 blur-[100px]"
          style={{ animationDelay: "-7s" }} />
        <div className="d7-blob absolute left-[38%] top-[38%] h-[34vh] w-[34vh] rounded-full bg-[#fbcfe8]/40 blur-[90px]"
          style={{ animationDelay: "-12s" }} />
        {/* landmark silhouettes along the horizon */}
        <Skyline className="absolute inset-x-0 bottom-[30%] h-[34%] w-full opacity-45" />
        <div className="d7-sky-fade absolute inset-x-0 bottom-0 h-[52%]" />
      </div>

      <div className="d7-wrap grid items-center gap-10 pb-4 pt-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.06fr)] lg:pt-14">
        {/* ------------------------------------------------------- copy */}
        <div className="relative z-10">
          <BlurFade delay={0.05}>
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--glass)] px-3.5 py-1.5
                             shadow-[0_6px_20px_-14px_rgba(23,16,72,.5)] backdrop-blur">
              <Icon name="spark" className="h-[15px] w-[15px] text-[var(--v)]" />
              <AnimatedShinyText className="d7-eyebrow">Premium Car Rentals</AnimatedShinyText>
            </span>
          </BlurFade>

          <h1 className="d7-dis d7-hero mt-6 text-[var(--ink)]">
            <WordsPullUp words={["Drive", "More."]} delay={0.14} />
            <br />
            <WordsPullUp
              words={["Live", <span key="more" className="d7-grad-text">More.</span>]}
              delay={0.3} />
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.55, duration: 0.7, ease: EASE }}
            className="d7-body mt-6 max-w-[26rem]">
            Premium vehicles. Transparent pricing.
          </motion.p>

          {/* trust badges */}
          <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
            {HERO_POINTS.map((p, i) => (
              <motion.span key={p.label}
                initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.68 + i * 0.09, duration: 0.6, ease: EASE }}
                className="flex items-center gap-2 text-[13.5px] font-semibold text-[var(--ink-2)]">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--white)] text-[var(--v)]
                                 shadow-[0_6px_16px_-10px_rgba(23,16,72,.6)]">
                  <Icon name={p.icon} className="h-[15px] w-[15px]" />
                </span>
                {p.label}
              </motion.span>
            ))}
          </div>

          {/* CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.95, duration: 0.7, ease: EASE }}
            className="mt-9 flex flex-wrap items-center gap-3.5">
            <Magnetic strength={0.22}>
              <ShimmerButton className="d7-btn px-7 py-3.5">
                Book Now <Icon name="arrow" className="d7-arrow h-4 w-4" />
              </ShimmerButton>
            </Magnetic>
            <Magnetic strength={0.18}>
              <HoverBorderGradient className="flex items-center gap-2 px-6 py-3">
                Explore Fleet <Icon name="car" className="h-[18px] w-[18px] text-[var(--v)]" />
              </HoverBorderGradient>
            </Magnetic>
          </motion.div>
        </div>

        {/* -------------------------------------------------------- art */}
        <div className="relative">
          <motion.div
            initial={{ opacity: 0, x: 70, scale: 0.94 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={{ delay: 0.2, duration: 1.15, ease: EASE }}
            className="relative">
            {/* glow pooled under the car */}
            <div aria-hidden className="absolute -inset-6 -z-10 rounded-[40px] bg-[radial-gradient(60%_60%_at_50%_45%,rgba(139,92,246,.35),transparent_72%)] blur-2xl" />

            <div className="d7-hover relative">
              <div className="relative overflow-hidden rounded-[26px] border border-[var(--line)] shadow-[0_50px_90px_-46px_rgba(23,16,72,.7)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={HERO_SHOT} alt="Silver Honda Civic on a downtown street"
                  className="aspect-[16/10] w-full object-cover" fetchPriority="high" decoding="async" />
                <span aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,rgba(109,90,240,.20),transparent_46%,rgba(168,85,247,.18))]" />
                <BorderBeam duration={9} size={110} radius={26} />
              </div>

              {/* number-plate flourish, as in the comp */}
              <motion.span
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.25, duration: 0.6, ease: EASE }}
                className="absolute -bottom-4 left-6 rounded-md border-2 border-[var(--ink)]/85
                           bg-[var(--white)] px-3.5 py-1 text-[12px] font-extrabold tracking-[.14em] text-[var(--ink)]
                           shadow-[0_10px_24px_-14px_rgba(23,16,72,.8)]">
                DRIVE 247
              </motion.span>

              {/* speed trails */}
              <span aria-hidden className="d7-trail left-[6%] top-[62%] w-[38%]" />
              <span aria-hidden className="d7-trail left-[14%] top-[72%] w-[26%]" style={{ animationDelay: "1.4s" }} />
            </div>
          </motion.div>

        </div>
      </div>

      <SearchPanel />
      <TrustStrip />
    </section>
  );
}

/* ========================================================================== */
/* SEARCH PANEL                                                               */
/* ========================================================================== */

const TABS = [
  { id: "where", label: "Pick-up & Return", icon: "car" },
  { id: "when",  label: "Dates & Time",     icon: "cal" },
  { id: "what",  label: "Vehicle Type",     icon: "sliders" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/** Design-only search form. Nothing is validated, priced or submitted. */
function SearchPanel() {
  const [tab, setTab] = useState<TabId>("where");
  const [twoWay, setTwoWay] = useState(false);

  return (
    <BlurFade delay={0.35} y={40} className="relative z-20 mt-10">
      <div className="d7-wrap">
        <div className="d7-float relative overflow-hidden">
          <BorderBeam duration={12} size={140} radius={22} className="opacity-70" />

          {/* tabs */}
          <div className="flex overflow-x-auto border-b border-[var(--line)] d7-noscroll">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                aria-pressed={tab === t.id}
                className={`relative flex shrink-0 items-center gap-2 px-6 py-4 text-[13.5px] font-semibold transition-colors
                            ${tab === t.id ? "text-[var(--v)]" : "text-[var(--body)] hover:text-[var(--ink)]"}`}>
                <Icon name={t.icon} className="h-[17px] w-[17px]" />
                {t.label}
                {tab === t.id && (
                  <motion.span layoutId="d7-tab-underline" aria-hidden
                    transition={{ type: "spring", stiffness: 400, damping: 34 }}
                    className="absolute inset-x-4 -bottom-px h-[2.5px] rounded-full [background:var(--grad)]" />
                )}
              </button>
            ))}
          </div>

          {/* panels */}
          <div className="p-5 sm:p-6">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={tab}
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.3, ease: EASE }}>
                {tab === "where" && <WherePanel twoWay={twoWay} />}
                {tab === "when"  && <WhenPanel />}
                {tab === "what"  && <WhatPanel />}
              </motion.div>
            </AnimatePresence>

            {/* one-way rentals only apply to the locations tab */}
            {tab === "where" && (
              <label className="mt-5 flex w-fit cursor-pointer items-center gap-2.5 text-[13px] text-[var(--body)]">
                <span className={`grid h-[18px] w-[18px] place-items-center rounded-[5px] border transition
                                  ${twoWay ? "border-[var(--v)] [background:var(--grad)] text-white" : "border-[var(--line)] bg-[var(--white)] text-transparent"}`}>
                  <Icon name="check" className="h-3 w-3" />
                </span>
                <input type="checkbox" className="sr-only" checked={twoWay}
                  onChange={e => setTwoWay(e.target.checked)} />
                Return to different location
              </label>
            )}
          </div>
        </div>
      </div>
    </BlurFade>
  );
}

/** One labelled control well. */
function Field({ label, icon, children, className = "" }: {
  label: string; icon: string; children: React.ReactNode; className?: string;
}) {
  return (
    <label className={`d7-field group flex flex-col gap-1 rounded-xl border border-[var(--line)] bg-[var(--white)] px-3 py-2.5 ${className}`}>
      <span className="d7-label whitespace-nowrap text-[11px]">{label}</span>
      <span className="flex items-center gap-2">
        <Icon name={icon} className="h-[15px] w-[15px] shrink-0 text-[var(--v)]" />
        {children}
      </span>
    </label>
  );
}

const controlClass =
  "cursor-pointer appearance-none overflow-hidden text-ellipsis whitespace-nowrap bg-transparent " +
  "pr-4 text-[13px] font-semibold text-[var(--ink)] outline-none";
const selectClass = `w-full ${controlClass}`;
/* A date input's max-content width is ~134px in Chrome, which blew out the
   auto-sized column. `w-full` and `w-[…]` are both width utilities, so keep
   them off the same element rather than relying on cascade order. */
const dateClass = `w-[116px] min-w-0 ${controlClass}`;

function Select({ options, defaultValue, placeholder }: {
  options: string[]; defaultValue?: string; placeholder?: string;
}) {
  return (
    <span className="relative flex min-w-0 flex-1 items-center">
      <select defaultValue={defaultValue ?? ""} className={selectClass}>
        {placeholder && <option value="" disabled>{placeholder}</option>}
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      <Icon name="chev" className="pointer-events-none absolute right-0 h-[15px] w-[15px] text-[var(--mute)]" />
    </span>
  );
}

function FindButton({ className = "" }: { className?: string }) {
  return (
    <Magnetic strength={0.16} className={className}>
      <ShimmerButton className="d7-btn h-full w-full min-w-[150px] px-5 py-3.5" borderRadius="14px">
        Find My Ride <Icon name="arrow" className="d7-arrow h-4 w-4" />
      </ShimmerButton>
    </Magnetic>
  );
}

function WherePanel({ twoWay }: { twoWay: boolean }) {
  return (
    <div className="grid gap-3 lg:gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto_auto_auto_auto]">
      <Field label="Pick-up Location" icon="pin">
        <Select options={LOCATIONS} placeholder="Select location" />
      </Field>
      <Field label="Return Location" icon="pin">
        <Select options={LOCATIONS} placeholder={twoWay ? "Select location" : "Same location"} />
      </Field>
      <Field label="Pick-up Date" icon="cal">
        <input type="date" defaultValue="2026-09-24" className={dateClass} />
      </Field>
      <Field label="Pick-up Time" icon="clock">
        <Select options={TIMES} defaultValue="10:00 AM" />
      </Field>
      <Field label="Return Date" icon="cal">
        <input type="date" defaultValue="2026-09-26" className={dateClass} />
      </Field>
      <Field label="Return Time" icon="clock">
        <Select options={TIMES} defaultValue="10:30 AM" />
      </Field>
      <FindButton />
    </div>
  );
}

function WhenPanel() {
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_auto]">
      <Field label="Pick-up Date" icon="cal">
        <input type="date" defaultValue="2026-09-24" className={dateClass} />
      </Field>
      <Field label="Pick-up Time" icon="clock">
        <Select options={TIMES} defaultValue="10:00 AM" />
      </Field>
      <Field label="Return Date" icon="cal">
        <input type="date" defaultValue="2026-09-26" className={dateClass} />
      </Field>
      <Field label="Return Time" icon="clock">
        <Select options={TIMES} defaultValue="10:30 AM" />
      </Field>
      <FindButton />
    </div>
  );
}

function WhatPanel() {
  const [pick, setPick] = useState(VEHICLE_TYPES[0]);
  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
      <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-[var(--line)] bg-[var(--white)] p-3">
        {VEHICLE_TYPES.map(t => (
          <button key={t} onClick={() => setPick(t)}
            className={`relative rounded-full px-4 py-2 text-[13px] font-semibold transition
                        ${pick === t ? "text-white" : "text-[var(--body)] hover:text-[var(--ink)]"}`}>
            {pick === t && (
              <motion.span layoutId="d7-type-pill" aria-hidden
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
                className="absolute inset-0 rounded-full [background:var(--grad)]" />
            )}
            <span className="relative z-10">{t}</span>
          </button>
        ))}
      </div>
      <FindButton />
    </div>
  );
}

/* ========================================================================== */

/** Four-up promise strip beneath the search panel. */
function TrustStrip() {
  return (
    <div className="d7-wrap py-12 sm:py-14">
      <div className="grid gap-y-8 sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-[var(--line)]">
        {STRIP.map((s, i) => (
          <BlurFade key={s.title} delay={0.06 * i}>
            <div className="group flex items-center gap-3.5 px-0 lg:px-7">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[var(--v-lt)] text-[var(--v)]
                               transition duration-500 group-hover:[background:var(--grad)] group-hover:text-white
                               group-hover:shadow-[var(--shadow-v)]">
                <Icon name={s.icon} className="h-[22px] w-[22px]" />
              </span>
              <span>
                <span className="block text-[14.5px] font-bold text-[var(--ink)]">{s.title}</span>
                <span className="block text-[12.5px] text-[var(--body)]">{s.sub}</span>
              </span>
            </div>
          </BlurFade>
        ))}
      </div>
    </div>
  );
}
