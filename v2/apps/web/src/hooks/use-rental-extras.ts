'use client';

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import type { PricedExtra } from '@/lib/domain';
import type {
  ExtraBillingType,
  ExtraPricingType,
  PublicRentalExtraRow,
  RentalExtra,
} from '@/lib/vehicles/types';

const EXTRA_SELECT =
  'id, name, description, price, image_urls, max_quantity, pricing_type, billing_type, sort_order';

/** Rental statuses that no longer hold anything — their extras are back in stock. */
const RELEASED_RENTAL_STATUSES = '(Cancelled,Rejected,Closed,Completed)';

function toBillingType(raw: string | null | undefined): ExtraBillingType {
  // 'per_trip' is the historical default: the column was added later, and rows
  // written before it existed must keep billing once, not once per day.
  return raw === 'per_day' ? 'per_day' : 'per_trip';
}

function toPricingType(raw: string | null | undefined): ExtraPricingType {
  return raw === 'per_vehicle' ? 'per_vehicle' : 'global';
}

/**
 * Adapter to the `@/lib/domain` extras engine.
 *
 * `calcExtrasTotal` / `extraLineTotal` read the snake_case DB shape
 * (`price`, `billing_type`). Rather than carry two spellings of the same two
 * fields on `RentalExtra`, the mapping lives here — one place, so the price the
 * sidebar shows and the price the engine totals can never come from different
 * fields.
 */
export function toPricedExtras(extras: readonly RentalExtra[]): PricedExtra[] {
  return extras.map((extra) => ({
    id: extra.id,
    price: extra.price,
    billing_type: extra.billingType,
  }));
}

export interface UseRentalExtrasOptions {
  /**
   * Resolves `per_vehicle` pricing. Without it, extras priced per vehicle are
   * EXCLUDED rather than shown at a global price they do not have.
   */
  vehicleId?: string | null;
  /**
   * With both dates, stock is counted against rentals that actually overlap the
   * requested window. Without them, `remainingStock` stays null — see below.
   */
  startDate?: string | null;
  endDate?: string | null;
}

