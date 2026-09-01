'use client';

/**
 * The signed-in customer's rentals.
 *
 * ── THE ISOLATION BOUNDARY IS THIS FILE ─────────────────────────────────────
 * `rentals` has RLS OFF on staging and a table-level SELECT grant to `anon`.
 * Verified live against ksmreaadhbirzakkxqrq: an unauthenticated request
 * carrying only the public anon key returns other customers' rentals in full.
 * So the `.eq('customer_id', …).eq('tenant_id', …)` pair below is not an
 * optimisation and not a convenience — it is the ONLY thing standing between
 * one customer and another's booking history. Two consequences:
 *
 *   1. BOTH filters, always, on every query in this file and in
 *      `use-customer-rental.ts`. `customer_id` alone would be sufficient today
 *      (ids are UUIDs and unique across tenants) but it degrades silently the
 *      day a customer row is copied between tenants, which the seeding scripts
 *      already do. `tenant_id` alone is worse still: it is the whole tenant.
 *   2. The customer id comes from the auth store, never from a URL, a prop or
 *      a query string. There is deliberately no `customerId` parameter on any
 *      hook here — an id that can be passed in is an id that can be swapped.
 *
 * When RLS is switched on for `rentals` these filters keep working unchanged;
 * they become redundant rather than wrong. Do not remove them at that point —
 * defence in depth is the point, and the grant history above shows why.
 *
 * ── ONE QUERY, NOT THREE ────────────────────────────────────────────────────
 * v1 runs a separate `useCustomerRentalStats` that re-reads the same table to
 * count rows. A customer has tens of rentals, not thousands, so this hook loads
 * the set once and every count on the overview page is derived from it in
 * `summariseRentals`. That also removes a real v1 failure mode: the list and
 * the stat cards were two independently-cached queries and could disagree on
 * screen after a booking landed.
 */

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { useCustomer } from '@/hooks/use-customer';
import { useTenant, type Tenant } from '@/contexts/TenantContext';
import {
  VEHICLE_PHOTO_COLUMNS,
  customerPhotoUrl,
  displayRegistration,
  parseDateOnly,
  todayDateString,
  vehicleDisplayLabel,
  vehicleDisplayName,
} from '@/lib/domain';
import type { Database } from '@/integrations/supabase/types';

/* ────────────────────────────── row shapes ─────────────────────────────── */

type RentalRow = Database['public']['Tables']['rentals']['Row'];
type VehicleRow = Database['public']['Tables']['vehicles']['Row'];
type VehiclePhotoRow = Database['public']['Tables']['vehicle_photos']['Row'];

/**
 * The rental columns a customer may read.
 *
 * A `Pick` rather than a hand-written interface so a column that does not exist
 * fails to compile here instead of 400-ing at runtime — PostgREST rejects the
 * ENTIRE row for one unknown name, so a single typo does not blank one field,
 * it empties the whole bookings page.
 *
 * Deliberately absent: every `deposit_hold_*`, `auto_extend_*` and `payg_*`
 * column, `creation_context` (it carries the operator's Stripe/BoldSign
 * readiness reasons — internal diagnostics, not customer copy),
 * `health_severity`, and `platform_account`. None of them has a customer-facing
 * meaning and several would leak how the operator's account is configured.
 */
export type CustomerRentalRow = Pick<
  RentalRow,
  | 'id'
  | 'rental_number'
  | 'customer_id'
  | 'tenant_id'
  | 'vehicle_id'
  | 'start_date'
  | 'end_date'
  | 'pickup_time'
  | 'return_time'
  | 'status'
  | 'payment_status'
  | 'approval_status'
  | 'document_status'
  | 'rental_period_type'
  | 'monthly_amount'
  | 'created_at'
  | 'pickup_location'
  | 'return_location'
  | 'delivery_method'
  | 'delivery_address'
  | 'delivery_fee'
  | 'collection_address'
  | 'collection_fee'
  | 'is_extended'
  | 'previous_end_date'
  | 'cancellation_requested'
  | 'cancellation_reason'
  | 'is_unlimited_mileage'
  | 'unlimited_mileage_tier'
  | 'unlimited_mileage_total'
  | 'discount_applied'
  | 'promo_code'
  | 'insurance_status'
  | 'insurance_premium'
  // The mileage the customer actually bought. An operator can override the
  // vehicle's stock allowance per booking, so reading the allowance off
  // `vehicles` alone would show a different number to the one on the signed
  // agreement. Nullable: null means "no override, use the vehicle's".
  | 'daily_mileage_override'
  | 'weekly_mileage_override'
  | 'monthly_mileage_override'
  | 'excess_mileage_rate_override'
