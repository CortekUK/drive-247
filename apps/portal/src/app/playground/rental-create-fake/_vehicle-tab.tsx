"use client";

/**
 * Vehicle tab — DESIGN SANDBOX. Nothing here is real.
 *
 * No Supabase, no tenant, no network. The fleet below is six hardcoded rows and
 * six photos that ship in `public/images/playground/`.
 *
 * The idea being tested: picking the car should feel like walking the lot, not
 * reading a dropdown. So the tab is a search bar over a grid of photo cards —
 * type a make and the grid narrows to it; type nothing and you see the whole
 * fleet. The card carries the things an operator actually recognises a car by,
 * in that order: the picture, the plate, the money.
 *
 * DELIBERATELY ABSENT — availability on future dates. Whether this car is free
 * for the hire window is the Dates tab's job, and putting a second, weaker
 * answer to that question here would just give the operator two things to
 * disagree with each other. The status chip on a card is present tense only.
 *
 * OWNS: search text, nothing else. Which vehicle is selected lives on the host
 * page, because the rail summary, the page title and the daily rate all read it.
 *
 * Renders its own `Panel` — drop it straight into the tab switch, do not wrap it
 * in a second one.
 */

import { useMemo, useState } from "react";
import Image from "next/image";
import { Search, X, Check, Users, Fuel, Cog, Gauge } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import {
  getMileageTier,
  getTierMileage,
  calculateTotalMileageAllowance,
  isUnlimitedMileage,
  getUnlimitedMileageOption,
  type MileageTier,
} from "@/lib/mileage-utils";
import { money, Panel, Field, inputCls, cardCls, OptionCard, EmptyHint } from "@/app/playground/_shared";

/* ══════════════════════════════════════════════════════════════════════════
   The fleet
   ══════════════════════════════════════════════════════════════════════════ */

export type SandboxVehicle = {
  id: string;
  /** `${make} ${model}` — the host page's rail and hero title read this. */
  name: string;
  make: string;
  model: string;
  year: number;
  /** Plate. The host writes this into the agreement and the insurance policy. */
  reg: string;
  colour: string;
  /** Daily rate. The host seeds the rental's rate from it, then lets it be overridden. */
  rate: number;
  seats: number;
  fuel: string;
  transmission: string;
  /** A local file under `public/images/playground/`. */
  image: string;
  /**
   * Exactly the shape `@/lib/mileage-utils` reads, so the REAL tier maths runs
   * here unchanged. All three tiers null means the car is inherently unlimited
   * and there is nothing for the operator to decide.
   */
  mileage: {
    daily_mileage: number | null;
    weekly_mileage: number | null;
    monthly_mileage: number | null;
    excess_mileage_rate: number;
    unlimited_mileage_available: boolean;
    unlimited_mileage_price_daily: number | null;
    unlimited_mileage_price_weekly: number | null;
    unlimited_mileage_price_monthly: number | null;
    current_mileage: number;
  };
  /**
   * Present tense only. NOT an availability model — see the note at the top of
   * the file. A car that is out today is still selectable, because the rental
   * being planned may not start today.
   */
  status: "available" | "on_rent";
  /** Only meaningful for `on_rent`. Flavour on the card; nothing reads it. */
  returnsOn?: string;
};

/*
 * Names match the photographs. The six pictures are a silver Civic, a blue
 * Fusion, a red Malibu, a black Accord, a white Elantra and a blue Sentra — so
 * that is what the fleet is. Labelling one of them a BMW would have made the
 * "type BMW" demo return a card, at the cost of the one thing this tab exists to
 * prove: that you recognise the car from its picture. Honda is the make with two
 * cars in it, so typing "Honda" is the filter demo instead; typing "BMW" is the
 * empty-state demo.
 */
