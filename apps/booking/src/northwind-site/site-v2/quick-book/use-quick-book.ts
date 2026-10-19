"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { deriveBookingRules } from "@nw/components/booking/booking-rules";
import { addDaysIso, isIsoDate, localDateToIso, todayIso } from "@nw/components/booking/time-utils";
import { firstLegalPickup, firstLegalReturn } from "@nw/components/booking/trip-window";
import { useTenant } from "@nw/contexts/TenantContext";
import {
  HOLIDAY_COLUMNS,
  OVERRIDE_COLUMNS,
  toDailyPrices,
  toHolidays,
  toVehicleOverrides,
} from "@nw/hooks/use-booking-quote";
import { useCustomer } from "@nw/hooks/use-customer";
import { useVehicleAvailability } from "@nw/hooks/use-vehicle-availability";
import { useVehicles } from "@nw/hooks/use-vehicles";
import { supabase } from "@nw/integrations/supabase/client";
import type { Holiday, VehicleDailyPrice, VehicleOverride } from "@nw/lib/domain";
import { computeQuote, QUOTE_INPUT_DEFAULTS } from "@nw/lib/quote/compute-quote";
import { toQuoteVehicle } from "@nw/lib/quote/quote-vehicle";
import type { QuoteResult } from "@nw/lib/quote/types";
import type { Vehicle } from "@nw/lib/vehicles/types";

/**
 * Quick book — PROTOTYPE (Northwind, v2). Three screens and you have a car:
 *
 *   1. when   the dates, already filled with the first legal trip
 *   2. car    only the cars free on those dates, each with its trip total,
 *             and one switch for damage protection
 *   3. pay    one total, one button
 *   → done    the car is held; verification comes after, from Trax
 *
 * Everything the screens show is real: the fleet, its availability for the
 * dates, the operator's pricing rules and the Bonzah rate card. What is NOT
 * real yet is the payment — `pay()` writes nothing and charges nothing (the
 * payment-intent function this site would call is not deployed). The plan for
 * the real one: a card HOLD (manual capture) taken here, captured once the
 * driver's licence checks out, released if it never does.
 *
 * Prices go through `computeQuote`, the same engine as the booking page, with
 * the whole fleet's rules read in one pass, so the figure on a car is the
 * figure at the end.
 */

export type QuickBookStep = "when" | "car" | "pay" | "done";

/** The one cover offered here: Bonzah's Collision Damage Waiver. */
const PROTECTION_COVER = { cdw: true, rcli: false, sli: false, pai: false } as const;
/** Bonzah needs a pickup state; the rate card is the same in every one today. */
const FALLBACK_PICKUP_STATE = "FL";

export interface Trip {
  pickupDate: string;
  pickupTime: string;
  dropoffDate: string;
  dropoffTime: string;
}

