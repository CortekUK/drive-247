"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { LayoutGrid, List, SlidersHorizontal, RotateCcw } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { CbpSelect } from "./field-ui";
import { Icon } from "./icons";
import { CbpModal } from "./modal";
import { useRootTheme } from "./theme-toggle";

/* ========================================================================== *
 * "Select your vehicle" — step two of the booking page, in the custom site's
 * design.
 *
 * Presentation only. The reservation engine (MultiStepBookingWidget) still
 * owns the fleet, availability, search, sort, price filters, pricing, promo
 * codes, selection and validation; it hands this component the result as
 * plain, already-formatted values, and every action goes back to it. Nothing
 * about what a customer pays is decided here.
 *
 * The one piece of state this file keeps is the category chip row, which
 * narrows what the engine has already filtered.
 * ========================================================================== */

export interface CbpCar {
  id: string;
  name: string;
  /** "2023 · Petrol" — only facts the vehicle record actually holds. */
  meta: string;
  colour: string | null;
  category: string | null;
  /** "Unlimited miles", "500 mi allowance"… */
  mileage: string;
  unlimited: boolean;
  photo: string | null;
  hasPhotos: boolean;
  pricing: {
    /** Headline figure, formatted. */
    price: string;
    /** What the headline is: "per week", "per day", "for your trip". */
    unit: string;
    /** A second rate beside it, e.g. "$72 / day". */
    aside?: string;
    /** Struck-through figure when a promo code lowered the price. */
    was?: string;
    promoError?: string | null;
    /** Trip total, unformatted — used to find the best value. */
    rank: number;
  };
}

export interface CbpTrip {
  dates: string;
  location: string;
  duration: string;
  pickup: { when: string; where: string; fee?: string };
  dropoff: { when: string; where: string; fee?: string };
}

export interface CbpTripSummary {
  vehicle: string | null;
  total: string | null;
  was?: string | null;
  lines: { label: string; value: string }[];
  note?: string | null;
}

export interface CbpPriceFilter {
  mode: "daily" | "weekly" | "monthly";
  onMode: (mode: "daily" | "weekly" | "monthly") => void;
  range: [number, number];
  bounds: [number, number];
  onRange: (range: [number, number]) => void;
  onReset: () => void;
  active: boolean;
  format: (n: number) => string;
}

export interface CbpVehicleStepProps {
  cars: CbpCar[];
  categories: string[];
  anyUnlimited: boolean;
  initialType?: string;
  selectedId: string;
  /** `toggle` deselects an already-selected car, as the Select button does. */
  onSelect: (id: string, toggle: boolean) => void;
  onOpenPhotos: (id: string) => void;
  trip: CbpTrip;
  summary: CbpTripSummary;
  onBack: () => void;
  onStartOver: () => void;
  onContinue: () => void;
  search: string;
  onSearch: (v: string) => void;
  sort: string;
  onSort: (v: string) => void;
  view: "grid" | "list";
  onView: (v: "grid" | "list") => void;
  priceFilter: CbpPriceFilter;
  onClearFilters: () => void;
  error?: string;
  help: { phone?: string | null; email?: string | null; hours?: string | null };
}

const SORTS = [
  { value: "recommended", label: "Recommended" },
  { value: "price_low", label: "Price: low to high" },
  { value: "price_high", label: "Price: high to low" },
];

const ALL = "all";
const UNLIMITED = "unlimited";

