"use client";

import { useMutation } from "@tanstack/react-query";
import { formatInTimeZone } from "date-fns-tz";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import {
  buildFleetQuote,
  shiftLocalDate,
  type FleetQuoteBlock,
  type FleetQuoteRental,
  type FleetQuoteResult,
  type FleetQuoteVehicle,
} from "@/lib/fleet-quote";
import type { Holiday, VehicleOverride } from "@/lib/calculate-rental-price";

export interface FleetQuoteSearch {
  startDate: string;
  endDate: string;
  pickupTime: string;
  returnTime: string;
}

const PAGE_SIZE = 1_000;
const ID_CHUNK_SIZE = 100;

async function fetchEveryPage<T>(makeQuery: () => any): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await makeQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function safeTimezone(value: unknown): string {
  if (typeof value !== "string" || !value) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return value;
  } catch {
    return "UTC";
  }
}

function nonNegativeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function weekendDays(value: unknown): number[] {
  if (!Array.isArray(value)) return [6, 0];
  const valid = [...new Set(value.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))];
  return valid.length ? valid : [6, 0];
}

async function fetchForVehicleChunks<T>(
  vehicleIds: string[],
  makeQuery: (ids: string[]) => any,
): Promise<T[]> {
  const pages = await Promise.all(
    chunks(vehicleIds, ID_CHUNK_SIZE).map((ids) => fetchEveryPage<T>(() => makeQuery(ids))),
  );
  return pages.flat();
}

