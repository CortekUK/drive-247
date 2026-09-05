"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { useTenant } from "@/contexts/TenantContext";
import { supabase } from "@/integrations/supabase/client";
import type { Holiday, VehicleDailyPrice, VehicleOverride } from "@/lib/domain";
import {
  EMPTY_QUOTE,
  QUOTE_INPUT_DEFAULTS,
  computeQuote,
} from "@/lib/quote/compute-quote";
import type {
  QuoteInput,
  QuoteResult,
  QuoteVehicle,
} from "@/lib/quote/types";

/**
 * The live booking quote.
 *
 * A thin wrapper: it gathers the tenant (from context), the tenant's dynamic
 * pricing rules (one query), and whatever the caller already holds — vehicle,
 * extras, dates, options — then hands the lot to `computeQuote`, which is where
 * all the arithmetic lives. Nothing is added up here.
 *
 * The pricing rules are fetched HERE rather than left to the caller on purpose.
 * Holidays and per-vehicle overrides change the base rental price, and a caller
 * who forgot to pass them would not see an error — they would just quote a
 * price with the operator's surcharges silently missing. Making that the hook's
 * own job means it cannot be forgotten. A caller who already has the rows may
 * still pass them in to skip the round-trip.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic pricing rules
// ─────────────────────────────────────────────────────────────────────────────

const HOLIDAY_COLUMNS =
  "id, name, start_date, end_date, surcharge_percent, excluded_vehicle_ids, recurs_annually";
const OVERRIDE_COLUMNS =
  "id, vehicle_id, rule_type, holiday_id, override_type, fixed_price, custom_percent";
const DAILY_PRICE_COLUMNS = "date, price";

interface PricingRules {
  holidays: Holiday[];
  vehicleOverrides: VehicleOverride[];
  dailyPrices: VehicleDailyPrice[];
}

const EMPTY_RULES: PricingRules = { holidays: [], vehicleOverrides: [], dailyPrices: [] };

const isRuleType = (value: string): value is VehicleOverride["rule_type"] =>
  value === "weekend" || value === "holiday";

const isOverrideType = (value: string): value is VehicleOverride["override_type"] =>
  value === "fixed_price" || value === "custom_percent" || value === "excluded";

/**
 * Load every rule that can move the base rental price.
 *
 * Three parallel reads rather than one join: overrides and manual day prices are
 * keyed on the vehicle while holidays are keyed on the tenant, and a vehicle
 * with no overrides must still get the tenant's holidays.
 */
async function fetchPricingRules(
  tenantId: string,
  vehicleId: string | null,
): Promise<PricingRules> {
  const [holidaysRes, overridesRes, dailyPricesRes] = await Promise.all([
    supabase
      .from("tenant_holidays")
      .select(HOLIDAY_COLUMNS)
      .eq("tenant_id", tenantId)
      .order("start_date", { ascending: true }),
    vehicleId
      ? supabase.from("vehicle_pricing_overrides").select(OVERRIDE_COLUMNS).eq("vehicle_id", vehicleId)
      : null,
    vehicleId
      ? supabase.from("vehicle_daily_prices").select(DAILY_PRICE_COLUMNS).eq("vehicle_id", vehicleId)
      : null,
  ]);

  // Surfacing the PostgREST message matters here: it names the offending column,
  // which is the fastest way to spot a missing `anon` grant on a new column.
  if (holidaysRes.error) throw new Error(holidaysRes.error.message);
  if (overridesRes?.error) throw new Error(overridesRes.error.message);
  if (dailyPricesRes?.error) throw new Error(dailyPricesRes.error.message);

  const holidays: Holiday[] = (holidaysRes.data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    start_date: row.start_date,
    end_date: row.end_date,
    // `numeric` arrives as a string over PostgREST; a string percentage would
    // corrupt the surcharge maths.
    surcharge_percent: Number(row.surcharge_percent) || 0,
    excluded_vehicle_ids: row.excluded_vehicle_ids ?? [],
    // NULL means "never set", and an unset holiday is a one-off, not recurring.
    recurs_annually: row.recurs_annually === true,
  }));

  // A row whose rule_type or override_type is not one the engine understands is
  // dropped rather than coerced: guessing at an unknown pricing rule would
  // charge the customer something nobody configured.
  const vehicleOverrides: VehicleOverride[] = (overridesRes?.data ?? []).flatMap((row) => {
    if (!isRuleType(row.rule_type) || !isOverrideType(row.override_type)) return [];
    return [
      {
        id: row.id,
        vehicle_id: row.vehicle_id,
        rule_type: row.rule_type,
        holiday_id: row.holiday_id,
        fixed_price: row.fixed_price === null ? null : Number(row.fixed_price),
        custom_percent: row.custom_percent === null ? null : Number(row.custom_percent),
        override_type: row.override_type,
      },
    ];
  });

  const dailyPrices: VehicleDailyPrice[] = (dailyPricesRes?.data ?? []).map((row) => ({
    date: row.date,
    price: Number(row.price) || 0,
  }));

  return { holidays, vehicleOverrides, dailyPrices };
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Everything `computeQuote` needs except the tenant (taken from context) and the
 * pricing rules (fetched here). Only the vehicle and the two dates are required;
 * every other field falls back to `QUOTE_INPUT_DEFAULTS`.
 *
 * Keep `extras` and `selectedExtras` referentially stable — a React Query array
 * and a `useState` object both are — or the memo below recomputes each render.
 * The maths is cheap, but a fresh result object on every render defeats any
 * memoisation downstream of it.
 */
