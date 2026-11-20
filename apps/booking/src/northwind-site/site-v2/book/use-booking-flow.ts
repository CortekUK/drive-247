"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { deriveBookingRules } from "@nw/components/booking/booking-rules";
import {
  addDaysIso,
  formatHourSpan,
  formatIsoDateLabel,
  isIsoDate,
  localDateToIso,
  resolveBrowserTimezone,
  todayIso,
  zonedWallClockToInstant,
} from "@nw/components/booking/time-utils";
import {
  firstLegalPickup,
  firstLegalReturnDay,
  firstLegalReturnSlot,
  isReturnSlotLegal,
} from "@nw/components/booking/trip-window";
import { formatMoney } from "@nw/components/fleet/format";
import {
  EMPTY_FILTERS,
  activeFilters,
  buildFleetFacets,
  countActiveFilters,
  filterVehicles,
  type ActiveFilter,
  type FleetFilters,
} from "@nw/components/fleet/fleet-filters";
import { toFleetVehicle, type FleetVehicle } from "@nw/components/fleet/fleet-vehicle";
import { useTenant } from "@nw/contexts/TenantContext";
import {
  HOLIDAY_COLUMNS,
  OVERRIDE_COLUMNS,
  toDailyPrices,
  toHolidays,
  toVehicleOverrides,
} from "@nw/hooks/use-booking-quote";
import { useVehicleAvailability } from "@nw/hooks/use-vehicle-availability";
import { useVehicles } from "@nw/hooks/use-vehicles";
import { supabase } from "@nw/integrations/supabase/client";
import { readTripIntentFromLocation, withTripIntent } from "@nw/lib/booking/trip-intent";
import type { Holiday, VehicleDailyPrice, VehicleOverride } from "@nw/lib/domain";
import { computeQuote, QUOTE_INPUT_DEFAULTS } from "@nw/lib/quote/compute-quote";
import { toQuoteVehicle } from "@nw/lib/quote/quote-vehicle";
import type { QuoteResult } from "@nw/lib/quote/types";
import { useBookingStore } from "@nw/lib/stores/booking-store";
import type { Vehicle } from "@nw/lib/vehicles/types";

/**
 * The booking flow (Northwind, v2) — its own page at /booking, not a dialog.
 *
 *   1. trip   pickup and return: the dates on the calendar, the times in
 *             quarter hours, in the operator's time zone
 *   2. car    only the cars free on those dates, each priced for the whole
 *             trip, with filters and a sort
 *   → checkout  the chosen car's own page (/booking/<id>), dates carried over
 *             through the booking store, for location, extras, details and pay
 *
 * The step lives in the URL (?step=car) so the browser's back and forward
 * buttons move between steps; the trip and the car live in sessionStorage so a
 * refresh does not throw them away. Prices go through `computeQuote`, the same
 * engine as the checkout, so the figure on a car is the figure at the end.
 * Pricing and availability are the quick-book prototype's (`use-quick-book`).
 */

export type FlowStep = "trip" | "car";
export const FLOW_STEPS: readonly FlowStep[] = ["trip", "car"];

export type CarSort = "price_low" | "price_high" | "year_new";
export const CAR_SORTS: readonly { value: CarSort; label: string }[] = [
  { value: "price_low", label: "Lowest total" },
  { value: "price_high", label: "Highest total" },
  { value: "year_new", label: "Newest first" },
];

export interface Trip {
  pickupDate: string;
  pickupTime: string;
  dropoffDate: string;
  dropoffTime: string;
}

export interface PricedCar {
  vehicle: Vehicle;
  fleet: FleetVehicle;
  /** The whole trip, before any extras or cover. */
  quote: QuoteResult;
}

const STORAGE_KEY = "drive247-v2-booking-flow";

interface Saved {
  trip: Trip | null;
  vehicleId: string | null;
}

function readSaved(): Saved | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Saved>;
    const t = parsed.trip;
    const trip =
      t && isIsoDate(t.pickupDate) && isIsoDate(t.dropoffDate) && typeof t.pickupTime === "string" && typeof t.dropoffTime === "string"
        ? t
        : null;
    return { trip, vehicleId: typeof parsed.vehicleId === "string" ? parsed.vehicleId : null };
  } catch {
    return null;
  }
}

function writeSaved(saved: Saved | null) {
  try {
    if (saved === null) window.sessionStorage.removeItem(STORAGE_KEY);
    else window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Private mode or blocked storage: the flow still works, it just forgets on refresh.
  }
}