export async function loadFleetQuote(
  tenantId: string,
  search: FleetQuoteSearch,
): Promise<FleetQuoteResult> {
  const holdingStatuses = [
    "Pending", "Active", "Upcoming", "Confirmed", "Started",
    "pending", "active", "upcoming", "confirmed", "started",
  ];

  // Buffer duration is needed before querying recently completed rentals;
  // those vehicles remain unavailable while cleaning/turnaround is in force.
  const settingsResult = await (supabase as any)
    .from("tenants")
    .select("buffer_time_minutes, monthly_tier_days, weekend_surcharge_percent, weekend_days, stack_surcharges, timezone, security_deposit_enabled, deposit_mode, global_deposit_amount")
    .eq("id", tenantId)
    .single();
  if (settingsResult.error) throw settingsResult.error;
  const settings = settingsResult.data ?? {};
  const timezone = safeTimezone(settings.timezone);
  const bufferMinutes = nonNegativeNumber(settings.buffer_time_minutes);
  const completedRentalFloor = shiftLocalDate(
    search.startDate,
    -(Math.ceil(bufferMinutes / 1_440) + 1),
  );
  const holdingRentalCeiling = shiftLocalDate(
    search.endDate,
    Math.ceil(bufferMinutes / 1_440) + 1,
  );

  const [vehicles, rentals, completedRentals, blocks, holidays] = await Promise.all([
    fetchEveryPage<FleetQuoteVehicle>(() =>
      (supabase as any)
        .from("vehicles")
        .select("id, reg, make, model, year, category, status, is_disposed, available_daily, available_weekly, available_monthly, daily_rent, weekly_rent, monthly_rent, security_deposit, photo_url, vehicle_photos(photo_url, display_order)")
        .eq("tenant_id", tenantId)
        .order("id", { ascending: true }),
    ),
    fetchEveryPage<FleetQuoteRental>(() =>
      (supabase as any)
        .from("rentals")
        .select("id, vehicle_id, start_date, end_date, pickup_time, return_time, status, is_pay_as_you_go, payg_closed_at")
        .eq("tenant_id", tenantId)
        .in("status", holdingStatuses)
        .lte("start_date", holdingRentalCeiling)
        .order("id", { ascending: true }),
    ),
    bufferMinutes > 0
      ? fetchEveryPage<FleetQuoteRental>(() =>
          (supabase as any)
            .from("rentals")
            .select("id, vehicle_id, start_date, end_date, pickup_time, return_time, status, is_pay_as_you_go, payg_closed_at")
            .eq("tenant_id", tenantId)
            .in("status", ["Completed", "completed", "Closed", "closed"])
            .not("end_date", "is", null)
            .gte("end_date", completedRentalFloor)
            .lte("end_date", search.startDate)
            .order("id", { ascending: true }),
        )
      : Promise.resolve([] as FleetQuoteRental[]),
    fetchEveryPage<FleetQuoteBlock>(() =>
      (supabase as any)
        .from("blocked_dates")
        .select("vehicle_id, start_date, end_date, reason")
        .eq("tenant_id", tenantId)
        .lte("start_date", search.endDate)
        .gte("end_date", search.startDate)
        .order("start_date", { ascending: true }),
    ),
    fetchEveryPage<Holiday>(() =>
      (supabase as any)
        .from("tenant_holidays")
        .select("id, name, start_date, end_date, surcharge_percent, excluded_vehicle_ids, recurs_annually")
        .eq("tenant_id", tenantId)
        .order("start_date", { ascending: true }),
    ),
  ]);
  const vehicleIds = vehicles.map((vehicle) => vehicle.id).filter(Boolean);

  const [overrides, dailyPrices] = vehicleIds.length
    ? await Promise.all([
        fetchForVehicleChunks<VehicleOverride>(vehicleIds, (ids) =>
          (supabase as any)
            .from("vehicle_pricing_overrides")
            .select("id, vehicle_id, rule_type, holiday_id, override_type, fixed_price, custom_percent")
            .in("vehicle_id", ids)
            .order("id", { ascending: true }),
        ),
        fetchForVehicleChunks<{ vehicle_id: string; date: string; price: number }>(vehicleIds, (ids) =>
          (supabase as any)
            .from("vehicle_daily_prices")
            .select("vehicle_id, date, price")
            .in("vehicle_id", ids)
            .gte("date", search.startDate)
            .lte("date", search.endDate)
            .order("date", { ascending: true }),
        ),
      ])
    : [[], []];

  const surcharge = nonNegativeNumber(settings.weekend_surcharge_percent);
  const monthlyTierDays = nonNegativeNumber(settings.monthly_tier_days, 30);
  return buildFleetQuote(vehicles, [...rentals, ...completedRentals], blocks, {
    ...search,
    bufferMinutes,
    timezone,
    today: formatInTimeZone(new Date(), timezone, "yyyy-MM-dd"),
    monthlyTierDays: Math.max(7, monthlyTierDays),
    securityDepositEnabled: settings.security_deposit_enabled !== false,
    depositMode: settings.deposit_mode === "per_vehicle" ? "per_vehicle" : "global",
    globalSecurityDeposit: nonNegativeNumber(settings.global_deposit_amount),
    weekendConfig: surcharge > 0
      ? {
          weekend_surcharge_percent: surcharge,
          weekend_days: weekendDays(settings.weekend_days),
          stack_surcharges: settings.stack_surcharges === true,
        }
      : null,
    holidays: holidays.map((holiday) => ({
      ...holiday,
      surcharge_percent: Number(holiday.surcharge_percent ?? 0),
      excluded_vehicle_ids: holiday.excluded_vehicle_ids ?? [],
      recurs_annually: holiday.recurs_annually === true,
    })),
    overrides: overrides.map((override) => ({
      ...override,
      fixed_price: override.fixed_price == null ? null : Number(override.fixed_price),
      custom_percent: override.custom_percent == null ? null : Number(override.custom_percent),
    })),
    dailyPrices: dailyPrices.map((price) => ({ ...price, price: Number(price.price) })),
  });
}

export function useFleetQuote() {
  const { tenant } = useTenant();
  const mutation = useMutation({
    mutationFn: async (search: FleetQuoteSearch) => {
      if (!tenant?.id) throw new Error("Your tenant could not be loaded. Refresh and try again.");
      return loadFleetQuote(tenant.id, search);
    },
  });

  return {
    generate: mutation.mutateAsync,
    isGenerating: mutation.isPending,
    error: mutation.error,
  };
}