export interface UseBookingQuoteParams
  extends Partial<Omit<QuoteInput, "tenant" | "vehicle" | "pickupDate" | "dropoffDate">> {
  vehicle: QuoteVehicle | null;
  /** YYYY-MM-DD, or null before the customer has picked dates. */
  pickupDate: string | null;
  /** YYYY-MM-DD, or null before the customer has picked dates. */
  dropoffDate: string | null;
}

export interface UseBookingQuoteResult {
  /** The bill. `quote.ready` is false until it is a real price. */
  quote: QuoteResult;
  /** True while the tenant or its pricing rules are still loading. */
  isLoading: boolean;
  /**
   * The pricing rules could not be read, so the quote was computed without
   * holiday/override surcharges and may UNDERSTATE the price. Block checkout on
   * this — do not take a payment against a total we know might be short.
   */
  pricingRulesDegraded: boolean;
  error: string | null;
}

export function useBookingQuote(params: UseBookingQuoteParams): UseBookingQuoteResult {
  const { tenant, isLoading: tenantLoading, error: tenantError } = useTenant();
  const {
    vehicle,
    pickupDate,
    dropoffDate,
    extras = QUOTE_INPUT_DEFAULTS.extras,
    selectedExtras = QUOTE_INPUT_DEFAULTS.selectedExtras,
    promo = QUOTE_INPUT_DEFAULTS.promo,
    installmentPlanSelected = QUOTE_INPUT_DEFAULTS.installmentPlanSelected,
    pickupDelivery = QUOTE_INPUT_DEFAULTS.pickupDelivery,
    returnDelivery = QUOTE_INPUT_DEFAULTS.returnDelivery,
    addUnlimitedMileage = QUOTE_INPUT_DEFAULTS.addUnlimitedMileage,
    insurancePremium = QUOTE_INPUT_DEFAULTS.insurancePremium,
    collectPaymentUpfront = QUOTE_INPUT_DEFAULTS.collectPaymentUpfront,
    holidays: holidaysOverride,
    vehicleOverrides: overridesOverride,
    dailyPrices: dailyPricesOverride,
  } = params;

  const tenantId = tenant?.id ?? null;
  const vehicleId = vehicle?.id ?? null;
  // A caller that supplied all three rule sets needs no round-trip at all.
  const rulesProvided =
    holidaysOverride !== undefined &&
    overridesOverride !== undefined &&
    dailyPricesOverride !== undefined;

  const rulesQuery = useQuery({
    queryKey: ["booking-quote-pricing-rules", tenantId, vehicleId],
    queryFn: () => {
      // `enabled` already guarantees this, but a query that silently ran with an
      // empty tenant id would return an empty rule set — i.e. a quote with the
      // operator's surcharges missing, and no error anywhere to show for it.
      if (!tenantId) throw new Error("No tenant resolved: cannot price a booking");
      return fetchPricingRules(tenantId, vehicleId);
    },
    enabled: !!tenantId && !rulesProvided,
    staleTime: 60_000,
  });

  const rules: PricingRules = rulesProvided
    ? {
        holidays: holidaysOverride,
        vehicleOverrides: overridesOverride,
        dailyPrices: dailyPricesOverride,
      }
    : (rulesQuery.data ?? EMPTY_RULES);

  // Still fetching the rules? Do not price yet. Computing now would show a total
  // with no surcharges and then jump when the rows land — and a customer who
  // read the first number is entitled to be annoyed by the second.
  const rulesPending = !rulesProvided && !!tenantId && rulesQuery.isPending;
  const rulesDegraded = !rulesProvided && rulesQuery.isError;

  const holidays = rules.holidays;
  const vehicleOverrides = rules.vehicleOverrides;
  const dailyPrices = rules.dailyPrices;

  const quote = useMemo<QuoteResult>(() => {
    if (rulesPending) return EMPTY_QUOTE;
    return computeQuote({
      tenant,
      vehicle,
      pickupDate,
      dropoffDate,
      extras,
      selectedExtras,
      promo,
      installmentPlanSelected,
      pickupDelivery,
      returnDelivery,
      addUnlimitedMileage,
      insurancePremium,
      collectPaymentUpfront,
      holidays,
      vehicleOverrides,
      dailyPrices,
    });
  }, [
    rulesPending,
    tenant,
    vehicle,
    pickupDate,
    dropoffDate,
    extras,
    selectedExtras,
    promo,
    installmentPlanSelected,
    pickupDelivery,
    returnDelivery,
    addUnlimitedMileage,
    insurancePremium,
    collectPaymentUpfront,
    holidays,
    vehicleOverrides,
    dailyPrices,
  ]);

  return {
    quote,
    isLoading: tenantLoading || rulesPending,
    pricingRulesDegraded: rulesDegraded,
    error: tenantError ?? (rulesQuery.error ? rulesQuery.error.message : null),
  };
}
