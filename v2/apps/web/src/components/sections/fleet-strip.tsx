"use client";

import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { VehicleCard } from "@/components/cards/vehicle-card";
import { FleetCardSkeleton } from "@/components/fleet/fleet-skeletons";
import { toFleetVehicle } from "@/components/fleet/fleet-vehicle";
import { useTenant } from "@/contexts/TenantContext";
import { useVehicles } from "@/hooks/use-vehicles";
import { cn } from "@/lib/utils";

/** How many cars the home-page strip previews before sending people to /fleet. */
const PREVIEW_LIMIT = 8;

const ALL_MAKES = "__all__";

/**
 * One card's width, per breakpoint.
 *
 * Deliberately narrower than the viewport at every size so the next card always
 * peeks past the right edge — that peek is what tells a phone user the row
 * scrolls. It was a flat 210px before, which was both cramped on a 360px phone
 * and pointlessly small on a 1280px desktop.
 *
 * Shared by the real cards and the skeletons so nothing resizes when the data
 * lands, and measured back off the DOM by `scrollByPage` so an arrow click
 * moves a whole number of cards.
 */
const CARD_WIDTH = "w-[250px] shrink-0 snap-start sm:w-[240px] lg:w-[260px] xl:w-[280px]";

/** The `gap-3` on the track below, in px. Kept in sync by hand — see `stride`. */
const CARD_GAP = 12;

type ScrollState = {
  /** Is there anything off-screen at all? Nothing to drive if not. */
  overflows: boolean;
  atStart: boolean;
  atEnd: boolean;
};

/**
 * Pre-measurement default. `overflows: false` keeps the arrows out of the first
 * paint: rendering them and then yanking them away is a worse flash than
 * letting them appear once we know they are needed.
 */
const UNMEASURED: ScrollState = { overflows: false, atStart: true, atEnd: true };

/**
 * The interactive body of the home-page fleet strip: the make pills, the
 * horizontal card scroller and the link out to /fleet.
 *
 * Split out of `fleet-section.tsx` so the heading above it can be a Server
 * Component and read the operator's copy from the CMS during the render rather
 * than after hydration. Everything below the heading genuinely needs the
 * browser — `activeMake` is local state — so the client boundary starts here
 * and no lower.
 *
 * Five prototype bugs died in this component:
 *
 *  1. the brand pills were decorative — the strip mapped the whole static
 *     `FLEET` fixture regardless of which pill was active, so clicking one
 *     changed the highlight and nothing else. The pills now filter, and they
 *     are built from the makes the tenant actually owns rather than a fixed
 *     list of six luxury marques;
 *  2. `BrandIcon` switched on six hardcoded slugs and returned `null` for
 *     anything else, so every real make — Tesla, Toyota, Ford, Rolls-Royce —
 *     rendered an invisible icon. Unknown makes now get the house mark;
 *  3. the row was a bare `overflow-x-auto` with the scrollbar hidden on every
 *     platform and nothing put back in its place. There was no arrow, no dot,
 *     no gradient — the eighth card just stopped mid-air and the strip read as
 *     broken rather than scrollable. It now has real prev/next buttons, which
 *     appear only when the content actually overflows and disable at each end
 *     rather than dead-clicking;
 *  4. no scroll-snap, so a swipe left cards stranded half-off both edges. The
 *     track snaps to card starts now, and `scroll-px-6` puts the snapped card
 *     against the same left edge as the padding rather than underneath it;
 *  5. changing the filter kept the old scroll offset. Picking a make with two
 *     cars while parked at the right-hand end of eight left the strip looking
 *     empty. Every filter change jumps back to the first card.
 */
