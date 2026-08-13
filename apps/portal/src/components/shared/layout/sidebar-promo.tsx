"use client";

import { useState, useEffect } from "react";
import { Sparkles, X, ArrowRight } from "lucide-react";

// Bump this key when you ship a new banner so it re-appears for users who
// dismissed the previous one.
const DISMISS_KEY = "sidebar-promo:fleet-calendar-v3";

/**
 * Mock promo / announcement banner for the bottom of the sidebar — a glossy,
 * 3D "liquid glass" card (sculpted depth via layered highlights + shadows,
 * a single soft light source, minimal movement). Use this slot for feature
 * releases, training, or promotions. Dismissal persists via localStorage.
 *
 * The gradient runs down the darker half of the brand chart ramp (3 → 4 → 5)
 * rather than a fixed indigo. Two reasons it is the ramp and not `primary`
 * alone: a single colour flattens the card, and the ramp's lower steps stay
 * dark enough that the white text on top survives a pale brand colour. Every
 * shadow is neutral black for the same reason — an indigo-tinted shadow read
 * as a bruise against any other hue.
 */
export function SidebarPromo() {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
  }, []);

  if (dismissed) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  return (
    <div
      className="group relative isolate overflow-hidden rounded-xl p-2.5 text-white
        bg-gradient-to-br from-[hsl(var(--chart-3))] via-[hsl(var(--chart-4))] to-[hsl(var(--chart-5))]
        ring-1 ring-inset ring-white/20
        shadow-[0_16px_32px_-12px_rgba(0,0,0,0.55),0_4px_10px_-4px_rgba(0,0,0,0.35),inset_0_1px_0_0_rgba(255,255,255,0.5),inset_0_-8px_16px_-8px_rgba(0,0,0,0.45)]
        transition-transform duration-200 ease-out hover:-translate-y-0.5"
    >
      {/* Static glossy top sheen — the glass reflection */}
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-1/2 bg-gradient-to-b from-white/30 to-transparent" />
      {/* Single soft light source (top-left) for a 3D feel */}
      <div className="pointer-events-none absolute -left-10 -top-12 -z-10 h-28 w-28 rounded-full bg-white/35 blur-2xl" />

      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-1.5 top-1.5 z-10 cursor-pointer rounded-md p-1 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      <div className="relative">
        <div className="mb-1.5 inline-flex h-6 w-6 items-center justify-center rounded-lg bg-white/25 ring-1 ring-inset ring-white/40 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.6),0_3px_6px_-2px_rgba(0,0,0,0.4)]">
          <Sparkles className="h-3.5 w-3.5 drop-shadow" />
        </div>

        <div className="flex items-center gap-1.5">
          <span className="rounded-full bg-white/25 px-1.5 py-px text-[8px] font-bold uppercase tracking-wide ring-1 ring-inset ring-white/30 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.4)]">
            New
          </span>
          <p className="text-[12px] font-semibold leading-tight drop-shadow-sm">Fleet Calendar</p>
        </div>

        <p className="mt-0.5 text-[10.5px] leading-snug text-white/85">
          Drag-to-block dates and see your entire fleet at a glance.
        </p>

        <button className="mt-2 inline-flex w-full cursor-pointer items-center justify-center gap-1 rounded-lg bg-white/20 px-2 py-1 text-[11px] font-semibold ring-1 ring-inset ring-white/30 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.5),0_3px_8px_-2px_rgba(0,0,0,0.4)] transition-all hover:bg-white/30 active:translate-y-px">
          Explore <ArrowRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