export function CbpVehicleStep(p: CbpVehicleStepProps) {
  const [chip, setChip] = useState<string>(() =>
    p.initialType && p.categories.includes(p.initialType) ? p.initialType : ALL,
  );
  const [confirmReset, setConfirmReset] = useState(false);

  // Only offer a type that has a car free for these dates — a chip that opens
  // onto "0 vehicles" is a dead end. The chip in use always stays on screen.
  const categories = useMemo(
    () => p.categories.filter(cat => cat === chip || p.cars.some(c => c.category === cat)),
    [p.categories, p.cars, chip],
  );
  const offerUnlimited = p.anyUnlimited && (chip === UNLIMITED || p.cars.some(c => c.unlimited));

  const visible = useMemo(() => p.cars.filter(c =>
    chip === ALL ? true : chip === UNLIMITED ? c.unlimited : c.category === chip,
  ), [p.cars, chip]);

  // "Best value" only means something against a real choice: the lowest trip
  // total among at least three cars on screen.
  const bestId = useMemo(() => {
    const priced = visible.filter(c => c.pricing.rank > 0);
    if (priced.length < 3) return null;
    return priced.reduce((a, b) => (b.pricing.rank < a.pricing.rank ? b : a)).id;
  }, [visible]);

  const selected = p.cars.find(c => c.id === p.selectedId) ?? null;
  const n = visible.length;

  return (
    <div className="cbp-bk">
      {/* The summary column starts level with the page head, not the fleet,
          so the whole panel — Continue included — is on screen from the top. */}
      <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_340px] xl:gap-10">
      <div className="min-w-0">
      {/* ------------------------------------------------------------ head */}
      <button type="button" onClick={p.onBack} className="cbp-bk-back">
        <Icon name="chevronLeft" className="h-3.5 w-3.5" /> Back to trip details
      </button>

      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 max-w-2xl">
          <h1 className="cbp-bk-title">Select your vehicle</h1>
          <p className="cbp-bk-sub">
            {p.cars.length === 1 ? "One car matches" : `${p.cars.length} cars match`} your dates.
            {" "}Prices exclude taxes and fees — you&apos;ll see the full total before you confirm.
          </p>
        </div>
        <button type="button" onClick={() => setConfirmReset(true)} className="cbp-btn cbp-btn-ghost cbp-bk-reset">
          <RotateCcw className="h-4 w-4" /> Start over
        </button>
      </div>

      <ul className="mt-6 flex flex-wrap gap-2.5" aria-label="Your trip">
        <li className="cbp-bk-tripchip"><Icon name="calendar" className="h-4 w-4" />{p.trip.dates}</li>
        {p.trip.location && <li className="cbp-bk-tripchip"><Icon name="pin" className="h-4 w-4" />{p.trip.location}</li>}
        <li className="cbp-bk-tripchip"><Icon name="clock" className="h-4 w-4" />{p.trip.duration}</li>
      </ul>

        {/* -------------------------------------------------------- fleet */}
        <section aria-label="Available vehicles" className="mt-8 min-w-0">
          <div className="cbp-bk-toolbar">
            <label className="cbp-fld cbp-bk-search">
              <Icon name="search" className="cbp-fld-icon" />
              <input
                value={p.search}
                onChange={e => p.onSearch(e.target.value)}
                placeholder="Search by brand, model or colour"
                aria-label="Search vehicles"
                className="cbp-fld-body w-full bg-transparent outline-none placeholder:font-medium placeholder:text-[var(--field-muted)]"
              />
            </label>
            <div className="cbp-bk-sort">
              <CbpSelect label="Sort vehicles" icon="swap" value={p.sort} onChange={p.onSort} options={SORTS} />
            </div>
            <PriceFilterButton f={p.priceFilter} />
            <div className="cbp-bk-view" role="group" aria-label="Layout">
              <button type="button" data-on={p.view === "grid"} aria-pressed={p.view === "grid"} onClick={() => p.onView("grid")} aria-label="Grid view">
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button type="button" data-on={p.view === "list"} aria-pressed={p.view === "list"} onClick={() => p.onView("list")} aria-label="List view">
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>

          {(categories.length > 0 || offerUnlimited) && (
            <div className="cbp-bk-chiprow">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Vehicle type">
                <Chip on={chip === ALL} onClick={() => setChip(ALL)}>All vehicles</Chip>
                {categories.map(cat => (
                  <Chip key={cat} on={chip === cat} onClick={() => setChip(cat)}>{titleCase(cat)}</Chip>
                ))}
                {offerUnlimited && <Chip on={chip === UNLIMITED} onClick={() => setChip(UNLIMITED)}>Unlimited miles</Chip>}
              </div>
              <p className="cbp-bk-count" aria-live="polite">{n === 1 ? "1 vehicle available" : `${n} vehicles available`}</p>
            </div>
          )}

          {p.error && <p role="alert" className="cbp-bk-error">{p.error}</p>}

          {n === 0 ? (
            <div className="cbp-card cbp-bk-empty">
              <Icon name="car" className="mx-auto h-10 w-10 text-[var(--meta)]" />
              <p className="mt-3 font-semibold text-[var(--ink)]">No vehicles match these filters</p>
              <p className="mt-1 text-sm text-[var(--body)]">Clear them to see everything available for your dates.</p>
              <button type="button" className="cbp-btn cbp-btn-ghost mt-5" onClick={() => { setChip(ALL); p.onClearFilters(); }}>
                Clear filters
              </button>
            </div>
          ) : (
            <div className={p.view === "grid" ? "cbp-bk-grid" : "cbp-bk-list"}>
              {visible.map(car => (
                <CarCard
                  key={car.id}
                  car={car}
                  layout={p.view}
                  selected={car.id === p.selectedId}
                  best={car.id === bestId}
                  onSelect={p.onSelect}
                  onOpenPhotos={p.onOpenPhotos}
                />
              ))}
            </div>
          )}
        </section>
      </div>

        {/* ------------------------------------------------------ summary */}
        <aside className="hidden lg:block">
          <div className="cbp-bk-side">
            <TripPanel p={p} selected={!!selected} />
          </div>
        </aside>
      </div>

      {/* Phones and tablets: the total and the way on, always in reach. */}
      <div className="cbp-bk-mobilebar">
        <div className="min-w-0">
          <p className="truncate text-[12px] font-semibold text-[var(--meta)]">
            {selected ? selected.name : "No vehicle chosen yet"}
          </p>
          <p className="cbp-bk-display truncate text-[20px] leading-tight text-[var(--ink)]">
            {p.summary.total ?? "—"}
          </p>
        </div>
        <button type="button" className="cbp-btn cbp-btn-primary shrink-0" disabled={!selected} onClick={p.onContinue}>
          Continue <Icon name="arrow" className="cbp-arrow h-4 w-4" />
        </button>
      </div>

      <CbpModal
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Start a new booking?"
        description="This clears your trip, vehicle and details. It can't be undone."
        icon="info"
      >
        <div className="mt-6 flex flex-wrap justify-end gap-2.5">
          <button type="button" className="cbp-btn cbp-btn-ghost" onClick={() => setConfirmReset(false)}>Keep my booking</button>
          <button type="button" className="cbp-btn cbp-btn-primary" onClick={() => { setConfirmReset(false); p.onStartOver(); }}>
            Start over
          </button>
        </div>
      </CbpModal>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="cbp-bk-chip" data-on={on} aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}

