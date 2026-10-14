"use client";

import { Check, Lock, PenLine, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { carSvg, type CarPaint } from "./car-art";

/*
 * "Get bookings": the second section of the rebuilt v2 page (2026-10-08).
 *
 * The sales point: every operator gets their own booking site, in their own
 * brand, built for them at signup (the moat, research_competitor_onboarding),
 * and they can change any of it themselves with the editor (the CMS).
 *
 * Same frame as Meet Trax: one 100vw x 100vh screen, heading and description
 * on the left, the picture on the right; on phones they stack, heading first.
 *
 * The one star: the booking site in a browser frame, being edited live. The
 * headline sits in the editor's dashed selection; it deletes and retypes, and
 * with each new version the business name, the address bar and the brand
 * colour change with it (buttons, links, the car's trim). Nothing else moves.
 * Business names and copy are illustrative. Reduced motion holds the first
 * version still.
 */

type Look = { name: string; domain: string; headline: string; brand: string };

const LOOKS: Look[] = [
  { name: "Your Rentals", domain: "yourrentals.com", headline: "Book direct. Drive something good.", brand: "#442DD7" },
  { name: "Coastline Cars", domain: "coastlinecars.com", headline: "Weekend escapes from $79 a day.", brand: "#0f766e" },
  { name: "Northside Rentals", domain: "northsiderentals.com", headline: "The city's favourite rentals.", brand: "#111114" },
];

const HOLD_MS = 2600; // the finished headline stays this long
const DELETE_MS = 18;
const TYPE_MS = 45;

/** Deletes the headline, swaps the look, types the next headline, holds. Forever. */
function useEditing() {
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(LOOKS[0].headline.length);
  const [phase, setPhase] = useState<"hold" | "delete" | "type">("hold");
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    if (reduced) return;
    const text = LOOKS[i].headline;
    let t: number;
    if (phase === "hold") t = window.setTimeout(() => setPhase("delete"), HOLD_MS);
    else if (phase === "delete") {
      if (shown === 0) {
        t = window.setTimeout(() => {
          setI((v) => (v + 1) % LOOKS.length);
          setPhase("type");
        }, 250);
      } else t = window.setTimeout(() => setShown((v) => v - 1), DELETE_MS);
    } else {
      if (shown >= text.length) t = window.setTimeout(() => setPhase("hold"), 0);
      else t = window.setTimeout(() => setShown((v) => v + 1), TYPE_MS);
    }
    return () => window.clearTimeout(t);
  }, [reduced, i, shown, phase]);

  return { look: LOOKS[i], headline: LOOKS[i].headline.slice(0, shown), typing: phase !== "hold" };
}

// The approved car, white body, trim in the site's brand colour.
const SITE_PAINT: CarPaint = {
  top: "#ffffff", mid: "#f6f6f7", bot: "#e4e4e7", line: "#111114", rim: "var(--site-brand)",
  glass: "#1c1c21", pillar: "#ffffff", chrome: "#71717a", trim: "var(--site-brand)", tyre: "#111114",
  rimFace: "#e4e4e7", rimEdge: "#3f3f46", spoke: "#52525b", hub: "#111114",
  shadow: "#000000", shOp: 0.12, sheen: 0.9,
};
const CAR = carSvg(SITE_PAINT, "lvsitecar");

const FLEET = [
  { name: "Tesla Model 3", price: 99 },
  { name: "Toyota Camry", price: 69 },
  { name: "Ford Mustang", price: 119 },
];