>;

/**
 * The vehicle columns embedded in a rental.
 *
 * A tight subset of the public allowlist rather than `vehiclePublicColumns()`:
 * a booking card needs a name, a picture and the mileage allowance it was sold
 * with. Rates and availability flags belong to the fleet page, where they are
 * live; repeating them next to a booking made months ago would show today's
 * price against yesterday's contract.
 *
 * `reg` is NOT here, and cannot be: `displayRegistration` withholds it for a
 * tenant with `hide_vehicle_registration`, and the honest way to withhold a
 * field is to never fetch it. See `vehicle-identity.ts`.
 */
type EmbeddedVehicle = Pick<
  VehicleRow,
  | 'id'
  | 'make'
  | 'model'
  | 'year'
  | 'colour'
  | 'color'
  | 'category'
  | 'fuel_type'
  | 'photo_url'
  | 'daily_mileage'
  | 'weekly_mileage'
  | 'monthly_mileage'
  | 'excess_mileage_rate'
> & {
  vehicle_photos: Pick<
    VehiclePhotoRow,
    'photo_url' | 'redacted_url' | 'redaction_status' | 'display_order'
  >[];
};

export type CustomerRentalQueryRow = CustomerRentalRow & {
  vehicles: EmbeddedVehicle | null;
};

const VEHICLE_EMBED_COLUMNS = [
  'id',
  'make',
  'model',
  'year',
  'colour',
  'color',
  'category',
  'fuel_type',
  'photo_url',
  'daily_mileage',
  'weekly_mileage',
  'monthly_mileage',
  'excess_mileage_rate',
].join(', ');

/**
 * The vehicle sub-select, shared with `use-customer-rental.ts`.
 *
 * NOTE THE MISSING SPACE before the final `)`, and do not "tidy" it back in.
 * PostgREST's select grammar rejects whitespace between a nested embed's
 * closing paren and its parent's: `vehicle_photos ( … ) )` fails with PGRST100
 * "unexpected \")\" expecting \",\"" while `vehicle_photos ( … ))` parses.
 * Verified live against staging. `VEHICLE_PHOTO_COLUMNS` already ends in ` )`,
 * so the parent embed has to close immediately after it.
 *
 * This does not bite `use-vehicles.ts`, where the same constant is the last
 * thing in a TOP-LEVEL select and is followed by end-of-string rather than by
 * another `)`. It bites the moment the embed is nested one level deeper.
 */
export const RENTAL_VEHICLE_EMBED = `vehicles ( ${VEHICLE_EMBED_COLUMNS}, ${VEHICLE_PHOTO_COLUMNS})`;

/** The rental columns, shared with `use-customer-rental.ts`. */
export const RENTAL_COLUMNS = [
  'id',
  'rental_number',
  'customer_id',
  'tenant_id',
  'vehicle_id',
  'start_date',
  'end_date',
  'pickup_time',
  'return_time',
  'status',
  'payment_status',
  'approval_status',
  'document_status',
  'rental_period_type',
  'monthly_amount',
  'created_at',
  'pickup_location',
  'return_location',
  'delivery_method',
  'delivery_address',
  'delivery_fee',
  'collection_address',
  'collection_fee',
  'is_extended',
  'previous_end_date',
  'cancellation_requested',
  'cancellation_reason',
  'is_unlimited_mileage',
  'unlimited_mileage_tier',
  'unlimited_mileage_total',
  'discount_applied',
  'promo_code',
  'insurance_status',
  'insurance_premium',
  'daily_mileage_override',
  'weekly_mileage_override',
  'monthly_mileage_override',
  'excess_mileage_rate_override',
].join(', ');

const RENTAL_LIST_SELECT = `${RENTAL_COLUMNS}, ${RENTAL_VEHICLE_EMBED}`;