function CarCard({
  car, layout, selected, best, onSelect, onOpenPhotos,
}: {
  car: CbpCar;
  layout: "grid" | "list";
  selected: boolean;
  best: boolean;
  onSelect: (id: string, toggle: boolean) => void;
  onOpenPhotos: (id: string) => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const showImg = !!car.photo && !imgFailed;
  return (
    <article
      className="cbp-bk-car"
      data-layout={layout}
      data-selected={selected}
      data-best={best}
      onClick={() => onSelect(car.id, false)}
    >
      <div className="cbp-bk-car__media">
        {showImg ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={car.photo!} alt={car.name} loading="lazy" onError={() => setImgFailed(true)} />
        ) : (
          <Icon name="car" className="cbp-bk-car__placeholder" />
        )}
        <div className="cbp-bk-car__tl">
          {best && <span className="cbp-bk-best">Best value</span>}
          {car.hasPhotos && (
            <button
              type="button"
              className="cbp-bk-pill"
              onClick={e => { e.stopPropagation(); onOpenPhotos(car.id); }}
              aria-label={`View photos of ${car.name}`}
            >
              <Icon name="eye" className="h-3.5 w-3.5" /> Photos
            </button>
          )}
        </div>
        {selected ? (
          <span className="cbp-bk-car__tick" aria-label="Selected"><Icon name="check" className="h-4 w-4" /></span>
        ) : car.colour ? (
          <span className="cbp-bk-pill cbp-bk-car__tr">
            <span className="cbp-bk-swatch" style={{ background: swatch(car.colour) }} aria-hidden="true" />
            {car.colour}
          </span>
        ) : null}
      </div>

      <div className="cbp-bk-car__body">
        <h3 className="cbp-bk-display cbp-bk-car__name">{car.name}</h3>
        {car.meta && <p className="cbp-bk-car__meta">{car.meta}</p>}
        <div className="cbp-bk-car__tags">
          <span className="cbp-bk-tag">{car.mileage}</span>
          {car.category && <span className="cbp-bk-tag">{titleCase(car.category)}</span>}
        </div>

        <div className="cbp-bk-car__price">
          <div className="flex items-baseline justify-between gap-3">
            <span className="flex items-baseline gap-2">
              {car.pricing.was && <s className="text-sm text-[var(--meta)]">{car.pricing.was}</s>}
              <span className="cbp-bk-display cbp-bk-car__amount">{car.pricing.price}</span>
            </span>
            {car.pricing.aside && <span className="text-[12.5px] text-[var(--meta)]">{car.pricing.aside}</span>}
          </div>
          <p className="mt-1 text-[12px] text-[var(--meta)]">{car.pricing.unit} · excl. taxes &amp; fees</p>
          {car.pricing.promoError && <p className="mt-1 text-[12px] text-[#e5484d]">{car.pricing.promoError}</p>}
        </div>

        <button
          type="button"
          className="cbp-btn cbp-bk-select"
          data-selected={selected}
          aria-pressed={selected}
          onClick={e => { e.stopPropagation(); onSelect(car.id, true); }}
        >
          {selected ? <><Icon name="check" className="h-4 w-4" /> Selected</> : "Select"}
        </button>
      </div>
    </article>
  );
}