export const VEHICLES: SandboxVehicle[] = [
  {
    id: "v1",
    name: "Honda Civic",
    make: "Honda",
    model: "Civic",
    year: 2022,
    reg: "8JKR204",
    colour: "Silver",
    rate: 72,
    seats: 5,
    fuel: "Petrol",
    transmission: "CVT",
    image: "/images/playground/car1.jpeg",
    mileage: {
      daily_mileage: 200,
      weekly_mileage: 1000,
      monthly_mileage: 3000,
      excess_mileage_rate: 0.35,
      unlimited_mileage_available: true,
      unlimited_mileage_price_daily: 120,
      unlimited_mileage_price_weekly: 350,
      unlimited_mileage_price_monthly: 900,
      current_mileage: 24118,
    },
    status: "available",
  },
  {
    id: "v2",
    name: "Ford Fusion",
    make: "Ford",
    model: "Fusion",
    year: 2020,
    reg: "4TZM918",
    colour: "Blue",
    rate: 68,
    seats: 5,
    fuel: "Hybrid",
    transmission: "Automatic",
    image: "/images/playground/car2.jpeg",
    mileage: {
      daily_mileage: 150,
      weekly_mileage: 800,
      monthly_mileage: 2400,
      excess_mileage_rate: 0.40,
      unlimited_mileage_available: true,
      unlimited_mileage_price_daily: 100,
      unlimited_mileage_price_weekly: 300,
      unlimited_mileage_price_monthly: 750,
      current_mileage: 41202,
    },
    status: "on_rent",
    returnsOn: "12 Sep",
  },
  {
    id: "v3",
    name: "Chevrolet Malibu",
    make: "Chevrolet",
    model: "Malibu",
    year: 2023,
    reg: "9BLC537",
    colour: "Red",
    rate: 84,
    seats: 5,
    fuel: "Petrol",
    transmission: "Automatic",
    image: "/images/playground/car3.jpeg",
    mileage: {
      daily_mileage: 250,
      weekly_mileage: 1200,
      monthly_mileage: 3500,
      excess_mileage_rate: 0.30,
      unlimited_mileage_available: false,
      unlimited_mileage_price_daily: null,
      unlimited_mileage_price_weekly: null,
      unlimited_mileage_price_monthly: null,
      current_mileage: 12660,
    },
    status: "available",
  },
  {
    id: "v4",
    name: "Honda Accord",
    make: "Honda",
    model: "Accord",
    year: 2023,
    reg: "6HNA118",
    colour: "Black",
    rate: 95,
    seats: 5,
    fuel: "Hybrid",
    transmission: "Automatic",
    image: "/images/playground/car4.jpeg",
    mileage: {
      daily_mileage: null,
      weekly_mileage: null,
      monthly_mileage: null,
      excess_mileage_rate: 0.00,
      unlimited_mileage_available: false,
      unlimited_mileage_price_daily: null,
      unlimited_mileage_price_weekly: null,
      unlimited_mileage_price_monthly: null,
      current_mileage: 8940,
    },
    status: "available",
  },
  {
    id: "v5",
    name: "Hyundai Elantra",
    make: "Hyundai",
    model: "Elantra",
    year: 2021,
    reg: "2QWE740",
    colour: "White",
    rate: 58,
    seats: 5,
    fuel: "Petrol",
    transmission: "CVT",
    image: "/images/playground/car5.jpeg",
    mileage: {
      daily_mileage: 150,
      weekly_mileage: 750,
      monthly_mileage: 2200,
      excess_mileage_rate: 0.35,
      unlimited_mileage_available: true,
      unlimited_mileage_price_daily: 90,
      unlimited_mileage_price_weekly: 260,
      unlimited_mileage_price_monthly: 650,
      current_mileage: 55317,
    },
    status: "on_rent",
    returnsOn: "9 Sep",
  },
  {
    id: "v6",
    name: "Nissan Sentra",
    make: "Nissan",
    model: "Sentra",
    year: 2022,
    reg: "5RDN862",
    colour: "Blue",
    rate: 61,
    seats: 5,
    fuel: "Petrol",
    transmission: "CVT",
    image: "/images/playground/car6.jpeg",
    mileage: {
      daily_mileage: 200,
      weekly_mileage: 950,
      monthly_mileage: 2800,
      excess_mileage_rate: 0.35,
      unlimited_mileage_available: true,
      unlimited_mileage_price_daily: 110,
      unlimited_mileage_price_weekly: 320,
      unlimited_mileage_price_monthly: 820,
      current_mileage: 31045,
    },
    status: "available",
  },
];