export interface PricedCar {
  vehicle: Vehicle;
  /** The trip total without protection. */
  quote: QuoteResult;
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

export function useQuickBook() {
  const { tenant } = useTenant();
  const customer = useCustomer();
  const rules = useMemo(() => deriveBookingRules(tenant), [tenant]);

  const [step, setStep] = useState<QuickBookStep>("when");
  const [trip, setTrip] = useState<Trip | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [protect, setProtect] = useState(true);
  const [guestEmail, setGuestEmail] = useState("");
  const [paying, setPaying] = useState(false);

  /** The trip on screen: what the customer chose, else the first legal one. */
  const seededTrip = useMemo<Trip>(() => {
    const first = firstLegalPickup(rules);
    return {
      pickupDate: first.date,
      pickupTime: first.slot,
      dropoffDate: firstLegalReturn(first.date, rules),
      dropoffTime: first.preferredSlot,
    };
  }, [rules]);
  const current = trip ?? seededTrip;

  const minPickupIso = addDaysIso(todayIso(), Math.max(0, Math.ceil(rules.leadTimeHours / 24)));
  const isPickupDateDisabled = useCallback(
    (date: Date) => localDateToIso(date) < minPickupIso,
    [minPickupIso],
  );
  const isReturnDateDisabled = useCallback(
    (date: Date) => {
      const iso = localDateToIso(date);
      return iso <= current.pickupDate || iso > addDaysIso(current.pickupDate, rules.maxRentalDays);
    },
    [current.pickupDate, rules.maxRentalDays],
  );

  const updateTrip = useCallback(
    (patch: Partial<Trip>) => {
      setTrip((previous) => {
        const next = { ...(previous ?? seededTrip), ...patch };
        // A pickup moved past the return drags the return to the first legal one.
        if (patch.pickupDate && next.dropoffDate <= next.pickupDate) {
          next.dropoffDate = firstLegalReturn(next.pickupDate, rules);
        }
        return next;
      });
    },
    [seededTrip, rules],
  );

  /** Whole days between pickup and return, at least 1. */
  const days = Math.max(1, Math.round((Date.parse(current.dropoffDate) - Date.parse(current.pickupDate)) / 86_400_000));

  /**
   * A range from the calendar — dragged, or tapped end to end. Either end may
   * come first; the return is held inside the tenant's minimum and maximum
   * rental, so a too-short drag still lands on a bookable trip.
   */
  const setTripRange = useCallback(
    (a: string, b: string) => {
      const pickupDate = a <= b ? a : b;
      const wanted = a <= b ? b : a;
      const floor = firstLegalReturn(pickupDate, rules);
      const ceiling = addDaysIso(pickupDate, rules.maxRentalDays);
      updateTrip({ pickupDate, dropoffDate: wanted < floor ? floor : wanted > ceiling ? ceiling : wanted });
    },
    [rules, updateTrip],
  );

  /** A single tap: the trip starts that day and keeps its length. */
  const startTripOn = useCallback(
    (iso: string) => setTripRange(iso, addDaysIso(iso, days)),
    [days, setTripRange],
  );

  const tripValid =
    isIsoDate(current.pickupDate) &&
    isIsoDate(current.dropoffDate) &&
    current.dropoffDate > current.pickupDate &&
    current.pickupTime !== "" &&
    current.dropoffTime !== "";

  /* ── the cars free for these dates, priced ───────────────────────────── */

  // Read while the dates are still being chosen, so the button can say how
  // many cars are free before the customer commits to the next screen.
  const datesForQuery = tripValid ? current : null;
  const fleet = useVehicles({
    startDate: datesForQuery?.pickupDate ?? null,
    endDate: datesForQuery?.dropoffDate ?? null,
    enabled: datesForQuery !== null,
  });
  const availability = useVehicleAvailability({
    startDate: datesForQuery?.pickupDate ?? null,
    endDate: datesForQuery?.dropoffDate ?? null,
    enabled: datesForQuery !== null,
  });

  const freeCars = useMemo(
    () => availability.filterAvailable(fleet.vehicles),
    [availability, fleet.vehicles],
  );
  const freeIds = useMemo(() => freeCars.map((v) => v.id).sort(), [freeCars]);

  const fleetRules = useQuery({
    queryKey: ["quick-book-fleet-rules", tenant?.id, freeIds],
    queryFn: () => fetchFleetRules(tenant!.id, freeIds),
    enabled: !!tenant && freeIds.length > 0,
    staleTime: 60_000,
  });

  const priceFor = useCallback(
    (vehicle: Vehicle, insurancePremium: number): QuoteResult | null => {
      if (!fleetRules.data) return null;
      return computeQuote({
        ...QUOTE_INPUT_DEFAULTS,
        tenant,
        vehicle: toQuoteVehicle(vehicle),
        pickupDate: current.pickupDate,
        dropoffDate: current.dropoffDate,
        insurancePremium,
        holidays: fleetRules.data.holidays,
        vehicleOverrides: fleetRules.data.overrides.get(vehicle.id) ?? [],
        dailyPrices: fleetRules.data.dailyPrices.get(vehicle.id) ?? [],
      });
    },
    [fleetRules.data, tenant, current.pickupDate, current.dropoffDate],
  );

  const cars = useMemo<PricedCar[]>(() => {
    const out: PricedCar[] = [];
    for (const vehicle of freeCars) {
      const quote = priceFor(vehicle, 0);
      if (quote?.ready) out.push({ vehicle, quote });
    }
    return out.sort((a, b) => a.quote.grandTotal - b.quote.grandTotal);
  }, [freeCars, priceFor]);

  const carsLoading =
    fleet.isLoading || availability.isLoading || (freeIds.length > 0 && fleetRules.isPending);

  /* ── protection: Bonzah's rate card, before any payment ──────────────── */

  const premium = useQuery({
    queryKey: ["quick-book-protection", tenant?.id, current.pickupDate, current.dropoffDate],
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase.functions.invoke("bonzah-calculate-premium", {
        body: {
          trip_start_date: current.pickupDate,
          trip_end_date: current.dropoffDate,
          pickup_state: FALLBACK_PICKUP_STATE,
          cdw_cover: PROTECTION_COVER.cdw,
          rcli_cover: PROTECTION_COVER.rcli,
          sli_cover: PROTECTION_COVER.sli,
          pai_cover: PROTECTION_COVER.pai,
        },
      });
      if (error) throw new Error(error.message);
      const total = Number((data as { total_premium?: unknown })?.total_premium);
      if (!Number.isFinite(total)) throw new Error("No premium in the response");
      return total;
    },
    enabled: !!tenant && step !== "when" && tripValid,
    staleTime: 5 * 60_000,
  });

  /** Null while the premium loads or when it could not be priced: no switch then. */
  const protectionPrice = premium.data ?? null;

  /* ── the chosen car and its final bill ───────────────────────────────── */

  const chosen = cars.find((car) => car.vehicle.id === vehicleId) ?? null;
  const protectedPremium = protect && protectionPrice !== null ? protectionPrice : 0;
  const finalQuote = useMemo(
    () => (chosen ? priceFor(chosen.vehicle, protectedPremium) : null),
    [chosen, priceFor, protectedPremium],
  );

  const isGuest = customer.status !== "authenticated";
  const guestEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail.trim());
  const canPay = finalQuote?.ready === true && (!isGuest || guestEmailValid) && !paying;

  /** PROTOTYPE: nothing is written and nothing is charged. */
  const pay = useCallback(() => {
    if (!canPay) return;
    setPaying(true);
    window.setTimeout(() => {
      setPaying(false);
      setStep("done");
    }, 1100);
  }, [canPay]);

  const chooseCar = useCallback((id: string) => {
    setVehicleId(id);
    setStep("pay");
  }, []);

  const reset = useCallback(() => {
    setStep("when");
    setTrip(null);
    setVehicleId(null);
    setProtect(true);
    setGuestEmail("");
    setPaying(false);
  }, []);

  return {
    rules,
    customer,
    step,
    setStep,
    trip: current,
    days,
    updateTrip,
    setTripRange,
    startTripOn,
    tripValid,
    isPickupDateDisabled,
    isReturnDateDisabled,
    cars,
    carsLoading,
    carsError: fleet.isError || availability.isError || fleetRules.isError,
    protect,
    setProtect,
    protectionPrice,
    protectionLoading: premium.isPending && premium.fetchStatus !== "idle",
    chosen,
    finalQuote,
    isGuest,
    guestEmail,
    setGuestEmail,
    guestEmailValid,
    canPay,
    paying,
    pay,
    chooseCar,
    reset,
  };
}

export type QuickBook = ReturnType<typeof useQuickBook>;