interface FleetRules {
  holidays: Holiday[];
  overrides: Map<string, VehicleOverride[]>;
  dailyPrices: Map<string, VehicleDailyPrice[]>;
}

async function fetchFleetRules(tenantId: string, vehicleIds: string[]): Promise<FleetRules> {
  const [holidaysRes, overridesRes, dailyRes] = await Promise.all([
    supabase.from("tenant_holidays").select(HOLIDAY_COLUMNS).eq("tenant_id", tenantId),
    supabase.from("vehicle_pricing_overrides").select(OVERRIDE_COLUMNS).in("vehicle_id", vehicleIds),
    supabase.from("vehicle_daily_prices").select("vehicle_id, date, price").in("vehicle_id", vehicleIds),
  ]);
  if (holidaysRes.error) throw new Error(holidaysRes.error.message);
  if (overridesRes.error) throw new Error(overridesRes.error.message);
  if (dailyRes.error) throw new Error(dailyRes.error.message);

  const overrides = new Map<string, VehicleOverride[]>();
  for (const rule of toVehicleOverrides(overridesRes.data ?? [])) {
    overrides.set(rule.vehicle_id, [...(overrides.get(rule.vehicle_id) ?? []), rule]);
  }
  const dailyPrices = new Map<string, VehicleDailyPrice[]>();
  for (const row of dailyRes.data ?? []) {
    dailyPrices.set(row.vehicle_id, [...(dailyPrices.get(row.vehicle_id) ?? []), ...toDailyPrices([row])]);
  }
  return { holidays: toHolidays(holidaysRes.data ?? []), overrides, dailyPrices };
}

/** "America/New_York" → { city: "New York", name: "Eastern Daylight Time", short: "EDT" }. */
export function describeTimezone(zone: string, at: Date = new Date()) {
  const part = (style: "long" | "short") => {
    try {
      return (
        new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: style })
          .formatToParts(at)
          .find((p) => p.type === "timeZoneName")?.value ?? ""
      );
    } catch {
      return "";
    }
  };
  const city = (zone.split("/").pop() ?? zone).replace(/_/g, " ");
  return { zone, city, name: part("long") || zone, short: part("short") };
}