/* ══════════════════════════════════════════════════════════════════════════
   Mileage
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Mileage lives on the Vehicle stage and nowhere else, because it is not a
 * setting of the rental — it is a property of the car, resolved for this hire.
 * Which tier applies is decided by how long the rental runs, so the answer
 * changes when the dates change: a six-day booking on the Civic gets the daily
 * tier and 1,200 miles, a ten-day booking gets the weekly tier and pro-rata.
 * That is exactly why the block cannot appear until a car is chosen, and why it
 * has to be told the duration.
 *
 * The tier maths is `@/lib/mileage-utils` — the SAME module the live booking
 * flow and the v1 rental form use, not a sandbox reimplementation of it.
 */
export type MileagePlan = {
  tier: MileageTier;
  tierLabel: string;
  /** The car has no tier limits at all — there is nothing to decide. */
  inherentlyUnlimited: boolean;
  upgradeAvailable: boolean;
  /** Flat one-off charge for the upgrade on this booking. */
  upgradeAmount: number;
  /** Whether the upgrade is actually taken. */
  unlimited: boolean;
  /** Miles included across the whole hire. Null when unlimited. */
  allowance: number | null;
  excessRate: number;
  /** One line, written into the agreement. */
  label: string;
};

const TIER_LABEL: Record<MileageTier, string> = {
  daily: "Daily tier",
  weekly: "Weekly tier",
  monthly: "Monthly tier",
};

const TIER_UNIT: Record<MileageTier, string> = { daily: "day", weekly: "week", monthly: "month" };