/* ───────────────────────────── view model ──────────────────────────────── */

/**
 * How a rental reads on screen.
 *
 * `Booked` / `Upcoming` / `On rent` / `Completed` / `Cancelled` — five buckets,
 * derived from `status` + the dates rather than shown raw. The DB carries at
 * least nine spellings across two eras ('Active', 'Pending', 'Reserved',
 * 'Confirmed', 'Completed', 'Ended', 'Cancelled', 'Rejected', 'Closed') and a
 * customer should not have to learn the operator's vocabulary.
 */
export type RentalLifecycle =
  | 'pending'
  | 'upcoming'
  | 'on_rent'
  | 'completed'
  | 'cancelled';

/** Where the money got to. Mirrors what the Stripe webhook writes. */
export type RentalPaymentState = 'paid' | 'refunded' | 'unpaid' | 'unknown';

export interface CustomerRentalVehicle {
  id: string;
  /** "Toyota Corolla", never the bare plate for a plate-hiding tenant. */
  displayName: string;
  /** "Toyota Corolla (AB12 XYZ)" where the plate may be shown. */
  displayLabel: string;
  /** null when the tenant hides plates, or when the tenant has not loaded. */
  registration: string | null;
  year: number | null;
  colour: string | null;
  category: string | null;
  fuelType: string | null;
  /** Redaction already applied; null when the vehicle has no usable photo. */
  imageUrl: string | null;
  dailyMileage: number | null;
  weeklyMileage: number | null;
  monthlyMileage: number | null;
  excessMileageRate: number | null;
}

export interface CustomerRental {
  id: string;
  /** `rental_number` where the trigger wrote one, else a short id. */
  reference: string;
  /** DATE-only 'YYYY-MM-DD'. Never feed this to `new Date()` — see date-utils. */
  startDate: string;
  endDate: string | null;
  pickupTime: string | null;
  returnTime: string | null;
  /** Whole calendar days, minimum 1. Null when there is no end date. */
  nights: number | null;

  /** Raw DB value, kept for debugging and for copy that must quote it exactly. */
  statusRaw: string | null;
  lifecycle: RentalLifecycle;
  paymentStatusRaw: string | null;
  paymentState: RentalPaymentState;
  approvalStatus: string | null;
  documentStatus: string | null;

  periodType: string | null;
  /** `monthly_amount` — the column name lies; it is the grand total. */
  total: number;
  discount: number | null;
  promoCode: string | null;

  pickupLocation: string | null;
  returnLocation: string | null;
  deliveryMethod: string | null;
  deliveryAddress: string | null;
  deliveryFee: number | null;
  collectionAddress: string | null;
  collectionFee: number | null;

  isExtended: boolean;
  previousEndDate: string | null;
  cancellationRequested: boolean;
  cancellationReason: string | null;

  isUnlimitedMileage: boolean;
  unlimitedMileageTier: string | null;
  unlimitedMileageTotal: number | null;

  insuranceStatus: string | null;
  insurancePremium: number | null;

  /**
   * The allowance THIS booking was sold, per tier — the operator's per-rental
   * override where one exists, otherwise the vehicle's standing figure. Null in
   * a slot means that tier is unlimited (see `mileage-utils`).
   */
  mileage: {
    daily: number | null;
    weekly: number | null;
    monthly: number | null;
    excessRate: number | null;
  };

  createdAt: string | null;
  vehicle: CustomerRentalVehicle | null;
}

/* ──────────────────────────── normalisation ────────────────────────────── */

const CANCELLED_STATUSES = new Set(['cancelled', 'canceled', 'rejected', 'closed']);
const COMPLETED_STATUSES = new Set(['completed', 'ended', 'returned']);
const LIVE_STATUSES = new Set(['active', 'confirmed', 'reserved', 'on rent']);

/**
 * Which of the five buckets a rental sits in.
 *
 * Status wins over the calendar in both directions that matter: a Cancelled
 * rental whose dates are still in the future is cancelled, not upcoming, and an
 * Active rental that ran past its end date without the operator closing it is
 * still on rent — the customer has the car. Only when the status is one of the
 * open ones ('Active', 'Pending', …) do the dates decide.
 */