export interface UseRentalExtrasResult {
  extras: RentalExtra[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * The add-ons the booking sidebar offers, priced for THIS vehicle and THESE
 * dates.
 *
 * Three things this resolves that the raw table does not:
 *
 * 1. PER-VEHICLE PRICING. `pricing_type = 'per_vehicle'` extras have no
 *    meaningful global price; their real one lives in
 *    `rental_extras_vehicle_pricing`. Such an extra is only offered when a price
 *    row exists for the vehicle in hand — otherwise the customer would be quoted
 *    a placeholder.
 *
 * 2. STOCK. `max_quantity` is a per-tenant inventory (three child seats, two
 *    additional drivers), so it must be counted against what is already spoken
 *    for. The count is scoped to rentals that OVERLAP the requested window and
 *    are still open — v1 sums every selection ever recorded, which permanently
 *    retires a child seat after three bookings in the tenant's whole history.
 *
 * 3. AMBIGUOUS NULLS. `remainingStock === null` means "unlimited, or not yet
 *    knowable because no dates are chosen"; those are different states and a
 *    quantity stepper cannot act on the union. `bookableQuantity` collapses them
 *    into the one number a stepper needs — clamp with that.
 */
export function useRentalExtras(
  options: UseRentalExtrasOptions = {},
): UseRentalExtrasResult {
  const { tenant, isLoading: tenantLoading } = useTenant();
  const { vehicleId = null, startDate = null, endDate = null } = options;

  // Only a complete range can be overlapped against. A half-filled date picker
  // must not narrow the window to one day and report phantom availability.
  const hasRange = !!startDate && !!endDate;
  const rangeStart = hasRange ? startDate : null;
  const rangeEnd = hasRange ? endDate : null;

  const query = useQuery({
    queryKey: ['rental-extras', tenant?.id, vehicleId, rangeStart, rangeEnd],
    queryFn: async (): Promise<RentalExtra[]> => {
      if (!tenant?.id) return [];

      const { data, error } = await supabase
        .from('rental_extras')
        .select(EXTRA_SELECT)
        .eq('tenant_id', tenant.id)
        .eq('is_active', true)
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('name', { ascending: true })
        .overrideTypes<PublicRentalExtraRow[], { merge: false }>();

      if (error) {
        console.error('[useRentalExtras] Failed to load extras', {
          tenantId: tenant.id,
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        throw new Error(error.message || 'Failed to load rental extras');
      }

      const rows = data ?? [];
      if (rows.length === 0) return [];

      // ── 1. per-vehicle price overrides ──
      const vehiclePrices = new Map<string, number>();
      if (vehicleId) {
        const { data: pricingRows, error: pricingError } = await supabase
          .from('rental_extras_vehicle_pricing')
          .select('extra_id, price')
          .eq('vehicle_id', vehicleId);

        if (pricingError) {
          console.error('[useRentalExtras] Failed to load per-vehicle pricing', {
            vehicleId,
            message: pricingError.message,
            code: pricingError.code,
          });
          throw new Error(pricingError.message || 'Failed to load extra pricing');
        }

        for (const row of pricingRows ?? []) {
          const price = Number(row.price);
          if (Number.isFinite(price)) vehiclePrices.set(row.extra_id, price);
        }
      }

      const offered = rows.filter((row) => {
        if (toPricingType(row.pricing_type) !== 'per_vehicle') return true;
        // No vehicle in hand, or no price for it: there is no honest number to
        // show, so do not offer the extra at all.
        return vehiclePrices.has(row.id);
      });

      // ── 2. stock already spoken for, within the requested window ──
      const capped = offered.filter((row) => row.max_quantity !== null);
      const booked = new Map<string, number>();

      if (capped.length > 0 && rangeStart && rangeEnd) {
        const { data: selections, error: stockError } = await supabase
          .from('rental_extras_selections')
          // `!inner` turns the embed into a filter: only selections whose rental
          // survives every `rentals.*` condition below come back.
          .select('extra_id, quantity, rentals!inner ( tenant_id, status, start_date, end_date )')
          .in(
            'extra_id',
            capped.map((row) => row.id),
          )
          .eq('rentals.tenant_id', tenant.id)
          .not('rentals.status', 'in', RELEASED_RENTAL_STATUSES)
          .lte('rentals.start_date', rangeEnd)
          // A NULL end_date is an open-ended / PAYG rental: it holds its extras
          // from start_date onward, so it must not be treated as already over.
          .or(`end_date.is.null,end_date.gte.${rangeStart}`, {
            referencedTable: 'rentals',
          })
          .overrideTypes<{ extra_id: string; quantity: number }[], { merge: false }>();

        if (stockError) {
          console.error('[useRentalExtras] Failed to load extra stock', {
            tenantId: tenant.id,
            message: stockError.message,
            code: stockError.code,
          });
          throw new Error(stockError.message || 'Failed to load extra availability');
        }

        for (const selection of selections ?? []) {
          const qty = Number(selection.quantity) || 0;
          booked.set(selection.extra_id, (booked.get(selection.extra_id) ?? 0) + qty);
        }
      }

      // ── 3. normalise ──
      return offered.map((row) => {
        const override = vehiclePrices.get(row.id);
        const hasVehicleSpecificPrice = override !== undefined;
        const price = hasVehicleSpecificPrice ? override : Number(row.price) || 0;

        const maxQuantity = row.max_quantity;
        const remainingStock =
          maxQuantity !== null && rangeStart && rangeEnd
            ? Math.max(0, maxQuantity - (booked.get(row.id) ?? 0))
            : null;

        return {
          id: row.id,
          name: row.name,
          description: row.description,
          price,
          billingType: toBillingType(row.billing_type),
          pricingType: toPricingType(row.pricing_type),
          hasVehicleSpecificPrice,
          imageUrls: row.image_urls ?? [],
          maxQuantity,
          remainingStock,
          bookableQuantity: remainingStock ?? maxQuantity,
        } satisfies RentalExtra;
      });
    },
    enabled: !!tenant,
  });

  const extras = useMemo(() => query.data ?? [], [query.data]);

  const refetch = useCallback(async () => {
    await query.refetch();
  }, [query]);

  return {
    extras,
    isLoading:
      tenantLoading || (!!tenant && query.isPending && query.fetchStatus !== 'idle'),
    isError: query.isError,
    error: query.error,
    refetch,
  };
}