export function mileagePlan(
  vehicle: SandboxVehicle | null,
  days: number,
  unlimited: boolean
): MileagePlan | null {
  if (!vehicle) return null;

  const span = Math.max(1, days);
  const tier = getMileageTier(span);
  const inherentlyUnlimited = isUnlimitedMileage(vehicle.mileage);
  const upgrade = getUnlimitedMileageOption(vehicle.mileage, span);
  const taken = unlimited && upgrade.available;

  const perUnit = getTierMileage(vehicle.mileage, tier);
  const allowance =
    inherentlyUnlimited || taken ? null : calculateTotalMileageAllowance(vehicle.mileage, span);

  const label =
    allowance === null
      ? "Unlimited"
      : days > 0
        ? `${allowance.toLocaleString("en-US")} miles`
        : `${(perUnit ?? 0).toLocaleString("en-US")} miles per ${TIER_UNIT[tier]}`;

  return {
    tier,
    tierLabel: TIER_LABEL[tier],
    inherentlyUnlimited,
    upgradeAvailable: upgrade.available,
    upgradeAmount: upgrade.flatAmount,
    unlimited: taken,
    allowance,
    excessRate: vehicle.mileage.excess_mileage_rate,
    label,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   Search
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Everything about a car that a person might reasonably type, flattened into one
 * lowercase string. The plate goes in twice — once as written and once with the
 * separators stripped — so "8jkr" finds "8JKR 204" and "8jkr204" does too.
 */
const haystack = (v: SandboxVehicle) =>
  [
    v.make,
    v.model,
    v.name,
    v.reg,
    v.reg.replace(/[\s-]/g, ""),
    String(v.year),
    v.colour,
    v.fuel,
    v.transmission,
    `${v.seats} seats`,
    v.status === "available" ? "available" : "on rent",
  ]
    .join(" ")
    .toLowerCase();

/** Built once at module load — the fleet is a constant. */
const INDEX = VEHICLES.map((v) => ({ v, hay: haystack(v) }));

const MAKES = Array.from(new Set(VEHICLES.map((v) => v.make)));

/** "Honda, Ford, Chevrolet, Hyundai and Nissan" */
const makeList = MAKES.length > 1 ? `${MAKES.slice(0, -1).join(", ")} and ${MAKES[MAKES.length - 1]}` : MAKES[0];

/* ══════════════════════════════════════════════════════════════════════════
   Tab
   ══════════════════════════════════════════════════════════════════════════ */

export function VehicleTab({
  selectedId,
  onSelect,
  days,
  unlimitedMileage,
  onUnlimitedMileage,
}: {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Billed days, from the When & where stage. Decides which mileage tier applies. */
  days: number;
  unlimitedMileage: boolean;
  onUnlimitedMileage: (on: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim();

  /** Every word must match something, so "honda hybrid" narrows twice. */
  const results = useMemo(() => {
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return VEHICLES;
    return INDEX.filter(({ hay }) => tokens.every((t) => hay.includes(t))).map(({ v }) => v);
  }, [q]);

  const selected = VEHICLES.find((v) => v.id === selectedId) ?? null;
  const hasSelection = selected !== null;
  const plan = mileagePlan(selected, days, unlimitedMileage);

  /** A make chip is lit only when the box holds exactly that make and nothing else. */
  const activeMake = MAKES.find((m) => m.toLowerCase() === q.toLowerCase()) ?? null;

  return (
    <Panel
      title="Vehicle"
      description="Which car goes out. Changing it later re-prices the rental and flags the agreement."
      toolbar={
        /* The placeholder names a real make and a real spec on purpose: the
           fastest way to learn that this box searches more than the model is to
           be told what else to try. A JS comment, not a JSX one — a prop
           expression holds a single expression, not a comment plus an element. */
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the fleet — try “Honda”, “hybrid”, a colour or a plate"
              aria-label="Search the fleet"
              className={cn(inputCls, "h-11 pl-11 pr-11")}
            />
            {q !== "" && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {/* The chips are shortcuts into the same search — one piece of state, so
              they can never disagree with what is in the box. */}
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant={q === "" ? "default" : "outline"} onClick={() => setQuery("")}>
              All
            </Button>
            {MAKES.map((m) => (
              <Button
                key={m}
                size="sm"
                variant={activeMake === m ? "default" : "outline"}
                onClick={() => setQuery(m)}
              >
                {m}
              </Button>
            ))}
          </div>
        </div>
      }
    >
      {/* ── count + the way out of a selection ─────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {q === ""
            ? `${VEHICLES.length} cars in the fleet`
            : `${results.length} of ${VEHICLES.length} match “${q}”`}
        </p>
        {hasSelection && (
          <Button size="xs" variant="ghost" onClick={() => onSelect(null)}>
            <X />
            Clear selection
          </Button>
        )}
      </div>

      {/* ── the one rental-specific thing the car carries ──────────────────
          It sits between the selection and the fleet, not in a stage of its
          own, because it is unanswerable until a car exists and it is the only
          question choosing a car actually opens. */}
      {selected && plan && (
        <MileageBlock
          vehicle={selected}
          plan={plan}
          days={days}
          onUnlimited={onUnlimitedMileage}
        />
      )}

      {/* ── the fleet ──────────────────────────────────────────────────────
          Two columns only above xl. The screen already spends 560px on its two
          rails, so a third column would land at about 240px — too narrow for a
          photo to be worth showing, which is the whole point of the card. */}
      {results.length === 0 ? (
        <div className="space-y-4">
          <EmptyHint>
            <span className="block">
              Nothing in the fleet matches <span className="font-medium text-foreground">“{q}”</span>.
            </span>
            <span className="mt-1 block">
              You run {makeList}. Try a make, a model, a colour or a plate.
            </span>
          </EmptyHint>
          <div className="flex justify-center">
            <Button variant="outline" onClick={() => setQuery("")}>
              Show the whole fleet
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {results.map((v) => (
            <VehicleCard
              key={v.id}
              vehicle={v}
              selected={selectedId === v.id}
              onClick={() => onSelect(v.id)}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Card
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The selected/idle treatment is `_shared`'s `OptionCard` verbatim — a card that
 * picks something should not look different here than it does three tabs away.
 * Everything inside the button is a `<span>` for the same reason `OptionCard`'s
 * is: a `<div>` inside a `<button>` is not phrasing content.
 */
function VehicleCard({
  vehicle: v,
  selected,
  onClick,
}: {
  vehicle: SandboxVehicle;
  selected: boolean;
  onClick: () => void;
}) {
  const available = v.status === "available";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "group flex cursor-pointer flex-col overflow-hidden rounded-4xl text-left transition-all",
        selected
          ? "bg-primary-light ring-2 ring-primary/40"
          : "bg-card shadow-md ring-1 ring-foreground/5 hover:ring-primary/30 dark:ring-foreground/10"
      )}
    >
      {/* `overflow-hidden` + the card's own radius on the button is what clips
          the photo into the rounded top corners. */}
      <span className="relative block aspect-[16/10] w-full overflow-hidden bg-muted">
        <Image
          src={v.image}
          alt={`${v.year} ${v.name}`}
          fill
          sizes="(min-width: 1280px) 24rem, (min-width: 768px) 40rem, 100vw"
          className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
        />

        {/* Legible over a photograph, which a translucent muted chip is not. */}
        <span
          className={cn(
            "absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-card/90 px-2.5 py-1 text-[11px] font-medium backdrop-blur-sm",
            available ? "text-success" : "text-muted-foreground"
          )}
        >
          <span className={cn("size-1.5 rounded-full", available ? "bg-success" : "bg-muted-foreground/50")} />
          {available ? "Available" : v.returnsOn ? `On rent until ${v.returnsOn}` : "On rent"}
        </span>

        {selected && (
          <span className="absolute right-3 top-3 flex size-6 items-center justify-center rounded-full bg-primary shadow-md">
            <Check className="size-3.5 text-primary-foreground" strokeWidth={3} />
          </span>
        )}
      </span>

      <span className="block p-5">
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block truncate font-heading text-sm font-medium">{v.name}</span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {v.year} · {v.colour} · {v.reg}
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="block text-sm font-semibold">{money(v.rate)}</span>
            <span className="block text-[11px] text-muted-foreground">per day</span>
          </span>
        </span>

        <span className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Users className="size-3.5" />
            {v.seats} seats
          </span>
          <span className="inline-flex items-center gap-1">
            <Fuel className="size-3.5" />
            {v.fuel}
          </span>
          <span className="inline-flex items-center gap-1">
            <Cog className="size-3.5" />
            {v.transmission}
          </span>
        </span>
      </span>
    </button>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Mileage block
   ══════════════════════════════════════════════════════════════════════════ */

function MileageBlock({
  vehicle,
  plan,
  days,
  onUnlimited,
}: {
  vehicle: SandboxVehicle;
  plan: MileagePlan;
  days: number;
  onUnlimited: (on: boolean) => void;
}) {
  const included = calculateTotalMileageAllowance(vehicle.mileage, Math.max(1, days));
  const perUnit = getTierMileage(vehicle.mileage, plan.tier);

  return (
    <div className={cn(cardCls, "p-6")}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Gauge className="size-4 text-primary" />
          <div>
            <p className="font-heading text-sm font-semibold">Mileage on the {vehicle.name}</p>
            <p className="text-[11px] text-muted-foreground">
              {days > 0
                ? `${plan.tierLabel} · ${days} day${days === 1 ? "" : "s"}`
                : "Priced against the daily tier until the dates are set"}
            </p>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Odometer reads {vehicle.mileage.current_mileage.toLocaleString("en-US")} mi
        </p>
      </div>

      {plan.inherentlyUnlimited ? (
        <p className="rounded-3xl bg-muted/40 px-5 py-4 text-sm text-muted-foreground ring-1 ring-foreground/5">
          This car has no mileage limits set, so the hire is unlimited and there is nothing to decide.
        </p>
      ) : (
        <>
          <Field label="Allowance">
            <div className={cn("grid gap-3", plan.upgradeAvailable ? "grid-cols-2" : "grid-cols-1")}>
              <OptionCard
                selected={!plan.unlimited}
                onClick={() => onUnlimited(false)}
                title={
                  days > 0 && included !== null
                    ? `${included.toLocaleString("en-US")} miles included`
                    : "Included allowance"
                }
                subtitle={`${(perUnit ?? 0).toLocaleString("en-US")} miles per ${
                  plan.tier === "daily" ? "day" : plan.tier === "weekly" ? "week" : "month"
                }`}
              />
              {/* Only when the car actually has a price configured for this tier —
                  `getUnlimitedMileageOption` is what decides that, not this file. */}
              {plan.upgradeAvailable && (
                <OptionCard
                  selected={plan.unlimited}
                  onClick={() => onUnlimited(true)}
                  title="Unlimited"
                  subtitle={`${money(plan.upgradeAmount)} one-off on this booking`}
                />
              )}
            </div>
          </Field>

          <p className="mt-3 text-xs text-muted-foreground">
            {plan.unlimited
              ? "No excess charge — the customer can drive as far as they like."
              : `Anything over the allowance is charged at $${plan.excessRate.toFixed(
                  2
                )} a mile, reckoned from the two odometer readings at handover.`}
            {!plan.upgradeAvailable && !plan.unlimited && " This car has no unlimited upgrade configured."}
          </p>
        </>
      )}
    </div>
  );
}