export function useBookingFlow() {
  const { tenant } = useTenant();
  const rules = useMemo(() => deriveBookingRules(tenant), [tenant]);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  /* ── what is saved across a refresh ──────────────────────────────────── */

  const [trip, setTrip] = useState<Trip | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    const saved = readSaved();
    if (saved) {
      // A trip saved yesterday may have slipped behind the lead time: drop it.
      if (saved.trip && saved.trip.pickupDate >= firstLegalPickup(rules).date) setTrip(saved.trip);
      setVehicleId(saved.vehicleId);
    }
    setRestored(true);
    // Read once, when the page opens; `rules` only moves the floor above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (restored) writeSaved({ trip, vehicleId });
  }, [restored, trip, vehicleId]);

  /* ── the step, in the URL ────────────────────────────────────────────── */

  const step: FlowStep = searchParams?.get("step") === "car" ? "car" : "trip";

  // Where a click is taking the page while the route catches up: the page
  // shows that screen's skeleton at once instead of sitting on the old one.
  const [navigating, startNavigating] = useTransition();
  const [target, setTarget] = useState<FlowStep | "checkout" | null>(null);
  const pending = navigating ? target : null;

  const goTo = useCallback(
    (next: FlowStep) => {
      setTarget(next);
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      if (next === "trip") params.delete("step");
      else params.set("step", next);
      const query = params.toString();
      const path = pathname ?? "/booking";
      startNavigating(() => router.push(query === "" ? path : `${path}?${query}`, { scroll: false }));
      // A jump, not a glide: the new step animates in, and a smooth scroll
      // running under that entrance reads as the page lurching.
      if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    },
    [pathname, router, searchParams],
  );

  /* ── the trip ────────────────────────────────────────────────────────── */

  const first = useMemo(() => firstLegalPickup(rules), [rules]);
  const seededTrip = useMemo<Trip>(() => {
    // The return floor follows the clock: a 10:00 pickup under a 1 day 2 hours
    // minimum opens on tomorrow from 12:00, not the day after.
    const dropoffDate = firstLegalReturnDay(first.date, first.slot, rules);
    return {
      pickupDate: first.date,
      pickupTime: first.slot,
      dropoffDate,
      dropoffTime: firstLegalReturnSlot(first.date, first.slot, dropoffDate, rules, first.preferredSlot) ?? first.preferredSlot,
    };
  }, [first, rules]);
  const current = trip ?? seededTrip;
  const tripTouched = trip !== null;
  /**
   * The last time the calendar pulled the return back inside the shortest or
   * longest rental — said in the calendar's hint, so a moved date is never a
   * silent one. Replaced by the next range the customer picks.
   */
  const [moved, setMoved] = useState<{ rule: "minimum" | "maximum"; to: string } | null>(null);

  const minPickupIso = addDaysIso(todayIso(), Math.max(0, Math.ceil(rules.leadTimeHours / 24)));
  const isPickupDateDisabled = useCallback((date: Date) => localDateToIso(date) < minPickupIso, [minPickupIso]);

  /** A pickup slot is open when it clears the lead time, judged in the operator's zone. */
  const isPickupSlotOpen = useCallback(
    (date: string, slot: string) => {
      const instant = zonedWallClockToInstant(date, slot, rules.operatorTimezone);
      return instant !== null && instant.getTime() >= Date.now() + rules.leadTimeHours * 3_600_000;
    },
    [rules.leadTimeHours, rules.operatorTimezone],
  );

  /** A return slot is open when it is at least the shortest rental after the pickup on screen. */
  const isReturnSlotOpen = useCallback(
    (date: string, slot: string) => isReturnSlotLegal(current.pickupDate, current.pickupTime, date, slot, rules),
    [current.pickupDate, current.pickupTime, rules],
  );

  /**
   * Puts a draft trip inside the rules: the pickup slot clears the lead time,
   * and the return sits at least the shortest rental after it — first the day
   * (when no slot on it is far enough), then the slot. Says when the day moved.
   */
  const settle = useCallback(
    (draft: Trip): { trip: Trip; dayMoved: boolean } => {
      const next = { ...draft };
      let dayMoved = false;
      // A pickup moved past the return drags the return to the first legal one.
      if (next.dropoffDate <= next.pickupDate) {
        next.dropoffDate = firstLegalReturnDay(next.pickupDate, next.pickupTime, rules);
      }
      // A pickup day whose chosen time is now too soon takes its first open slot.
      if (!isPickupSlotOpen(next.pickupDate, next.pickupTime)) {
        next.pickupTime = rules.timeSlots.find((slot) => isPickupSlotOpen(next.pickupDate, slot)) ?? next.pickupTime;
      }
      const latest = rules.timeSlots[rules.timeSlots.length - 1] ?? next.dropoffTime;
      if (!isReturnSlotLegal(next.pickupDate, next.pickupTime, next.dropoffDate, latest, rules)) {
        const day = firstLegalReturnDay(next.pickupDate, next.pickupTime, rules);
        dayMoved = day !== next.dropoffDate;
        next.dropoffDate = day;
      }
      next.dropoffTime =
        firstLegalReturnSlot(next.pickupDate, next.pickupTime, next.dropoffDate, rules, next.dropoffTime) ?? next.dropoffTime;
      return { trip: next, dayMoved };
    },
    [rules, isPickupSlotOpen],
  );

  const updateTrip = useCallback(
    (patch: Partial<Trip>) => {
      const { trip: next, dayMoved } = settle({ ...current, ...patch });
      setTrip(next);
      if (dayMoved) setMoved({ rule: "minimum", to: next.dropoffDate });
    },
    [current, settle],
  );

  /** Whole days between pickup and return, at least 1. */
  const days = Math.max(1, Math.round((Date.parse(current.dropoffDate) - Date.parse(current.pickupDate)) / 86_400_000));

  /** A range from the calendar, either end first; the return is held inside the minimum and maximum rental. */
  const setTripRange = useCallback(
    (a: string, b: string) => {
      const pickupDate = a <= b ? a : b;
      const wanted = a <= b ? b : a;
      // The pickup slot this trip will have — a new pickup day may move it.
      const pickupTime = isPickupSlotOpen(pickupDate, current.pickupTime)
        ? current.pickupTime
        : (rules.timeSlots.find((slot) => isPickupSlotOpen(pickupDate, slot)) ?? current.pickupTime);
      const floor = firstLegalReturnDay(pickupDate, pickupTime, rules);
      const ceiling = addDaysIso(pickupDate, rules.maxRentalDays);
      const dropoffDate = wanted < floor ? floor : wanted > ceiling ? ceiling : wanted;
      // A return pulled inside the rules is said in the hint, not slipped in.
      setMoved(dropoffDate === wanted ? null : { rule: wanted < floor ? "minimum" : "maximum", to: dropoffDate });
      updateTrip({ pickupDate, pickupTime, dropoffDate });
    },
    [rules, current.pickupTime, isPickupSlotOpen, updateTrip],
  );

  /** A single tap: the trip starts that day and keeps its length. */
  const startTripOn = useCallback((iso: string) => setTripRange(iso, addDaysIso(iso, days)), [days, setTripRange]);

  /** A length preset: the same pickup, a new return. */
  const setLength = useCallback(
    (lengthDays: number) => setTripRange(current.pickupDate, addDaysIso(current.pickupDate, lengthDays)),
    [current.pickupDate, setTripRange],
  );

  const tripValid =
    isIsoDate(current.pickupDate) &&
    isIsoDate(current.dropoffDate) &&
    current.dropoffDate > current.pickupDate &&
    current.pickupTime !== "" &&
    current.dropoffTime !== "" &&
    isPickupSlotOpen(current.pickupDate, current.pickupTime) &&
    isReturnSlotOpen(current.dropoffDate, current.dropoffTime);

  /** Why the calendar moved the return, for its hint. */
  const tripNote = useMemo(() => {
    if (!moved) return null;
    const to = formatIsoDateLabel(moved.to);
    return moved.rule === "minimum"
      ? `The shortest rental is ${formatHourSpan(rules.minRentalHours)}, so your return moved to ${to}.`
      : `The longest rental is ${rules.maxRentalDays} days, so your return moved to ${to}.`;
  }, [moved, rules.minRentalHours, rules.maxRentalDays]);

  /* ── time zones ──────────────────────────────────────────────────────── */

  const operatorZone = useMemo(() => describeTimezone(rules.operatorTimezone), [rules.operatorTimezone]);
  // The viewer's own zone is only known in the browser; read after mount.
  const [viewerZone, setViewerZone] = useState<string>("");
  useEffect(() => setViewerZone(resolveBrowserTimezone()), []);
  const viewerDiffers = viewerZone !== "" && viewerZone !== rules.operatorTimezone;

  /* ── the cars free for these dates, priced ───────────────────────────── */

  const datesForQuery = tripValid ? current : null;
  const fleet = useVehicles({
    startDate: datesForQuery?.pickupDate ?? null,
    endDate: datesForQuery?.dropoffDate ?? null,
    enabled: datesForQuery !== null,
  });
  const availability = useVehicleAvailability({
    startDate: datesForQuery?.pickupDate ?? null,
    endDate: datesForQuery?.dropoffDate ?? null,
    // With the times, a car back at 10:00 is offered again from 10:00 plus the buffer.
    pickupTime: datesForQuery?.pickupTime ?? null,
    dropoffTime: datesForQuery?.dropoffTime ?? null,
    enabled: datesForQuery !== null,
  });

  const freeCars = useMemo(() => availability.filterAvailable(fleet.vehicles), [availability, fleet.vehicles]);
  const bookedCars = useMemo(() => {
    const free = new Set(freeCars.map((v) => v.id));
    return fleet.vehicles.filter((v) => !free.has(v.id)).map(toFleetVehicle);
  }, [fleet.vehicles, freeCars]);
  const freeIds = useMemo(() => freeCars.map((v) => v.id).sort(), [freeCars]);

  const fleetRules = useQuery({
    queryKey: ["booking-flow-fleet-rules", tenant?.id, freeIds],
    queryFn: () => fetchFleetRules(tenant!.id, freeIds),
    enabled: !!tenant && freeIds.length > 0,
    staleTime: 60_000,
  });

  const cars = useMemo<PricedCar[]>(() => {
    if (!fleetRules.data) return [];
    const out: PricedCar[] = [];
    for (const vehicle of freeCars) {
      const quote = computeQuote({
        ...QUOTE_INPUT_DEFAULTS,
        tenant,
        vehicle: toQuoteVehicle(vehicle),
        pickupDate: current.pickupDate,
        dropoffDate: current.dropoffDate,
        holidays: fleetRules.data.holidays,
        vehicleOverrides: fleetRules.data.overrides.get(vehicle.id) ?? [],
        dailyPrices: fleetRules.data.dailyPrices.get(vehicle.id) ?? [],
      });
      if (quote.ready) out.push({ vehicle, fleet: toFleetVehicle(vehicle), quote });
    }
    return out;
  }, [fleetRules.data, freeCars, tenant, current.pickupDate, current.dropoffDate]);

  const carsLoading = datesForQuery !== null && (fleet.isLoading || availability.isLoading || (freeIds.length > 0 && fleetRules.isPending));
  const cheapest = useMemo(
    () => cars.reduce<PricedCar | null>((low, car) => (low === null || car.quote.grandTotal < low.quote.grandTotal ? car : low), null),
    [cars],
  );

  /* ── filters and sort ────────────────────────────────────────────────── */

  const [filters, setFilters] = useState<FleetFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<CarSort>("price_low");
  const currencyCode = tenant?.currency_code ?? null;

  const fleetCars = useMemo(() => cars.map((car) => car.fleet), [cars]);
  const facets = useMemo(() => buildFleetFacets(fleetCars, filters), [fleetCars, filters]);
  const results = useMemo(() => {
    const keep = new Set(filterVehicles(fleetCars, filters).map((v) => v.id));
    const list = cars.filter((car) => keep.has(car.vehicle.id));
    const by: Record<CarSort, (a: PricedCar, b: PricedCar) => number> = {
      price_low: (a, b) => a.quote.grandTotal - b.quote.grandTotal,
      price_high: (a, b) => b.quote.grandTotal - a.quote.grandTotal,
      year_new: (a, b) => (b.vehicle.year ?? 0) - (a.vehicle.year ?? 0),
    };
    return list.sort((a, b) => by[sort](a, b) || a.fleet.name.localeCompare(b.fleet.name));
  }, [cars, fleetCars, filters, sort]);

  const chips = useMemo(
    () =>
      activeFilters(filters, facets.priceBounds, {
        category: (value) => facets.categories.find((facet) => facet.value === value)?.label ?? value,
        price: (min, max) => `${formatMoney(min, currencyCode)} – ${formatMoney(max, currencyCode)} / day`,
      }),
    [filters, facets, currencyCode],
  );
  const activeFilterCount = countActiveFilters(filters, facets.priceBounds);
  const clearFilters = useCallback(() => setFilters(EMPTY_FILTERS), []);
  const removeChip = useCallback((chip: ActiveFilter) => setFilters((f) => chip.remove(f)), []);

  /* ── the chosen car ──────────────────────────────────────────────────── */

  // Held only while it is still free and priced for the dates on screen.
  const chosen = cars.find((car) => car.vehicle.id === vehicleId) ?? null;
  const chooseCar = useCallback((id: string | null) => setVehicleId(id), []);

  /**
   * On to checkout: the car's own page reads the dates from the booking store,
   * keeping any it already holds that are still legal — so they are written
   * there first, for this car.
   */
  const continueToCheckout = useCallback(() => {
    if (!chosen || !tripValid) return;
    const store = useBookingStore.getState();
    store.startVehicle(chosen.vehicle.id);
    store.patch({
      pickupDate: current.pickupDate,
      pickupTime: current.pickupTime,
      dropoffDate: current.dropoffDate,
      dropoffTime: current.dropoffTime,
    });
    // Addresses typed in the home page's search (?pickup= / ?dropoff=) ride along.
    setTarget("checkout");
    startNavigating(() => router.push(withTripIntent(`/booking/${chosen.vehicle.id}`, readTripIntentFromLocation())));
  }, [chosen, tripValid, current, router]);

  const startOver = useCallback(() => {
    setTrip(null);
    setMoved(null);
    setVehicleId(null);
    setFilters(EMPTY_FILTERS);
    setSort("price_low");
    goTo("trip");
  }, [goTo]);

  return {
    rules,
    step,
    goTo,
    pending,
    restored,
    trip: current,
    tripTouched,
    days,
    updateTrip,
    setTripRange,
    startTripOn,
    setLength,
    tripValid,
    isPickupDateDisabled,
    isPickupSlotOpen,
    isReturnSlotOpen,
    tripNote,
    operatorZone,
    viewerZone,
    viewerDiffers,
    cars,
    bookedCars,
    cheapest,
    carsLoading,
    carsError: fleet.isError || availability.isError || fleetRules.isError,
    filters,
    setFilters,
    sort,
    setSort,
    facets,
    results,
    chips,
    activeFilterCount,
    clearFilters,
    removeChip,
    currencyCode,
    distanceUnit: tenant?.distance_unit ?? null,
    chosen,
    chooseCar,
    continueToCheckout,
    startOver,
  };
}

export type BookingFlow = ReturnType<typeof useBookingFlow>;