export function FleetStrip() {
  const { tenant } = useTenant();
  const { vehicles, isLoading, isError } = useVehicles();
  const [activeMake, setActiveMake] = useState<string>(ALL_MAKES);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState<ScrollState>(UNMEASURED);

  const fleet = useMemo(() => vehicles.map(toFleetVehicle), [vehicles]);

  /** Makes present in the fleet, with a count each. Derived, never hardcoded. */
  const makes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const vehicle of fleet) {
      if (!vehicle.make) continue;
      counts.set(vehicle.make, (counts.get(vehicle.make) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [fleet]);

  const visible = useMemo(() => {
    const filtered =
      activeMake === ALL_MAKES
        ? fleet
        : fleet.filter((vehicle) => vehicle.make === activeMake);
    return filtered.slice(0, PREVIEW_LIMIT);
  }, [fleet, activeMake]);

  const showSkeleton = isLoading && fleet.length === 0;
  const showEmpty = !isLoading && fleet.length === 0;

  const syncScrollState = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;

    const max = el.scrollWidth - el.clientWidth;
    // A pixel of slack at both ends. Sub-pixel layout means `scrollLeft` lands
    // on 249.6 rather than 250 and on `max - 0.4` rather than `max`, and a
    // "next" button that can never disable is worse than one that disables a
    // pixel early.
    setScroll({
      overflows: max > 1,
      atStart: el.scrollLeft <= 1,
      atEnd: el.scrollLeft >= max - 1,
    });
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    syncScrollState();
    el.addEventListener("scroll", syncScrollState, { passive: true });

    // The track is observed as well as the viewport: filtering swaps the cards
    // without resizing the scroller itself, and that is exactly the case where
    // the arrows have to disappear.
    const observer = new ResizeObserver(syncScrollState);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);

    return () => {
      el.removeEventListener("scroll", syncScrollState);
      observer.disconnect();
    };
  }, [syncScrollState]);

  // Bug 5. Jump rather than animate: a filter change is a new list, not a
  // journey through the old one, and an instant reset also sidesteps
  // prefers-reduced-motion entirely.
  useEffect(() => {
    scrollerRef.current?.scrollTo({ left: 0, behavior: "auto" });
  }, [activeMake]);

  const scrollByPage = useCallback((direction: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;

    // scroller -> track -> first card. Measured rather than hardcoded because
    // `CARD_WIDTH` changes at four breakpoints and a stale constant would drift
    // the arrows off the snap points.
    const card = el.firstElementChild?.firstElementChild as HTMLElement | null;
    const stride = card ? card.offsetWidth + CARD_GAP : el.clientWidth;
    // Whole cards only, so a click always lands on a snap point. At least one,
    // in case a card ever ends up wider than the viewport.
    const perPage = Math.max(1, Math.floor(el.clientWidth / stride));

    el.scrollBy({
      left: direction * perPage * stride,
      // Read at click time instead of held in state: no hydration mismatch to
      // reconcile, and it follows an OS-level change with no listener.
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, []);

  // Hidden while the skeletons are up: there is nothing there worth driving to.
  const showControls = scroll.overflows && !showSkeleton;

  return (
    <>
      {makes.length > 1 && (
        <div
          role="group"
          aria-label="Filter by make"
          className="mt-10 flex flex-wrap items-center justify-center gap-1"
        >
          <MakePill
            label="All"
            count={fleet.length}
            active={activeMake === ALL_MAKES}
            onClick={() => setActiveMake(ALL_MAKES)}
          />
          {makes.map((make) => (
            <MakePill
              key={make.name}
              label={make.name}
              count={make.count}
              active={activeMake === make.name}
              onClick={() => setActiveMake(make.name)}
            />
          ))}
        </div>
      )}

      <div className="mt-10">
        {/* Above the track, not floating over it. Overlaid arrows would sit on
            top of a card's photo on desktop and directly on top of "Book Now"
            at 360px, where a card is most of the viewport wide. */}
        {showControls && (
          <div className="mb-4 flex items-center justify-end gap-2">
            <ScrollButton
              direction="prev"
              disabled={scroll.atStart}
              onClick={() => scrollByPage(-1)}
            />
            <ScrollButton
              direction="next"
              disabled={scroll.atEnd}
              onClick={() => scrollByPage(1)}
            />
          </div>
        )}

        {/*
          `tabIndex`/`role`/`aria-label` together, never one without the others:
          a hidden scrollbar leaves the arrow keys as the only way a keyboard
          user reaches a card that is scrolled out of view, and a focusable
          element with no role and no name is just an unexplained tab stop. Tab
          still moves straight on, so this is a stop, not a trap.

          `-outline-offset-2` draws the focus ring *inside* the box. The
          `-mx-6` full bleed puts this element's edges flush with the viewport
          on a phone, where an outset ring would be clipped away to nothing.
        */}
        <div
          ref={scrollerRef}
          tabIndex={0}
          role="group"
          aria-label="Fleet, scrollable"
          className="-mx-6 snap-x snap-mandatory scroll-px-6 overflow-x-auto px-6 pb-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-forest"
        >
          <div className="flex w-max gap-3">
            {showSkeleton
              ? Array.from({ length: 5 }, (_, index) => (
                  <div key={index} className={CARD_WIDTH}>
                    <FleetCardSkeleton />
                  </div>
                ))
              : visible.map((vehicle) => (
                  <VehicleCard
                    key={vehicle.id}
                    vehicle={vehicle}
                    currencyCode={tenant?.currency_code ?? null}
                    distanceUnit={tenant?.distance_unit ?? null}
                    className={CARD_WIDTH}
                  />
                ))}
          </div>
        </div>
      </div>

      {showEmpty && (
        <p className="mt-6 text-center text-sm text-brand-text-soft">
          {isError
            ? "We could not load the fleet just now — please try again shortly."
            : "New vehicles are being added to this fleet."}
        </p>
      )}

      <div className="mt-8 flex justify-center">
        <Link
          href="/fleet"
          className="inline-flex items-center gap-2 rounded-full border border-brand-border bg-white px-5 py-2.5 text-sm font-medium text-brand-text transition-colors hover:bg-brand-stone focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-forest/25"
        >
          View all vehicles
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>
    </>
  );
}

/**
 * One end of the carousel.
 *
 * 44px at every breakpoint, unlike `GalleryArrow` in `vehicle-gallery.tsx`
 * which drops to 36px on `lg`. That arrow overlays a photo and pixels are
 * scarce; this one sits in its own row where there is nothing to crowd, so
 * there is no reason to go under the tap-target floor on a large touchscreen.
 */
function ScrollButton({
  direction,
  disabled,
  onClick,
}: {
  direction: "prev" | "next";
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === "prev" ? "Previous vehicles" : "Next vehicles"}
      className="grid size-11 place-items-center rounded-full border border-brand-border bg-white text-brand-text transition-colors hover:bg-brand-stone focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-forest/25 disabled:cursor-default disabled:border-brand-border-soft disabled:bg-transparent disabled:text-brand-placeholder"
    >
      <Icon aria-hidden className="size-4" strokeWidth={2} />
    </button>
  );
}

/**
 * `h-11` on touch, `h-9` once there is a pointer: 36px was under the 44px tap
 * target floor, and this row is the first thing a phone user aims at. The
 * desktop pill is unchanged.
 */
function MakePill({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm transition-all sm:h-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest/30",
        active
          ? "border border-brand-border-soft bg-white text-brand-text shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
          : "border border-transparent text-brand-text-subtle hover:text-brand-text",
      )}
    >
      <BrandIcon make={label} active={active} />
      {label}
      <span className="text-xs tabular-nums text-brand-text-subtle">{count}</span>
    </button>
  );
}