/**
 * The trip summary. It is sticky and never taller than the screen: the header
 * and the footer — estimated total and Continue — stay put, and only the
 * details between them scroll when a short or zoomed-in window cannot fit
 * everything. The way on is never below the fold.
 */
function TripPanel({ p, selected }: { p: CbpVehicleStepProps; selected: boolean }) {
  const s = p.summary;
  const ref = useFitToWindow<HTMLDivElement>();
  return (
    <div ref={ref} className="cbp-card cbp-bk-panel-trip">
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--line)] px-5 py-3.5">
        <h2 className="cbp-bk-display text-[18px] text-[var(--ink)]">Your trip</h2>
        <button type="button" onClick={p.onBack} className="text-[13px] font-semibold text-[var(--brand)] hover:underline">Edit</button>
      </div>

      <div className="cbp-bk-panel-scroll cbp-scroll">
      <ol className="cbp-bk-timeline">
        <li>
          <p className="cbp-bk-kicker">Pick-up</p>
          <p className="font-semibold text-[var(--ink)]">{p.trip.pickup.when}</p>
          <p className="text-[13px] text-[var(--body)]">{p.trip.pickup.where}</p>
          {p.trip.pickup.fee && <p className="text-[12px] text-[var(--meta)]">{p.trip.pickup.fee}</p>}
        </li>
        <li>
          <p className="cbp-bk-kicker">Return</p>
          <p className="font-semibold text-[var(--ink)]">{p.trip.dropoff.when}</p>
          <p className="text-[13px] text-[var(--body)]">{p.trip.dropoff.where}</p>
          {p.trip.dropoff.fee && <p className="text-[12px] text-[var(--meta)]">{p.trip.dropoff.fee}</p>}
        </li>
      </ol>

      <dl className="cbp-bk-rows">
        <div><dt>Duration</dt><dd className="font-semibold text-[var(--ink)]">{p.trip.duration}</dd></div>
        <div><dt>Vehicle</dt><dd className={s.vehicle ? "font-semibold text-[var(--ink)]" : ""}>{s.vehicle ?? "Not selected"}</dd></div>
        {s.lines.map(l => <div key={l.label}><dt>{l.label}</dt><dd>{l.value}</dd></div>)}
      </dl>
      {s.note && <p className="px-5 pb-3 text-[12px] text-[var(--brand)]">{s.note}</p>}
      </div>

      <div className="shrink-0 border-t border-[var(--line)] px-5 pb-4 pt-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[13.5px] text-[var(--body)]">Estimated total</span>
          <span className="flex items-baseline gap-2">
            {s.was && <s className="text-[12px] text-[var(--meta)]">{s.was}</s>}
            <span className="cbp-bk-display text-[22px] text-[var(--ink)]">{s.total ?? "—"}</span>
          </span>
        </div>
        <button type="button" className="cbp-btn cbp-btn-primary mt-3 w-full" disabled={!selected} onClick={p.onContinue}>
          {selected ? <>Continue <Icon name="arrow" className="cbp-arrow h-4 w-4" /></> : "Choose a vehicle to continue"}
        </button>
        <p className="mt-2.5 text-center text-[11.5px] leading-relaxed text-[var(--meta)]">
          Taxes, fees and any insurance are added before you pay. Nothing is charged yet.
        </p>
        <HelpLine help={p.help} />
      </div>
    </div>
  );
}