export function rentalLifecycle(
  status: string | null,
  startDate: string,
  endDate: string | null,
  today: string = todayDateString(),
): RentalLifecycle {
  const key = (status ?? '').trim().toLowerCase();

  if (CANCELLED_STATUSES.has(key)) return 'cancelled';
  if (COMPLETED_STATUSES.has(key)) return 'completed';

  // Ended by the calendar even though nobody closed it out.
  if (endDate !== null && endDate < today) return 'completed';

  if (LIVE_STATUSES.has(key)) {
    return startDate > today ? 'upcoming' : 'on_rent';
  }

  // 'Pending' and anything unrecognised: the operator has not confirmed it yet,
  // so it is not "upcoming" in a way the customer can rely on.
  return startDate > today ? 'pending' : 'on_rent';
}

/**
 * What happened to the money.
 *
 * 'fulfilled' is the value the Stripe webhooks write on settlement; 'paid' is
 * the older spelling still present on migrated rows. Both mean paid. Anything
 * else is treated as UNPAID rather than unknown, because the failure that
 * matters is telling a customer a booking is settled when it is not.
 */
export function rentalPaymentState(status: string | null): RentalPaymentState {
  const key = (status ?? '').trim().toLowerCase();
  if (key === '') return 'unknown';
  if (key === 'fulfilled' || key === 'paid') return 'paid';
  if (key === 'refunded') return 'refunded';
  return 'unpaid';
}

const MS_PER_DAY = 86_400_000;

function nightsBetween(startDate: string, endDate: string | null): number | null {
  if (!endDate) return null;
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.max(1, Math.round((endDay - startDay) / MS_PER_DAY));
}

/** The first usable photo, redaction rules already applied. */
function vehicleImage(
  vehicle: EmbeddedVehicle,
  tenant: Tenant | null,
): string | null {
  const ordered = [...(vehicle.vehicle_photos ?? [])].sort((a, b) => {
    const ao = a.display_order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.display_order ?? Number.MAX_SAFE_INTEGER;
    return ao - bo;
  });

  for (const photo of ordered) {
    const url = customerPhotoUrl(photo, tenant);
    if (url) return url;
  }

  // The operator's chosen thumbnail, for vehicles with no `vehicle_photos` rows.
  const fallback = vehicle.photo_url;
  return typeof fallback === 'string' && fallback.trim() !== '' ? fallback : null;
}

export function normalizeCustomerRental(
  row: CustomerRentalQueryRow,
  tenant: Tenant | null,
  today: string = todayDateString(),
): CustomerRental {
  const vehicleRow = row.vehicles;

  const vehicle: CustomerRentalVehicle | null = vehicleRow
    ? {
        id: vehicleRow.id,
        displayName: vehicleDisplayName(vehicleRow, tenant),
        displayLabel: vehicleDisplayLabel(vehicleRow, tenant),
        registration: displayRegistration(vehicleRow, tenant),
        year: vehicleRow.year,
        colour: vehicleRow.colour ?? vehicleRow.color,
        category: vehicleRow.category,
        fuelType: vehicleRow.fuel_type,
        imageUrl: vehicleImage(vehicleRow, tenant),
        dailyMileage: vehicleRow.daily_mileage,
        weeklyMileage: vehicleRow.weekly_mileage,
        monthlyMileage: vehicleRow.monthly_mileage,
        excessMileageRate: vehicleRow.excess_mileage_rate,
      }
    : null;

  return {
    id: row.id,
    // `rental_number` is written by a DB trigger and is nullable in the type,
    // so there has to be a fallback the customer can quote down a phone line.
    reference: row.rental_number ?? `#${row.id.slice(0, 8)}`,
    startDate: row.start_date,
    endDate: row.end_date,
    pickupTime: row.pickup_time,
    returnTime: row.return_time,
    nights: nightsBetween(row.start_date, row.end_date),

    statusRaw: row.status,
    lifecycle: rentalLifecycle(row.status, row.start_date, row.end_date, today),
    paymentStatusRaw: row.payment_status,
    paymentState: rentalPaymentState(row.payment_status),
    approvalStatus: row.approval_status,
    documentStatus: row.document_status,

    periodType: row.rental_period_type,
    total: row.monthly_amount,
    discount: row.discount_applied,
    promoCode: row.promo_code,

    pickupLocation: row.pickup_location,
    returnLocation: row.return_location,
    deliveryMethod: row.delivery_method,
    deliveryAddress: row.delivery_address,
    deliveryFee: row.delivery_fee,
    collectionAddress: row.collection_address,
    collectionFee: row.collection_fee,

    isExtended: row.is_extended === true,
    previousEndDate: row.previous_end_date,
    cancellationRequested: row.cancellation_requested === true,
    cancellationReason: row.cancellation_reason,

    isUnlimitedMileage: row.is_unlimited_mileage === true,
    unlimitedMileageTier: row.unlimited_mileage_tier,
    unlimitedMileageTotal: row.unlimited_mileage_total,

    insuranceStatus: row.insurance_status,
    insurancePremium: row.insurance_premium,

    // `??`, never `||`: a deliberate 0-mile override is falsy and `||` would
    // silently fall through to the vehicle's allowance.
    mileage: {
      daily: row.daily_mileage_override ?? vehicleRow?.daily_mileage ?? null,
      weekly: row.weekly_mileage_override ?? vehicleRow?.weekly_mileage ?? null,
      monthly: row.monthly_mileage_override ?? vehicleRow?.monthly_mileage ?? null,
      excessRate:
        row.excess_mileage_rate_override ?? vehicleRow?.excess_mileage_rate ?? null,
    },

    createdAt: row.created_at,
    vehicle,
  };
}