/** "Aston Martin" -> "aston-martin", so the icon map can key off a real make. */
function makeSlug(make: string): string {
  return make.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function BrandIcon({ make, active }: { make: string; active: boolean }) {
  const color = active ? "#111210" : "#8a8c88";

  switch (makeSlug(make)) {
    case "bentley":
      return (
        <svg width="18" height="14" viewBox="0 0 18 14" fill="none" aria-hidden>
          <path
            d="M1 7 L5 3 L9 5 L13 3 L17 7 L13 11 L9 9 L5 11 L1 7Z"
            stroke={color}
            strokeWidth="0.6"
          />
          <circle cx="9" cy="7" r="1" fill={color} />
        </svg>
      );
    case "aston-martin":
      return (
        <svg width="20" height="10" viewBox="0 0 20 10" fill="none" aria-hidden>
          <path
            d="M10 5 L1 3 L4 5 L1 7 L10 5 L19 3 L16 5 L19 7 L10 5Z"
            stroke={color}
            strokeWidth="0.6"
          />
          <circle cx="10" cy="5" r="0.9" fill={color} />
        </svg>
      );
    case "audi":
      return (
        <svg width="22" height="10" viewBox="0 0 22 10" fill="none" aria-hidden>
          <circle cx="4" cy="5" r="3.2" stroke={color} strokeWidth="0.6" />
          <circle cx="8.5" cy="5" r="3.2" stroke={color} strokeWidth="0.6" />
          <circle cx="13" cy="5" r="3.2" stroke={color} strokeWidth="0.6" />
          <circle cx="17.5" cy="5" r="3.2" stroke={color} strokeWidth="0.6" />
        </svg>
      );
    case "bmw":
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <circle cx="7" cy="7" r="6" stroke={color} strokeWidth="0.7" />
          <path d="M7 1 V7 L13 7" stroke={color} strokeWidth="0.7" />
          <path d="M7 13 V7 L1 7" stroke={color} strokeWidth="0.7" />
        </svg>
      );
    case "chevrolet":
      return (
        <svg width="18" height="10" viewBox="0 0 18 10" fill="none" aria-hidden>
          <path
            d="M1 4 H7 V1 H11 V4 H17 V6 H11 V9 H7 V6 H1 Z"
            stroke={color}
            strokeWidth="0.6"
            fill="none"
          />
        </svg>
      );
    case "lexus":
      return (
        <svg width="20" height="12" viewBox="0 0 20 12" fill="none" aria-hidden>
          <ellipse cx="10" cy="6" rx="8" ry="5" stroke={color} strokeWidth="0.6" />
          <path d="M11 3 L8 8 H13" stroke={color} strokeWidth="0.6" />
        </svg>
      );
    default:
      // The house mark. Previously `null`, which meant every make outside the
      // six hardcoded slugs rendered nothing at all.
      return (
        <svg width="16" height="12" viewBox="0 0 16 12" fill="none" aria-hidden>
          <circle cx="8" cy="6" r="4.6" stroke={color} strokeWidth="0.6" />
          <circle cx="8" cy="6" r="1.1" fill={color} />
        </svg>
      );
  }
}