/**
 * Caps an element's height at the room left between its top edge and the
 * bottom of the window, re-measured on scroll and resize. Before the panel
 * sticks it sits lower on the page, where a fixed `100vh - header` cap would
 * still let its bottom — and Continue — fall below the fold. The stylesheet's
 * cap stays as the fallback before this runs.
 */
function useFitToWindow<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const fit = () => {
      frame = 0;
      const top = Math.max(el.getBoundingClientRect().top, 0);
      // Never squeeze below what the header and the pinned footer need.
      el.style.maxHeight = `${Math.max(window.innerHeight - top - 16, 280)}px`;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(fit); };
    fit();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return ref;
}

/** "Questions?" with the operator's own phone and email — omitted when they have neither. */
function HelpLine({ help }: { help: CbpVehicleStepProps["help"] }) {
  if (!help.phone && !help.email) return null;
  return (
    <p className="mt-2.5 flex items-start justify-center gap-1.5 border-t border-[var(--line)] pt-2.5 text-center text-[12px] text-[var(--body)]">
      <Icon name="headset" className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--brand)]" />
      <span className="min-w-0">
        Questions?{" "}
        {help.phone && <a className="font-semibold text-[var(--brand)] hover:underline" href={`tel:${help.phone.replace(/[^\d+]/g, "")}`}>{help.phone}</a>}
        {help.phone && help.email ? " · " : ""}
        {help.email && <a className="break-all font-semibold text-[var(--brand)] hover:underline" href={`mailto:${help.email}`}>{help.email}</a>}
      </span>
    </p>
  );
}

function PriceFilterButton({ f }: { f: CbpPriceFilter }) {
  const [open, setOpen] = useState(false);
  const theme = useRootTheme(open);
  const per = f.mode === "daily" ? "day" : f.mode === "weekly" ? "week" : "month";
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="cbp-fld cbp-bk-tool" data-open={open} data-active={f.active}>
          <SlidersHorizontal className="h-4 w-4 text-[var(--field-accent)]" />
          Filters
          {f.active && <span className="cbp-bk-dot" aria-label="Price filter on" />}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} collisionPadding={12} className="cbp cbp-pop cbp-bk-filters" data-theme={theme}>
          <div className="flex items-center justify-between">
            <p className="font-semibold text-[var(--ink)]">Price</p>
            <button type="button" className="text-[13px] font-semibold text-[var(--brand)] hover:underline" onClick={f.onReset}>Reset</button>
          </div>
          <div className="cbp-bk-seg mt-3" role="group" aria-label="Price per">
            {(["daily", "weekly", "monthly"] as const).map(m => (
              <button key={m} type="button" data-on={f.mode === m} aria-pressed={f.mode === m} onClick={() => f.onMode(m)}>
                {m === "daily" ? "Daily" : m === "weekly" ? "Weekly" : "Monthly"}
              </button>
            ))}
          </div>
          <p className="mt-4 text-[13px] text-[var(--body)]">
            {f.format(f.range[0])} – {f.format(f.range[1])} <span className="text-[var(--meta)]">/ {per}</span>
          </p>
          <Slider
            value={f.range}
            onValueChange={v => f.onRange(v as [number, number])}
            min={f.bounds[0]}
            max={f.bounds[1]}
            step={10}
            className="py-3"
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Operators type categories as they like ("electric", "SUV"): capitalise the first letter only. */
function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A dot for the paint name the operator typed. Unknown names fall back to a neutral grey. */
function swatch(colour: string): string {
  const c = colour.toLowerCase();
  const table: [RegExp, string][] = [
    [/black|onyx|obsidian|ebony/, "#16181d"], [/white|pearl|ivory|glacier/, "#f4f4f2"],
    [/silver|chrome/, "#c4c8ce"], [/grey|gray|graphite|gunmetal|slate|titanium/, "#8a8f98"],
    [/red|ruby|scarlet|crimson|maroon|burgundy/, "#d33a3a"], [/blue|navy|azure|cobalt|sapphire/, "#3b6fd8"],
    [/green|emerald|olive/, "#2f9a5d"], [/yellow|gold/, "#e0b43a"], [/orange|copper/, "#e07b39"],
    [/brown|bronze|beige|tan|champagne/, "#9b7a55"], [/purple|violet/, "#7a55d8"],
  ];
  return table.find(([re]) => re.test(c))?.[1] ?? "#9aa0aa";
}
