'use client';

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { formatDateOnly, parseDateOnly, todayDateString } from '@/lib/domain';
import type { UnavailableReason } from '@/lib/vehicles/types';

/* ══════════════════════════ the occupancy rule ══════════════════════════
 * Ported from apps/booking/src/lib/vehicle-availability.ts. Pure, so it can be
 * reused by the checkout guard and unit-tested without a client.
 */

/**
 * Rental statuses that still HOLD a vehicle — the car has not been released
 * back to the fleet. Anything outside this set (Cancelled, Rejected, Closed,
 * Completed) frees the car.
 */
export const OPEN_RENTAL_STATUSES = [
  'Pending',
  'Active',
  'Upcoming',
  'Confirmed',
  'Started',
] as const;

/** Filter literal for `.not('status', 'in', …)` — the complement of the above. */
const RELEASED_RENTAL_STATUSES = '(Cancelled,Rejected,Closed,Completed)';

/** Statuses meaning the car is physically OUT right now, not merely future-booked. */
const OUT_NOW_STATUSES = new Set(['Active', 'Started']);

export interface OccupancyRental {
  vehicle_id?: string | null;
  status?: string | null;
  /** 'YYYY-MM-DD' */
  start_date: string;
  /** 'YYYY-MM-DD', or null for an open-ended / PAYG rental. */
  end_date: string | null;
}

/**
 * Does this OPEN rental occupy the vehicle across [reqStart, reqEnd]?
 *
 * Blocks when EITHER:
 *  - the rental overlaps the window — `start_date <= reqEnd` AND
 *    (`end_date IS NULL` OR `end_date >= reqStart`); a NULL end is open-ended
 *    and holds the car from its start date onward; OR
 *  - the rental is Active/Started with an end_date already in the past.
 *
 * That second clause is the whole reason this rule exists. Availability used to
 * be pure date overlap, so when a rental's end_date went stale — a paused
 * auto-extend, an overdue rental nobody closed — NO rental overlapped a future
 * search, and a car physically still out showed as bookable. The car has not
 * come back until the rental is Closed, whatever the date column says.
 *
 * Comparisons are string comparisons, which is correct and deliberate:
 * 'YYYY-MM-DD' sorts lexicographically in calendar order, so this avoids the
 * timezone parse entirely.
 */
export function rentalOccupiesWindow(
  rental: OccupancyRental,
  reqStart: string,
  reqEnd: string,
  today: string = todayDateString(),
): boolean {
  const overlaps =
    rental.start_date <= reqEnd &&
    (rental.end_date === null || rental.end_date >= reqStart);

  const stillOut =
    !!rental.status &&
    OUT_NOW_STATUSES.has(rental.status) &&
    rental.end_date !== null &&
    rental.end_date < today;

  return overlaps || stillOut;
}

/* ═════════════════════ fleet-wide availability filter ═════════════════════ */

interface AvailabilitySnapshot {
  unavailable: Map<string, UnavailableReason>;
  /** A block with `vehicle_id IS NULL` covers the window — nothing is bookable. */
  tenantWideBlock: boolean;
}

const EMPTY_SNAPSHOT: AvailabilitySnapshot = {
  unavailable: new Map(),
  tenantWideBlock: false,
};

const MINUTES_PER_DAY = 1440;

function shiftDays(dateString: string, days: number): string {
  const date = parseDateOnly(dateString);
  date.setDate(date.getDate() + days);
  return formatDateOnly(date);
}

export interface UseVehicleAvailabilityOptions {
  /** 'YYYY-MM-DD'. Both dates are required before anything is filtered. */
  startDate?: string | null;
  endDate?: string | null;
  /** Escape hatch for callers that must defer the query. Defaults to true. */
  enabled?: boolean;
}