/* ─────────────────────────────── the hook ──────────────────────────────── */

export type RentalFilter = 'all' | 'current' | 'past';

export interface CustomerRentalSummary {
  total: number;
  /** Live right now — the customer has the car. */
  onRent: number;
  /** Confirmed or awaiting confirmation, starting later. */
  upcoming: number;
  past: number;
  cancelled: number;
  /** Soonest future rental, or null. Cancelled rentals never qualify. */
  next: CustomerRental | null;
  /** The rental in progress, if any — the soonest-ending one when several. */
  current: CustomerRental | null;
  /** Rentals whose payment has not settled. Drives the "action needed" nudge. */
  awaitingPayment: CustomerRental[];
}

const EMPTY_SUMMARY: CustomerRentalSummary = {
  total: 0,
  onRent: 0,
  upcoming: 0,
  past: 0,
  cancelled: 0,
  next: null,
  current: null,
  awaitingPayment: [],
};

/**
 * Every count the overview page shows, derived from the loaded list.
 *
 * Exported so a page can summarise a filtered subset without a second query.
 */
export function summariseRentals(
  rentals: readonly CustomerRental[],
): CustomerRentalSummary {
  if (rentals.length === 0) return EMPTY_SUMMARY;

  let onRent = 0;
  let upcoming = 0;
  let past = 0;
  let cancelled = 0;
  let next: CustomerRental | null = null;
  let current: CustomerRental | null = null;
  const awaitingPayment: CustomerRental[] = [];

  for (const rental of rentals) {
    switch (rental.lifecycle) {
      case 'on_rent':
        onRent += 1;
        // Soonest to end: that is the one the customer needs to act on first.
        if (
          current === null ||
          (rental.endDate ?? '9999-12-31') < (current.endDate ?? '9999-12-31')
        ) {
          current = rental;
        }
        break;
      case 'upcoming':
      case 'pending':
        upcoming += 1;
        if (next === null || rental.startDate < next.startDate) next = rental;
        break;
      case 'completed':
        past += 1;
        break;
      case 'cancelled':
        cancelled += 1;
        break;
    }

    // A cancelled booking owes nothing, and a finished one is the operator's
    // problem to chase, not a banner on the customer's dashboard.
    if (
      rental.paymentState === 'unpaid' &&
      rental.lifecycle !== 'cancelled' &&
      rental.lifecycle !== 'completed'
    ) {
      awaitingPayment.push(rental);
    }
  }

  return {
    total: rentals.length,
    onRent,
    upcoming,
    past,
    cancelled,
    next,
    current,
    awaitingPayment,
  };
}