function BookingSite() {
  const { look, headline, typing } = useEditing();
  return (
    <div
      className="w-full max-w-[600px] overflow-hidden rounded-[22px] bg-white text-[#12141c] shadow-[0_30px_80px_-20px_rgb(10_6_60/0.55)]"
      style={{ ["--site-brand" as string]: look.brand }}
    >
      {/* Browser bar: the operator's own address */}
      <div className="flex items-center gap-3 border-b border-[#ececf1] px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-[#e4e4ea]" />
          <span className="size-2.5 rounded-full bg-[#e4e4ea]" />
          <span className="size-2.5 rounded-full bg-[#e4e4ea]" />
        </span>
        <span className="mx-auto flex h-7 w-full max-w-[260px] items-center justify-center gap-1.5 rounded-full bg-[#f3f3f7] text-[12px] text-[#55556a]">
          <Lock className="size-3 text-[#9a9aa8]" aria-hidden />
          {look.domain}
        </span>
        <span className="w-[42px]" aria-hidden />
      </div>

      <div className="px-6 pb-5 pt-4">
        {/* Site nav */}
        <div className="flex items-center gap-5 text-[12px]">
          <span className="flex items-center gap-2 text-[14px] font-bold tracking-[-0.02em]">
            <span className="size-5 rounded-md transition-colors duration-300" style={{ backgroundColor: "var(--site-brand)" }} />
            {look.name}
          </span>
          <span className="hidden gap-4 text-[#7a7a88] sm:flex">
            <span>Fleet</span>
            <span>Reviews</span>
            <span>Contact</span>
          </span>
          <span className="ml-auto rounded-full border border-[#dcdce4] px-3 py-1 font-medium">My bookings</span>
        </div>

        {/* The headline, selected in the editor */}
        <div className="relative mt-7">
          <span className="absolute -top-6 left-0 inline-flex items-center gap-1 rounded-md bg-[#442DD7] px-1.5 py-0.5 text-[10px] font-semibold text-white">
            <PenLine className="size-3" aria-hidden /> Editing
          </span>
          <p className="min-h-[2.3em] rounded-lg px-2 py-1 text-[28px] font-bold leading-[1.12] tracking-[-0.03em] outline-dashed outline-2 outline-offset-2 outline-[#442DD7]">
            {headline}
            {typing && <span className="ml-0.5 inline-block h-[0.9em] w-[2px] translate-y-[3px] animate-pulse bg-[#442DD7]" />}
          </p>
        </div>

        {/* Booking search */}
        <div className="mt-5 flex items-center gap-1 rounded-full border border-[#dcdce4] p-1 pl-4 text-[12px]">
          <span className="min-w-0 flex-1 truncate">
            <span className="block text-[9.5px] font-semibold uppercase tracking-[0.12em] text-[#9a9aa8]">Pick-up</span>
            Downtown
          </span>
          <span className="h-7 w-px bg-[#ececf1]" aria-hidden />
          <span className="min-w-0 flex-1 truncate pl-3">
            <span className="block text-[9.5px] font-semibold uppercase tracking-[0.12em] text-[#9a9aa8]">Dates</span>
            Fri 10 – Mon 13
          </span>
          <span
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-white transition-colors duration-300"
            style={{ backgroundColor: "var(--site-brand)" }}
          >
            <Search className="size-4" aria-hidden />
          </span>
        </div>

        {/* Fleet */}
        <div className="mt-5 grid grid-cols-3 gap-2.5">
          {FLEET.map((car) => (
            <div key={car.name} className="rounded-xl border border-[#ececf1] p-2.5">
              <svg viewBox="0 18 334 122" className="h-auto w-full" aria-hidden dangerouslySetInnerHTML={{ __html: CAR }} />
              <div className="mt-1.5 truncate text-[12px] font-semibold">{car.name}</div>
              <div className="mt-0.5 flex items-center justify-between text-[11.5px]">
                <span className="text-[#7a7a88]">${car.price}/day</span>
                <span className="font-semibold transition-colors duration-300" style={{ color: "var(--site-brand)" }}>
                  Book
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const POINTS = ["On your own domain", "Your brand, your photos, your prices", "Change anything yourself, any time"];

export function BookingsSection() {
  return (
    <section id="bookings" className="h-screen w-full overflow-hidden text-white">
      <div className="mx-auto grid h-full max-w-7xl grid-rows-[auto_1fr] items-stretch gap-8 px-4 py-8 sm:px-6 lg:grid-cols-2 lg:grid-rows-1 lg:gap-16 lg:py-12">
        {/* Left: the pitch */}
        <div className="flex flex-col text-center lg:justify-center lg:text-left">
          <h2 className="text-[48px] font-black leading-[0.95] tracking-[-0.05em] sm:text-[72px] lg:text-[76px] xl:text-[92px]">
            Your own
            <br />
            booking site.
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-[19px] font-medium leading-[1.45] text-white/85 sm:text-[22px] lg:mx-0 lg:mt-8">
            Every Drive247 operator gets a booking site in their own brand, built for them when they sign up. Renters book and pay
            you direct, with no marketplace taking a cut.
          </p>
          <ul className="mx-auto mt-8 hidden space-y-3 text-[17px] font-semibold lg:mx-0 lg:block">
            {POINTS.map((p) => (
              <li key={p} className="flex items-center gap-3">
                <span className="flex size-6 items-center justify-center rounded-full bg-white text-[#442DD7]">
                  <Check className="size-3.5" strokeWidth={3} aria-hidden />
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>

        {/* Right: the site, being edited */}
        <div className="flex min-h-0 items-start justify-center lg:items-center lg:justify-end">
          <BookingSite />
        </div>
      </div>
    </section>
  );
}