export interface UseVehicleAvailabilityResult {
  /** True unless something occupies this vehicle across the chosen window. */
  isAvailable: (vehicleId: string) => boolean;
  /** Why not, for a "Booked for these dates" badge. Null when available. */
  reasonFor: (vehicleId: string) => UnavailableReason | null;
  /**
   * Ids that are individually occupied. It does NOT include anything when
   * `tenantWideBlock` is set — the tenant blocked the whole fleet and we do not
   * know every id. Prefer `isAvailable` / `filterAvailable`, which fold that in.
   */
  unavailableVehicleIds: ReadonlySet<string>;
  /** Convenience for a grid that hides rather than greys out. */
  filterAvailable: <T extends { id: string }>(vehicles: readonly T[]) => T[];
  /** A tenant-wide block covers the window; nothing at all can be booked. */
  tenantWideBlock: boolean;
  /**
   * True when a complete date range was supplied, so the answers above are a
   * real judgement rather than the permissive default.
   */
  isFiltering: boolean;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * Which of the tenant's vehicles are free across a chosen date range.
 *
 * Three independent things can occupy a car, and all three are checked:
 *  1. an OPEN rental overlapping the window (see `rentalOccupiesWindow`);
 *  2. a `blocked_dates` row overlapping it — the operator marking the car out
 *     manually, e.g. listed on another platform. A row with `vehicle_id IS NULL`
 *     is tenant-wide and blocks the entire fleet;
 *  3. the tenant's turnaround buffer — pickup falling inside
 *     `buffer_time_minutes` after a completed rental handed the car back.
 *
 * WITH NO DATE RANGE THIS FILTERS NOTHING. The query does not even run. That is
 * deliberate: the fleet page lists the whole fleet before the customer has
 * chosen anything, and a hook that defaulted to "today" would quietly hide every
 * car that happens to be out this afternoon from a page whose job is to show
 * what the operator owns.
 *
 * It also fails OPEN while loading — an unresolved query reports everything
 * available rather than flashing the fleet as booked. This is a DISPLAY filter,
 * not the money boundary: the authoritative overlap check belongs at checkout,
 * where the DB can reject a double-booking it alone can see atomically.
 */
export function useVehicleAvailability(
  options: UseVehicleAvailabilityOptions = {},
): UseVehicleAvailabilityResult {
  const { tenant, isLoading: tenantLoading } = useTenant();
  const { startDate = null, endDate = null, enabled = true } = options;

  // A half-filled picker must not be treated as a one-day window.
  const hasRange = !!startDate && !!endDate;
  // Date columns are timezone-agnostic 'YYYY-MM-DD'; strip any time part rather
  // than parsing, so no timezone can shift the day.
  const reqStart = hasRange && startDate ? startDate.split('T')[0] : null;
  const reqEnd = hasRange && endDate ? endDate.split('T')[0] : null;

  const bufferMinutes = tenant?.buffer_time_minutes ?? 0;
  const isFiltering = enabled && !!tenant && !!reqStart && !!reqEnd;

  const query = useQuery({
    queryKey: ['vehicle-availability', tenant?.id, reqStart, reqEnd, bufferMinutes],
    queryFn: async (): Promise<AvailabilitySnapshot> => {
      if (!tenant?.id || !reqStart || !reqEnd) return EMPTY_SNAPSHOT;

      const unavailable = new Map<string, UnavailableReason>();

      const [openRentals, blocks] = await Promise.all([
        supabase
          .from('rentals')
          .select('vehicle_id, start_date, end_date, status')
          .eq('tenant_id', tenant.id)
          .not('status', 'in', RELEASED_RENTAL_STATUSES)
          .not('vehicle_id', 'is', null),
        supabase
          .from('blocked_dates')
          .select('vehicle_id')
          .eq('tenant_id', tenant.id)
          // Overlap: block.start <= reqEnd AND block.end >= reqStart.
          .lte('start_date', reqEnd)
          .gte('end_date', reqStart),
      ]);

      if (openRentals.error) {
        console.error('[useVehicleAvailability] Failed to load open rentals', {
          tenantId: tenant.id,
          message: openRentals.error.message,
          code: openRentals.error.code,
        });
        throw new Error(openRentals.error.message || 'Failed to check availability');
      }
      if (blocks.error) {
        console.error('[useVehicleAvailability] Failed to load blocked dates', {
          tenantId: tenant.id,
          message: blocks.error.message,
          code: blocks.error.code,
        });
        throw new Error(blocks.error.message || 'Failed to check availability');
      }

      // ── 1. open rentals ──
      const today = todayDateString();
      for (const rental of openRentals.data ?? []) {
        if (!rental.vehicle_id) continue;
        if (rentalOccupiesWindow(rental, reqStart, reqEnd, today)) {
          unavailable.set(rental.vehicle_id, 'rented');
        }
      }

      // ── 2. manual blocks ──
      let tenantWideBlock = false;
      for (const block of blocks.data ?? []) {
        if (!block.vehicle_id) {
          tenantWideBlock = true;
          continue;
        }
        // An existing 'rented' reason is the more fundamental one; keep it.
        if (!unavailable.has(block.vehicle_id)) {
          unavailable.set(block.vehicle_id, 'blocked');
        }
      }

      // ── 3. turnaround buffer ──
      if (bufferMinutes > 0) {
        const bufferMs = bufferMinutes * 60 * 1000;
        // The buffer can only bite when a rental ended shortly BEFORE pickup, so
        // bound the scan to that window instead of pulling the tenant's entire
        // completed history (v1 fetches all of it, unbounded, on every search).
        // One extra day of slack absorbs the return_time-of-day component.
        const bufferDays = Math.ceil(bufferMinutes / MINUTES_PER_DAY) + 1;
        const scanFrom = shiftDays(reqStart, -bufferDays);

        const { data: completed, error: completedError } = await supabase
          .from('rentals')
          .select('vehicle_id, end_date, return_time')
          .eq('tenant_id', tenant.id)
          .eq('status', 'Completed')
          .not('vehicle_id', 'is', null)
          .gte('end_date', scanFrom)
          .lte('end_date', reqStart);

        if (completedError) {
          console.error('[useVehicleAvailability] Failed to load buffer window', {
            tenantId: tenant.id,
            message: completedError.message,
            code: completedError.code,
          });
          throw new Error(completedError.message || 'Failed to check availability');
        }

        // Local midnight of the pickup day — the same parse the pricing engine
        // uses, so the buffer and the bill agree on which day "pickup" is.
        const pickupAt = parseDateOnly(reqStart).getTime();

        for (const rental of completed ?? []) {
          if (!rental.vehicle_id || !rental.end_date) continue;
          if (unavailable.has(rental.vehicle_id)) continue;

          const endedAt = new Date(
            `${rental.end_date}T${rental.return_time ?? '23:59'}`,
          ).getTime();
          if (Number.isNaN(endedAt)) continue;

          // Pickup lands after the car came back but before the buffer expires.
          if (pickupAt >= endedAt && pickupAt < endedAt + bufferMs) {
            unavailable.set(rental.vehicle_id, 'buffer');
          }
        }
      }

      return { unavailable, tenantWideBlock };
    },
    enabled: isFiltering,
  });

  const snapshot = query.data ?? EMPTY_SNAPSHOT;
  const { unavailable, tenantWideBlock } = snapshot;

  const isAvailable = useCallback(
    (vehicleId: string): boolean => {
      if (!isFiltering) return true;
      if (tenantWideBlock) return false;
      return !unavailable.has(vehicleId);
    },
    [isFiltering, tenantWideBlock, unavailable],
  );

  const reasonFor = useCallback(
    (vehicleId: string): UnavailableReason | null => {
      if (!isFiltering) return null;
      if (tenantWideBlock) return 'tenant_blocked';
      return unavailable.get(vehicleId) ?? null;
    },
    [isFiltering, tenantWideBlock, unavailable],
  );

  const filterAvailable = useCallback(
    <T extends { id: string }>(vehicles: readonly T[]): T[] => {
      if (!isFiltering) return [...vehicles];
      if (tenantWideBlock) return [];
      return vehicles.filter((vehicle) => !unavailable.has(vehicle.id));
    },
    [isFiltering, tenantWideBlock, unavailable],
  );

  const unavailableVehicleIds = useMemo(
    () => new Set(unavailable.keys()),
    [unavailable],
  );

  const refetch = useCallback(async () => {
    await query.refetch();
  }, [query]);

  return {
    isAvailable,
    reasonFor,
    unavailableVehicleIds,
    filterAvailable,
    tenantWideBlock,
    isFiltering,
    isLoading:
      tenantLoading || (isFiltering && query.isPending && query.fetchStatus !== 'idle'),
    isError: query.isError,
    error: query.error,
    refetch,
  };
}

/* ═══════════════════ per-vehicle occupied dates (calendar) ═══════════════ */

/** How far forward an open-ended rental is painted as occupied. */
const OPEN_ENDED_HORIZON_DAYS = 365;

export type OccupiedRangeType = 'rented' | 'blocked';

export interface OccupiedRange {
  /** 'YYYY-MM-DD' */
  startDate: string;
  /** 'YYYY-MM-DD' — already resolved; open-ended ranges are capped. */
  endDate: string;
  type: OccupiedRangeType;
  /** True when the real end is unknown (PAYG) or stale (overdue and still out). */
  isOpenEnded: boolean;
  /** Short reason, safe to show a customer ("Booked", "Unavailable"). */
  label: string;
}

export interface UseVehicleBookedDatesResult {
  ranges: OccupiedRange[];
  /** 'YYYY-MM-DD' keys — the cheapest form to test a candidate date against. */
  occupiedDateKeys: ReadonlySet<string>;
  /** Local-midnight Dates, for a date picker's `disabled` matcher. */
  occupiedDates: Date[];
  isDateOccupied: (date: Date | string) => boolean;
  /** True when EVERY day in the inclusive range is free. */
  isRangeAvailable: (startDate: string, endDate: string) => boolean;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

function eachDayKey(start: string, end: string): string[] {
  const keys: string[] = [];
  const cursor = parseDateOnly(start);
  const last = parseDateOnly(end);
  // Hard stop so a corrupt end_date cannot spin forever painting a calendar.
  let guard = 0;
  while (cursor <= last && guard < OPEN_ENDED_HORIZON_DAYS * 2) {
    keys.push(formatDateOnly(cursor));
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }
  return keys;
}

/**
 * Every date one vehicle is already spoken for — the shape a date picker needs.
 *
 * Two sources, both required: open rentals and `blocked_dates` (including
 * tenant-wide blocks, which have `vehicle_id IS NULL`).
 *
 * Open-ended rentals matter more than they look. A PAYG rental has a NULL
 * end_date, and an Active rental whose end_date has gone stale is a car still
 * physically out. Both are painted forward to a 365-day horizon rather than
 * skipped — otherwise the picker offers dates that the checkout will refuse,
 * which is a worse experience than a car that shows as busy.
 */
export function useVehicleBookedDates(
  vehicleId: string | null | undefined,
): UseVehicleBookedDatesResult {
  const { tenant, isLoading: tenantLoading } = useTenant();
  const id = typeof vehicleId === 'string' ? vehicleId.trim() : '';

  const query = useQuery({
    queryKey: ['vehicle-booked-dates', tenant?.id, id],
    queryFn: async (): Promise<OccupiedRange[]> => {
      if (!tenant?.id || !id) return [];

      const today = todayDateString();

      const [rentals, blocks] = await Promise.all([
        supabase
          .from('rentals')
          .select('id, start_date, end_date, status')
          .eq('tenant_id', tenant.id)
          .eq('vehicle_id', id)
          .in('status', [...OPEN_RENTAL_STATUSES]),
        supabase
          .from('blocked_dates')
          .select('id, start_date, end_date, reason')
          .eq('tenant_id', tenant.id)
          // Past blocks cannot affect a future booking.
          .gte('end_date', today)
          .or(`vehicle_id.eq.${id},vehicle_id.is.null`),
      ]);

      if (rentals.error) {
        console.error('[useVehicleBookedDates] Failed to load rentals', {
          vehicleId: id,
          message: rentals.error.message,
          code: rentals.error.code,
        });
        throw new Error(rentals.error.message || 'Failed to load booked dates');
      }
      if (blocks.error) {
        console.error('[useVehicleBookedDates] Failed to load blocks', {
          vehicleId: id,
          message: blocks.error.message,
          code: blocks.error.code,
        });
        throw new Error(blocks.error.message || 'Failed to load booked dates');
      }

      const horizon = shiftDays(today, OPEN_ENDED_HORIZON_DAYS);
      const ranges: OccupiedRange[] = [];

      for (const rental of rentals.data ?? []) {
        const isOut = !!rental.status && OUT_NOW_STATUSES.has(rental.status);
        // No end date at all (PAYG), or an overdue Active rental whose date has
        // gone stale — either way the car has not come back.
        const isOpenEnded =
          rental.end_date === null || (isOut && rental.end_date < today);

        ranges.push({
          startDate: rental.start_date,
          endDate: isOpenEnded ? horizon : (rental.end_date ?? horizon),
          type: 'rented',
          isOpenEnded,
          // Deliberately generic. The customer does not need — and must not be
          // shown — another customer's rental reference.
          label: 'Booked',
        });
      }

      for (const block of blocks.data ?? []) {
        ranges.push({
          startDate: block.start_date,
          endDate: block.end_date,
          type: 'blocked',
          isOpenEnded: false,
          // `reason` is an internal operator note; never surface it verbatim.
          label: 'Unavailable',
        });
      }

      return ranges;
    },
    enabled: !!tenant && id !== '',
  });

  const ranges = useMemo(() => query.data ?? [], [query.data]);

  const occupiedDateKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const range of ranges) {
      for (const key of eachDayKey(range.startDate, range.endDate)) {
        keys.add(key);
      }
    }
    return keys;
  }, [ranges]);

  const occupiedDates = useMemo(
    () => [...occupiedDateKeys].sort().map((key) => parseDateOnly(key)),
    [occupiedDateKeys],
  );

  const isDateOccupied = useCallback(
    (date: Date | string): boolean => {
      const key = date instanceof Date ? formatDateOnly(date) : date.split('T')[0];
      return occupiedDateKeys.has(key);
    },
    [occupiedDateKeys],
  );

  const isRangeAvailable = useCallback(
    (startDate: string, endDate: string): boolean => {
      if (!startDate || !endDate) return true;
      return eachDayKey(startDate.split('T')[0], endDate.split('T')[0]).every(
        (key) => !occupiedDateKeys.has(key),
      );
    },
    [occupiedDateKeys],
  );

  const refetch = useCallback(async () => {
    await query.refetch();
  }, [query]);

  return {
    ranges,
    occupiedDateKeys,
    occupiedDates,
    isDateOccupied,
    isRangeAvailable,
    isLoading:
      tenantLoading ||
      (!!tenant && id !== '' && query.isPending && query.fetchStatus !== 'idle'),
    isError: query.isError,
    error: query.error,
    refetch,
  };
}