export interface UseCustomerRentalsResult {
  rentals: CustomerRental[];
  summary: CustomerRentalSummary;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * The customer's rentals, newest first.
 *
 * Filtering is done in memory, not in the query, and the query key does NOT
 * include the filter. One fetch backs every tab, so switching between "Current"
 * and "Past" is instant and the counts on the tabs are always consistent with
 * the rows beneath them. v1 issues a fresh round-trip per tab and builds three
 * separate `.or()` predicates that do not agree with its own stats hook.
 */
export function useCustomerRentals(
  filter: RentalFilter = 'all',
): UseCustomerRentalsResult {
  const { tenant, isLoading: tenantLoading } = useTenant();
  // `customerId` is `customer_users.customer_id` — the FK these tables carry.
  // Taken from the auth read model rather than re-derived, so there is one
  // answer to "who is signed in" and the queries cannot key off a second one.
  const { customerId, isLoading: authLoading } = useCustomer();

  const tenantId = tenant?.id ?? null;

  const query = useQuery({
    // Both ids are in the key. The customer id in particular: without it, one
    // customer signing out and another signing in on the same browser would be
    // served the first one's cached bookings until the stale time elapsed.
    queryKey: ['customer-rentals', tenantId, customerId],
    queryFn: async (): Promise<CustomerRental[]> => {
      if (!customerId || !tenantId) return [];

      const { data, error } = await supabase
        .from('rentals')
        .select(RENTAL_LIST_SELECT)
        // Read the file header before touching either of these.
        .eq('customer_id', customerId)
        .eq('tenant_id', tenantId)
        // NOTE: no `.order('display_order', { referencedTable: 'vehicle_photos' })`
        // here. `vehicle_photos` is embedded under `vehicles`, i.e. two levels
        // down, and PostgREST only accepts an order that references a TOP-LEVEL
        // embed — nesting it returns 400 PGRST108 "'vehicle_photos' is not an
        // embedded resource in this request" and the whole query fails.
        // Photo order is applied client-side in `vehicleImage()`, which already
        // sorts by `display_order`, so nothing is lost by leaving it out.
        // `created_at` rather than `start_date`: "newest first" means the most
        // recently BOOKED, which is what a customer returning from checkout
        // expects to see at the top. Nulls last so a migrated row with no
        // timestamp cannot squat the first slot.
        .order('created_at', { ascending: false, nullsFirst: false })
        .overrideTypes<CustomerRentalQueryRow[], { merge: false }>();

      if (error) {
        console.error('[useCustomerRentals] Failed to load rentals', {
          tenantId,
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        throw new Error(error.message || 'Failed to load your bookings');
      }

      // One `today` for the whole batch, so two rentals cannot be bucketed
      // against different days if the render straddles midnight.
      const today = todayDateString();
      return (data ?? []).map((row) => normalizeCustomerRental(row, tenant, today));
    },
    enabled: !!customerId && !!tenantId,
  });

  const allRentals = useMemo(() => query.data ?? [], [query.data]);

  const rentals = useMemo(() => {
    if (filter === 'all') return allRentals;
    if (filter === 'current') {
      return allRentals.filter(
        (rental) =>
          rental.lifecycle === 'on_rent' ||
          rental.lifecycle === 'upcoming' ||
          rental.lifecycle === 'pending',
      );
    }
    return allRentals.filter(
      (rental) => rental.lifecycle === 'completed' || rental.lifecycle === 'cancelled',
    );
  }, [allRentals, filter]);

  // Always over the FULL set: the overview's "2 upcoming" must not change
  // because the bookings page happens to be showing the Past tab.
  const summary = useMemo(() => summariseRentals(allRentals), [allRentals]);

  const refetch = useCallback(async () => {
    await query.refetch();
  }, [query]);

  return {
    rentals,
    summary,
    // The tenant and auth round-trips are part of this hook's load from the
    // caller's point of view: until both land `enabled` is false and React
    // Query reports idle, so reading `isPending` alone flashes "no bookings"
    // at a customer who has plenty.
    isLoading:
      tenantLoading ||
      authLoading ||
      (!!customerId && !!tenantId && query.isPending && query.fetchStatus !== 'idle'),
    isError: query.isError,
    error: query.error,
    refetch,
  };
}
