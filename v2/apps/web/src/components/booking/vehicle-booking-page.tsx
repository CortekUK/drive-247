"use client";

import {
  ArrowLeft,
  ArrowRight,
  CarFront,
  CheckCircle2,
  Clock,
  RotateCw,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTenant } from "@/contexts/TenantContext";
import { useBookingQuote } from "@/hooks/use-booking-quote";
import { usePickupLocations } from "@/hooks/use-pickup-locations";
import { useRentalExtras } from "@/hooks/use-rental-extras";
import { useVehicle } from "@/hooks/use-vehicle";
import { useVehicleBookedDates } from "@/hooks/use-vehicle-availability";
import { useTenantBranding } from "@/hooks/use-tenant-branding";
import { useCreateBooking } from "@/hooks/use-create-booking";
import {
  readTripIntentFromLocation,
  sameTripAddress,
} from "@/lib/booking/trip-intent";
import type { BookingLocationLeg } from "@/lib/booking/types";
import {
  getTierFeeRange,
  hasActiveTiers,
  type DeliveryTierConfig,
} from "@/lib/domain";
import type {
  QuoteDeliverySelection,
  QuoteExtra,
  QuoteVehicle,
} from "@/lib/quote/types";
import {
  useBookingStore,
  useHydrateBookingStore,
  type DeliveryOption,
} from "@/lib/stores/booking-store";
import { cn } from "@/lib/utils";
import type { PickupLocation, UnavailableReason } from "@/lib/vehicles/types";

import {
  CheckoutTotal,
  describeOutstanding,
  MobileCheckoutBar,
  PriceBlock,
  type CheckoutBlock,
  type CheckoutState,
} from "./booking-checkout";
import { BookingForm } from "./booking-form";
import { deriveBookingRules, resolveDeliveryModes } from "./booking-rules";
import {
  bookingDocumentsHref,
  PaymentPanel,
  readPaymentReturn,
  type BookingPaymentRequest,
  type PaymentOutcome,
  type PaymentReturn,
} from "./payment-panel";
import {
  addDaysIso,
  isIsoDate,
  resolveBrowserTimezone,
  todayIso,
  zonedWallClockToInstant,
} from "./time-utils";
import { usePromoCode } from "./use-promo-code";
import { validateBooking, type BookingField } from "./validation";
import { VehicleCard } from "./vehicle-card";

/* ────────────────── surviving a reload after the money moved ─────────────── */

/**
 * What we keep about a payment that has already happened.
 *
 * ── WHY THIS EXISTS AT ALL ──────────────────────────────────────────────────
 * Paying no longer finishes a booking: the customer still has to send a copy of
 * their insurance document, and an operator still has to approve. The route
 * to that step is a one-off token, and until this stash existed it lived in
 * ordinary `useState` — so a reload, an accidental back-navigation, or a phone
 * that killed the tab left the customer looking at a LIVE BOOKING FORM for a car
 * they had already paid for, with no evidence of the charge and no way back to
 * the upload screen. The email carries the same link, but "check your email" is
 * not an answer to "did my card just get charged twice?".
 *
 * sessionStorage, not local, and it mirrors the payment-return stash idiom in
 * `payment-panel.tsx` (:96-122) on purpose: this is tab-scoped evidence of
 * something that happened in THIS tab, not a durable record. The durable record
 * is the rental row, and the customer portal is where it is read from.
 *
 * `vehicleId` is stored and CHECKED on the way back out. Without it, a customer
 * who paid for car A and then browsed to car B would find car B's page insisting
 * it had been paid for and its button dead — a much worse bug than the one this
 * fixes.
 */
interface PaidBookingHandoff {
  /** `vehicles.id` this handoff belongs to. A different car ignores it. */
  vehicleId: string;
  /** `rentals.id` — what the token unlocks. Null only if we never learned it. */
  rentalId: string | null;
  /** `rentals.rental_number`, for the reference line. */
  rentalNumber: string | null;
  /** The upload token. Null = no link to offer; the email is the only route. */
  documentsToken: string | null;
  /** Whether the bank settled, or is still settling. Never "confirmed". */
  kind: PaymentOutcome["kind"];
}

const PAID_HANDOFF_KEY = "drive247.booking.documents-token";

function stashPaidHandoff(handoff: PaidBookingHandoff): void {
  try {
    window.sessionStorage.setItem(PAID_HANDOFF_KEY, JSON.stringify(handoff));
  } catch {
    // Private mode, or storage full. The in-session path still works — only the
    // survive-a-reload part degrades, and it degrades to the emailed link.
  }
}

/**
 * Read it back, for THIS vehicle only.
 *
 * Everything is re-validated rather than trusted: this is attacker-writable
 * browser storage, and the worst outcome of believing a forged one would be a
 * customer told they had paid when they had not. Nothing here grants anything —
 * the token is checked server-side by the documents route — so validation is
 * about honesty on screen, not authorisation.
 */
function readPaidHandoff(vehicleId: string): PaidBookingHandoff | null {
  if (typeof window === "undefined") return null;

  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(PAID_HANDOFF_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;

  const body: Record<string, unknown> = { ...parsed };
  if (body.vehicleId !== vehicleId) return null;
  if (body.kind !== "succeeded" && body.kind !== "processing") return null;

  return {
    vehicleId,
    rentalId: typeof body.rentalId === "string" ? body.rentalId : null,
    rentalNumber: typeof body.rentalNumber === "string" ? body.rentalNumber : null,
    documentsToken:
      typeof body.documentsToken === "string" ? body.documentsToken : null,
    kind: body.kind,
  };
}

/**
 * /booking/[vehicleId] — one vehicle, one page.
 *
 * This component owns the data and the decisions; the card, the form and the
 * checkout pieces are presentational. There is no wizard: everything the
 * customer must tell us before paying is on screen at once, and the bill
 * re-prices on every change because `useBookingQuote` recomputes from the same
 * inputs the form renders.
 *
 * LAYOUT — the vehicle is the left rail and the form is the right column, and
 * the rail is DOM-first so a phone stacks car-then-form with no `order-*`
 * rewriting of the reading order. See the grid below for why the rail scrolls
 * internally rather than growing past the fold.
 *
 * PAYMENT happens in this page too. "Continue to payment" opens `PaymentPanel`
 * — Stripe Elements mounted in a dialog over this form — rather than handing the
 * customer to Stripe's hosted checkout. The button is greyed out until the whole
 * form validates, and says which fields are outstanding while it is.
 */
export function VehicleBookingPage({ vehicleId }: { vehicleId: string }) {
  const hydrated = useHydrateBookingStore();
  const { tenant, isLoading: tenantLoading, error: tenantError } = useTenant();
  const { formatCurrency } = useTenantBranding();

  const form = useBookingStore();
  const { vehicle, isLoading: vehicleLoading, notFound, isError, refetch } =
    useVehicle(vehicleId);

  const { pickupLocations, returnLocations, byId: locationsById } =
    usePickupLocations();

  const rules = useMemo(() => deriveBookingRules(tenant), [tenant]);
  const modes = useMemo(
    () => resolveDeliveryModes(tenant, pickupLocations),
    [tenant, pickupLocations],
  );

  /* ── one-time seeding ──────────────────────────────────────────────────
   * Runs once the persisted booking is back AND the tenant's rules are known,
   * and only fills fields the customer has not already filled. Defaults are
   * computed here rather than in the store's INITIAL because every one of them
   * depends on today's date or on tenant settings — a constant would be wrong
   * by the next morning and would differ between the server and the browser.
   */
  const seeded = useRef(false);
  useEffect(() => {
    if (!hydrated || !tenant) return;

    // Always re-point at the vehicle in the URL; a different car drops the
    // extras and consents that belonged to the previous one.
    form.startVehicle(vehicleId);

    if (seeded.current) return;
    seeded.current = true;

    const state = useBookingStore.getState();
    const patch: Parameters<typeof form.patch>[0] = {};

    if (state.customerTimezone === "") {
      patch.customerTimezone = resolveBrowserTimezone();
    }

    /* ── the addresses the customer typed on the home page ─────────────────
     * `?pickup=` / `?dropoff=`, carried here from the hero by /fleet's vehicle
     * links. Read from `window.location` for the same reason `readPaymentReturn`
     * is a few hundred lines below: `useSearchParams` would put this whole page
     * behind a Suspense boundary.
     *
     * PRECEDENCE IS STORE > URL > TENANT DEFAULT, and the order matters more
     * than it looks. This store is PERSISTED: a customer who filled half a
     * booking yesterday, then clicked a stale link (their own, from a bookmark,
     * or one somebody sent them), must not have the address they typed replaced
     * by one they no longer mean. So every branch below is guarded on the field
     * being genuinely untouched, and the URL only ever fills a hole.
     */
    const intent = readTripIntentFromLocation();

    /* Which arrangement the sidebar opens on.
     *
     * A typed address only implies "deliver it to me", and that is the `area`
     * mode — which many operators do not offer. Selecting a mode the tenant has
     * switched off would put the customer in a state `resolveDeliveryModes`
     * says does not exist and the form has no controls for, so the intent is
     * allowed to influence this choice ONLY when `area` is genuinely enabled.
     * Otherwise the tenant's own first enabled mode stands, exactly as before.
     */
    const seededMode: DeliveryOption =
      state.deliveryOption ??
      (intent.pickup !== null && modes.area ? "area" : (modes.enabled[0] ?? "fixed"));

    if (state.deliveryOption === null) patch.deliveryOption = seededMode;

    /* Only two of the three arrangements have a free-text address to fill.
     * `location` is a picker over the operator's own rows and a typed string
     * cannot pick one; `fixed` WITH a configured address renders that address
     * as a read-only panel and `bookingLegs` prefers it over anything in the
     * store, so seeding there would write a value nothing shows and nothing
     * uses. This mirrors `canChooseReturn` in booking-form.tsx.
     */
    const acceptsTypedAddress =
      seededMode === "area" ||
      (seededMode === "fixed" && rules.fixedPickupAddress === null);

    if (acceptsTypedAddress && intent.pickup !== null && state.pickupAddress === "") {
      patch.pickupAddress = intent.pickup;

      /* The return leg rides with the pickup leg or not at all.
       *
       * Filling it means flipping `sameAsPickup` to false, and that flag
       * DEFAULTS to true — so a stored `true` is indistinguishable from one the
       * customer chose. Flipping it is only safe in the pass where we are also
       * the ones filling the pickup address, i.e. where there is demonstrably
       * no customer input to contradict. A customer who already has a pickup
       * address keeps their whole "where" section untouched.
       */
      if (
        intent.dropoff !== null &&
        state.returnAddress === "" &&
        !sameTripAddress(intent.pickup, intent.dropoff)
      ) {
        patch.returnAddress = intent.dropoff;
        patch.sameAsPickup = false;
      }
    }

    /* The seeded pickup must satisfy the lead time as an INSTANT, not as a day
     * count. Seeding `today + ceil(leadHours/24)` at a fixed 10:00 looks right
     * but is illegal for most of the day: with a 24h lead time, tomorrow 10:00
     * is only 15 hours away if the customer arrives at 19:00, so the page
     * loaded showing its own red "must be made at least 1 day in advance".
     * Walk real (date, slot) pairs and take the first that clears the bar the
     * validator actually applies — the same zonedWallClockToInstant comparison,
     * judged in the operator's zone. */
    const preferredSlot =
      rules.timeSlots.find((slot) => slot >= "10:00") ?? rules.timeSlots[0] ?? "10:00";
    const slots = rules.timeSlots.length > 0 ? rules.timeSlots : [preferredSlot];

    const earliestLegal = Date.now() + rules.leadTimeHours * 60 * 60 * 1000;
    const clearsLeadTime = (isoDate: string, slot: string) => {
      const instant = zonedWallClockToInstant(isoDate, slot, rules.operatorTimezone);
      // A null instant means malformed input, not an early one — do not seed it.
      return instant !== null && instant.getTime() >= earliestLegal;
    };

    const leadDays = Math.max(0, Math.ceil(rules.leadTimeHours / 24));
    let firstPickup = addDaysIso(todayIso(), Math.max(1, leadDays));
    let firstSlot = preferredSlot;
    // Bounded: leadDays+1 candidate days is always enough, since a whole day
    // beyond the lead time clears it at every slot. The cap only guards against
    // a pathological tenant zone.
    outer: for (let dayOffset = 0; dayOffset <= leadDays + 2; dayOffset += 1) {
      const candidateDate = addDaysIso(firstPickup, dayOffset);
      // Prefer the usual slot on a legal day; otherwise the first legal slot.
      const ordered = [preferredSlot, ...slots.filter((s) => s !== preferredSlot)];
      for (const slot of ordered) {
        if (clearsLeadTime(candidateDate, slot)) {
          firstPickup = candidateDate;
          firstSlot = slot;
          break outer;
        }
      }
    }

    if (!isIsoDate(state.pickupDate) || state.pickupDate < firstPickup) {
      patch.pickupDate = firstPickup;
    }
    const pickupDate = patch.pickupDate ?? state.pickupDate;

    const minSpanDays = Math.max(1, Math.ceil(rules.minRentalHours / 24));
    const firstReturn = addDaysIso(pickupDate, minSpanDays);
    if (!isIsoDate(state.dropoffDate) || state.dropoffDate < firstReturn) {
      patch.dropoffDate = firstReturn;
    }

    if (state.pickupTime === "") patch.pickupTime = firstSlot;
    if (state.dropoffTime === "") patch.dropoffTime = preferredSlot;

    if (Object.keys(patch).length > 0) form.patch(patch);
    // `form` is a fresh object on every store write; depending on it would make
    // this effect a loop. The actions it uses are stable across the store's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, tenant, vehicleId, modes, rules]);

  /* ── availability ─────────────────────────────────────────────────────── */

  /**
   * The side queries only run for an id that could BE a vehicle.
   *
   * `useVehicle` recognises Postgres' 22P02 and turns a non-UUID segment into
   * an honest 404. Its siblings do not: `/booking/hello` sends `hello` to
   * `rentals`, `blocked_dates` and `rental_extras_vehicle_pricing`, each of
   * which 400s and logs. Withholding the id keeps a mistyped URL to one
   * question and one answer.
   */
  const lookupId = UUID_PATTERN.test(vehicleId) ? vehicleId : null;

  const bookedDates = useVehicleBookedDates(lookupId);

  const rangeReady = isIsoDate(form.pickupDate) && isIsoDate(form.dropoffDate);
  const quoteStart = rangeReady ? form.pickupDate : null;
  const quoteEnd = rangeReady ? form.dropoffDate : null;

  const unavailableReason = useMemo<UnavailableReason | null>(() => {
    if (!quoteStart || !quoteEnd) return null;
    const clash = bookedDates.ranges.find(
      (range) => range.startDate <= quoteEnd && range.endDate >= quoteStart,
    );
    if (!clash) return null;
    return clash.type === "blocked" ? "blocked" : "rented";
  }, [bookedDates.ranges, quoteStart, quoteEnd]);

  const minPickupIso = useMemo(
    () => addDaysIso(todayIso(), Math.max(0, Math.ceil(rules.leadTimeHours / 24))),
    [rules.leadTimeHours],
  );

  const isPickupDateDisabled = useCallback(
    (date: Date) => {
      const iso = isoFromDate(date);
      return iso < minPickupIso || bookedDates.isDateOccupied(date);
    },
    [minPickupIso, bookedDates],
  );

  const isReturnDateDisabled = useCallback(
    (date: Date) => {
      const iso = isoFromDate(date);
      const floor = isIsoDate(form.pickupDate) ? form.pickupDate : minPickupIso;
      if (iso < floor) return true;
      if (isIsoDate(form.pickupDate)) {
        // The tenant's hard ceiling, so the calendar cannot offer a range the
        // validator will only reject afterwards.
        if (iso > addDaysIso(form.pickupDate, rules.maxRentalDays)) return true;
      }
      return bookedDates.isDateOccupied(date);
    },
    [form.pickupDate, minPickupIso, rules.maxRentalDays, bookedDates],
  );

  /* ── extras ───────────────────────────────────────────────────────────── */

  const { extras } = useRentalExtras({
    vehicleId: lookupId,
    startDate: quoteStart,
    endDate: quoteEnd,
  });

  const quoteExtras = useMemo<QuoteExtra[]>(
    () =>
      extras.map((extra) => ({
        id: extra.id,
        price: extra.price,
        billing_type: extra.billingType,
        name: extra.name,
        max_quantity: extra.maxQuantity,
      })),
    [extras],
  );

  /**
   * What is actually billable right now.
   *
   * Two filters, both load-bearing: an id the tenant no longer offers (or that
   * belonged to another tenant's site in the same browser) is dropped, and a
   * quantity above what is left for these dates is clamped. Without the clamp a
   * stock change between page loads would quote three child seats when one is
   * free.
   */
  const billableExtras = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const extra of extras) {
      const wanted = form.selectedExtras[extra.id] ?? 0;
      if (wanted <= 0) continue;
      const cap = extra.bookableQuantity;
      const qty = cap === null ? wanted : Math.min(wanted, cap);
      if (qty > 0) out[extra.id] = qty;
    }
    return out;
  }, [extras, form.selectedExtras]);

  /* ── delivery ─────────────────────────────────────────────────────────── */

  const tierConfig = useMemo<DeliveryTierConfig>(
    () => ({
      delivery_tiers_enabled: tenant?.delivery_tiers_enabled,
      delivery_distance_tiers: tenant?.delivery_distance_tiers,
      area_delivery_fee: tenant?.area_delivery_fee,
      delivery_max_distance_km: tenant?.delivery_max_distance_km,
    }),
    [tenant],
  );

  const tiersActive = hasActiveTiers(tierConfig);
  const tierRange = getTierFeeRange(tierConfig);

  const mode: DeliveryOption = form.deliveryOption ?? modes.enabled[0] ?? "fixed";

  /**
   * Area delivery is priced by road distance, and v2 has no geocoder yet.
   *
   * With tiers OFF the fee is the flat `area_delivery_fee`, which needs no
   * distance — so the address counts as priced. With tiers ON it does not: the
   * cheapest band is what `resolveDeliveryFee` returns for an unknown distance,
   * and quoting that as the total would understate the bill. The leg is left
   * unpriced and the sidebar says so out loud instead.
   */
  const areaFeePending = mode === "area" && tiersActive;
  const areaFeeHint = useMemo(() => {
    if (mode !== "area") return null;
    if (tiersActive && tierRange) return `from ${formatCurrency(tierRange.min)}`;
    const flat = tenant?.area_delivery_fee ?? 0;
    return flat > 0 ? `+${formatCurrency(flat)}` : "Free";
  }, [mode, tiersActive, tierRange, tenant?.area_delivery_fee, formatCurrency]);

  const pickupDelivery = useMemo<QuoteDeliverySelection>(
    () =>
      buildLeg({
        mode,
        locationId: form.pickupLocationId,
        address: form.pickupAddress,
        locationsById,
        areaPriceable: !tiersActive,
      }),
    [mode, form.pickupLocationId, form.pickupAddress, locationsById, tiersActive],
  );

  const returnDelivery = useMemo<QuoteDeliverySelection>(
    () =>
      form.sameAsPickup
        ? pickupDelivery
        : buildLeg({
            mode,
            locationId: form.returnLocationId,
            address: form.returnAddress,
            locationsById,
            areaPriceable: !tiersActive,
          }),
    [
      form.sameAsPickup,
      pickupDelivery,
      mode,
      form.returnLocationId,
      form.returnAddress,
      locationsById,
      tiersActive,
    ],
  );

  /* ── the quote ────────────────────────────────────────────────────────── */

  const quoteVehicle = useMemo<QuoteVehicle | null>(() => {
    if (!vehicle) return null;
    return {
      id: vehicle.id,
      daily_rent: vehicle.dailyRent,
      weekly_rent: vehicle.weeklyRent,
      monthly_rent: vehicle.monthlyRent,
      security_deposit: vehicle.securityDeposit,
      daily_mileage: vehicle.dailyMileage,
      weekly_mileage: vehicle.weeklyMileage,
      monthly_mileage: vehicle.monthlyMileage,
      excess_mileage_rate: vehicle.excessMileageRate,
      unlimited_mileage_available: vehicle.unlimitedMileageAvailable,
      unlimited_mileage_price_daily: vehicle.unlimitedMileagePrices.daily,
      unlimited_mileage_price_weekly: vehicle.unlimitedMileagePrices.weekly,
      unlimited_mileage_price_monthly: vehicle.unlimitedMileagePrices.monthly,
    };
  }, [vehicle]);

  const promo = usePromoCode();

  const { quote, isLoading: quoteLoading, pricingRulesDegraded } = useBookingQuote({
    vehicle: quoteVehicle,
    pickupDate: quoteStart,
    dropoffDate: quoteEnd,
    extras: quoteExtras,
    selectedExtras: billableExtras,
    promo: promo.promo,
    installmentPlanSelected: form.wantsInstallments,
    pickupDelivery,
    returnDelivery,
    addUnlimitedMileage: form.addUnlimitedMileage,
    collectPaymentUpfront: rules.collectPaymentUpfront,
  });

  /**
   * Mirror the two delivery fees the customer was SHOWN back into the store.
   *
   * The checkout workstream posts what was on screen rather than re-deriving it
   * — `rentals` carries `delivery_fee` and `collection_fee` as separate columns,
   * and a second derivation is a second chance to disagree with the quote.
   */
  useEffect(() => {
    const state = useBookingStore.getState();
    const pickupFee = quote.pickupDelivery.fee;
    const returnFee = quote.returnDelivery.fee;
    if (
      state.pickupDeliveryFee !== pickupFee ||
      state.returnDeliveryFee !== returnFee
    ) {
      state.patch({ pickupDeliveryFee: pickupFee, returnDeliveryFee: returnFee });
    }
  }, [quote.pickupDelivery.fee, quote.returnDelivery.fee]);

  /* ── validation & submission ──────────────────────────────────────────── */

  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [checkoutMessage, setCheckoutMessage] = useState<string | null>(null);

  /*
    THE WRITE PATH. "Continue to payment" no longer just opens a dialog: it
    commits the booking first — customer, rental, extras, invoice, ledger — and
    only then mounts Stripe, because `create-booking-payment-intent` prices the
    charge from the rental's ledger and refuses a request without a rental id.
    See `@/lib/booking/create-booking` for the ordering and why it is fixed.
  */
  const booking = useCreateBooking();
  // Destructured so the click handler depends on the STABLE action rather than
  // on the hook's result object, which is new on every render.
  const { create: createBooking } = booking;
  const creatingBooking = booking.state.status === "creating";
  /**
   * The payment that has already happened on this page, if one has.
   *
   * Replaces the previous bare `bookingCompleted` boolean, and the two facts are
   * now derived from ONE value rather than tracked separately: "this car has
   * been paid for" and "here is the link to finish it" can no longer disagree.
   * Rehydrated from sessionStorage on mount — see `PaidBookingHandoff`. Non-null
   * also means the CTA must not offer to book the same car for the same days
   * again; `hardBlockReason` below is where that is enforced.
   */
  const [paidHandoff, setPaidHandoff] = useState<PaidBookingHandoff | null>(null);

  const validation = useMemo(
    () =>
      validateBooking({
        form,
        rules,
        modes,
        vehicle,
        isRangeAvailable: bookedDates.isRangeAvailable,
        unavailableReason,
        now: new Date(),
      }),
    [form, rules, modes, vehicle, bookedDates.isRangeAvailable, unavailableReason],
  );

  /**
   * Date problems are shown the moment they exist; everything else waits until
   * the customer has actually tried to continue. Complaining about an empty
   * name field before anybody typed in it is noise, but silently accepting an
   * illegal date range and only objecting at the end wastes the whole form.
   */
  const ALWAYS_VISIBLE: ReadonlySet<BookingField> = useMemo(
    () => new Set<BookingField>(["pickupDate", "dropoffDate", "pickupTime", "dropoffTime"]),
    [],
  );

  /**
   * ── WHY BLUR TRACKING EXISTS AT ALL ──────────────────────────────────────
   * The CTA is now disabled until the form validates, and `submitAttempted` was
   * previously set BY clicking it. Those two facts together are a trap: a
   * customer with an empty email would face a dead button and no red text
   * anywhere, because the only thing that could have revealed the red text is
   * the click the button no longer accepts. So a field also becomes eligible to
   * show its error once the customer has been IN it and left — which is the
   * moment they can be told something without it reading as a telling-off.
   *
   * It is a delegated `focusout` on the wrapper below rather than an `onBlur`
   * prop on each control: `BookingForm` and `field-primitives` are owned by
   * another workstream, and this needs no change to either. React's `onBlur` is
   * `focusout` under the hood, so it bubbles; the map is keyed on the DOM ids
   * those controls already set for their `<label for>` bindings.
   */
  const [touched, setTouched] = useState<ReadonlySet<BookingField>>(
    () => new Set<BookingField>(),
  );

  const handleFormBlur = useCallback((event: React.FocusEvent<HTMLDivElement>) => {
    const target: EventTarget = event.target;
    if (!(target instanceof HTMLElement)) return;
    const field = FIELD_BY_DOM_ID[target.id];
    if (field === undefined) return;
    setTouched((previous) => {
      if (previous.has(field)) return previous;
      const next = new Set(previous);
      next.add(field);
      return next;
    });
  }, []);

  const errorFor = useCallback(
    (field: BookingField) => {
      if (!submitAttempted && !ALWAYS_VISIBLE.has(field) && !touched.has(field)) {
        return undefined;
      }
      return validation.errors[field];
    },
    [submitAttempted, ALWAYS_VISIBLE, touched, validation.errors],
  );

  /**
   * Reasons the customer cannot fix by typing.
   *
   * Kept apart from the "your form is incomplete" line on purpose: a paused
   * vehicle and a missing email are not the same problem and must not share a
   * sentence. First match wins, most-fundamental first — a paused vehicle makes
   * the delivery question moot, and an unpriced quote makes all of it moot.
   */
  const hardBlockReason = useMemo<string | null>(() => {
    if (paidHandoff !== null) {
      /*
        The rental is PAID FOR — which is not the same as confirmed, and this
        line used to say it was. Pressing Continue again would try to book the
        same car for the same dates a second time and be refused by the overlap
        trigger, so the button stays dead either way; the only question is
        whether the sentence beside it is true. It now names the real state, and
        which of the two sentences depends on whether there is a link to send
        them to: promising an upload step we cannot route to would be the same
        mistake in the other direction.
      */
      return paidHandoff.documentsToken !== null
        ? "Payment for this booking has been taken. Your insurance document is still outstanding — send it and we will review it before confirming."
        : "Payment for this booking has been taken. We are emailing you a link to send your insurance document, which is the last step before we confirm it.";
    }
    if (creatingBooking) {
      return null;
    }
    if (vehicle?.isPaused ?? false) {
      return "This vehicle is not bookable right now. Please choose another from the fleet.";
    }
    if (pricingRulesDegraded) {
      return "We could not load this operator's seasonal pricing, so we cannot take payment yet. Please try again shortly.";
    }
    if (quote.deliveryBlocked) {
      return "That address is outside our delivery area. Choose another pickup or return arrangement to continue.";
    }
    if (!quote.ready) {
      return "Choose your pickup and return dates to see the price.";
    }
    return null;
  }, [
    paidHandoff,
    creatingBooking,
    vehicle?.isPaused,
    pricingRulesDegraded,
    quote.deliveryBlocked,
    quote.ready,
  ]);

  const outstanding = useMemo(
    () => describeOutstanding(validation.errors),
    [validation.errors],
  );

  const checkoutBlock = useMemo<CheckoutBlock | null>(() => {
    /*
      The write takes several round-trips, so the button must be dead for its
      duration — a second press would start a second `createBooking` that cannot
      see the first one's draft and would race the overlap trigger against it.

      `kind: "incomplete"` and not `"blocked"`: the kind is a styling
      discriminator, and `blocked` paints the line in the warning colour. "Saving
      your booking…" is progress, not a problem, so it takes the neutral one.
    */
    if (creatingBooking) {
      return { kind: "incomplete", message: "Saving your booking…" };
    }
    if (hardBlockReason !== null) {
      return { kind: "blocked", message: hardBlockReason };
    }
    if (outstanding !== null) {
      return { kind: "incomplete", message: outstanding };
    }
    return null;
  }, [creatingBooking, hardBlockReason, outstanding]);

  /* ── payment ──────────────────────────────────────────────────────────── */

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentReturn, setPaymentReturn] = useState<PaymentReturn | null>(null);

  /**
   * Did we just come back from a 3-D Secure hop?
   *
   * Read once, from `window.location` rather than `useSearchParams`, so this
   * page needs no Suspense boundary. If a stashed intent matches the secret in
   * the URL the panel reopens and resolves it, instead of the customer landing
   * on a form that has quietly forgotten they paid.
   */
  useEffect(() => {
    const returned = readPaymentReturn();
    if (returned === null) return;
    setPaymentReturn(returned);
    setPaymentOpen(true);
  }, []);

  /**
   * Did this tab already pay for this car?
   *
   * The companion to the effect above, and the one that covers the case a
   * 3-D Secure return does not: an ordinary reload, or a back-navigation, after
   * an in-page payment. `paidHandoff` and `checkoutMessage` are ordinary
   * `useState`, so without this the page would come back looking untouched and
   * would happily offer to book the same car again.
   *
   * Runs once, and only adopts a stash written for THIS vehicle — see
   * `readPaidHandoff`. It does NOT reopen the payment dialog: the money has
   * already moved, and re-mounting Stripe over a paid booking is how a customer
   * ends up paying twice. The page-level notice is the whole of the recovery.
   */
  useEffect(() => {
    const stashed = readPaidHandoff(vehicleId);
    if (stashed === null) return;
    setPaidHandoff(stashed);
    setCheckoutMessage(
      stashed.kind === "succeeded"
        ? "Payment received for this booking. Your insurance document is the last step before we confirm it."
        : "Your bank is still confirming this payment. We will email you when it clears.",
    );
  }, [vehicleId]);

  /**
   * What the page says once the dialog is dismissed.
   *
   * The dialog is dismissible and the page behind it is the only durable
   * surface, so this does two things rather than one: it writes the handoff to
   * sessionStorage (so a reload cannot erase the evidence of a charge) and it
   * leaves a sentence beside the total. The LINK lives in `PaidBookingNotice`
   * below — `checkoutMessage` is rendered as plain text by `CheckoutTotal`, and
   * a URL spelled out in prose is not a route anybody taps on a phone.
   *
   * NEITHER SENTENCE MAY SAY "CONFIRMED". The documents still have to be
   * uploaded and an operator still has to approve; `notify-booking-approved` is
   * what tells the customer they are confirmed, and it fires from the portal,
   * not from here.
   */
  const handlePaymentSucceeded = useCallback(
    (outcome: PaymentOutcome) => {
      const handoff: PaidBookingHandoff = {
        vehicleId,
        // Read off the write hook rather than `paymentRequest`, which is
        // declared further down this component and would be in its temporal
        // dead zone in this dependency array. Null after a 3-D Secure hop —
        // that is a fresh mount, so the booking hook is idle again — and the
        // field is informational, so null is tolerated rather than asserted on.
        rentalId:
          booking.state.status === "ready" ? booking.state.booking.rentalId : null,
        rentalNumber: outcome.rentalNumber,
        documentsToken: outcome.documentsToken,
        kind: outcome.kind,
      };
      setPaidHandoff(handoff);
      stashPaidHandoff(handoff);

      const reference =
        outcome.rentalNumber === null
          ? ""
          : ` Your booking reference is ${outcome.rentalNumber}.`;
      setCheckoutMessage(
        outcome.kind === "succeeded"
          ? `Payment received.${reference} One step left: send us your insurance document so we can review it and confirm this booking.`
          : `Payment is being confirmed by your bank.${reference} We will email you when it clears, with a link to send your insurance document.`,
      );
    },
    [vehicleId, booking.state],
  );

  const handlePaymentOpenChange = useCallback((next: boolean) => {
    setPaymentOpen(next);
    if (next) return;
    // Drop the `payment_intent*` params Stripe appended, so a refresh does not
    // re-open the panel on a payment that has already been resolved.
    setPaymentReturn((previous) => {
      if (previous !== null && typeof window !== "undefined") {
        window.history.replaceState(null, "", window.location.pathname);
      }
      return null;
    });
  }, []);

  /* ── where the car is collected and returned, as `rentals` stores it ────── */

  /**
   * Each leg reduced to the two columns `rentals` actually has: an optional
   * `pickup_locations` id and a human address.
   *
   * The three modes fill them differently, and the difference is not cosmetic —
   * `pickup_location_id` is a foreign key and must be null unless the customer
   * really picked one of the operator's locations.
   */
  const bookingLegs = useMemo<{ pickup: BookingLocationLeg; return: BookingLocationLeg }>(() => {
    const returnId = form.sameAsPickup ? form.pickupLocationId : form.returnLocationId;

    if (mode === "location") {
      return {
        pickup: {
          id: form.pickupLocationId,
          address: form.pickupLocationId
            ? (locationsById.get(form.pickupLocationId)?.address ?? null)
            : null,
        },
        return: {
          id: returnId,
          address: returnId ? (locationsById.get(returnId)?.address ?? null) : null,
        },
      };
    }

    if (mode === "area") {
      const returnAddress = form.sameAsPickup ? form.pickupAddress : form.returnAddress;
      return {
        pickup: { id: null, address: form.pickupAddress },
        return: { id: null, address: returnAddress },
      };
    }

    // 'fixed' — the operator's own address, with the customer's typed address as
    // the fallback for a tenant that enabled the mode but never set one (the
    // same fallback `validateBooking` assumes when it asks for the address).
    const pickupAddress = rules.fixedPickupAddress ?? form.pickupAddress;
    return {
      pickup: { id: null, address: pickupAddress },
      return: {
        id: null,
        address: form.sameAsPickup
          ? pickupAddress
          : (rules.fixedReturnAddress ?? form.returnAddress),
      },
    };
  }, [
    mode,
    form.pickupLocationId,
    form.returnLocationId,
    form.pickupAddress,
    form.returnAddress,
    form.sameAsPickup,
    locationsById,
    rules.fixedPickupAddress,
    rules.fixedReturnAddress,
  ]);

  /**
   * The payload the edge function prices from — available only AFTER the
   * booking is written.
   *
   * `rentalId` is the load-bearing field: `create-booking-payment-intent`
   * refuses a request without one, because it computes the amount by summing
   * that rental's open ledger charges rather than trusting the browser. So this
   * is null until `createBooking` has returned, which is also why the panel
   * cannot be opened before then.
   *
   * `expectedAmount` is the customer-facing total sent back as an INTEGRITY
   * CHECK. If the server's own figure has moved by more than a cent it refuses
   * the whole request, so the customer can never be shown one number and
   * charged another. It is in major units; `quotedTotalCents` below is the same
   * money in minor units and is what the hook's own contract documents.
   */
  const paymentRequest = useMemo<BookingPaymentRequest | null>(() => {
    if (booking.state.status !== "ready") return null;
    if (!tenant || !vehicle || !quote.ready) return null;

    const created = booking.state.booking;

    return {
      rentalId: created.rentalId,
      tenantSlug: tenant.slug,
      customerId: created.customerId,
      customerEmail: form.customerEmail.trim().toLowerCase(),
      customerName: form.customerName.trim(),
      expectedAmount: quote.grandTotal,

      tenantId: tenant.id,
      vehicleId: vehicle.id,
      pickup: { date: form.pickupDate, time: form.pickupTime },
      dropoff: { date: form.dropoffDate, time: form.dropoffTime },
      delivery: {
        option: mode,
        pickupLocationId: bookingLegs.pickup.id,
        returnLocationId: bookingLegs.return.id,
        pickupAddress: form.pickupAddress,
        returnAddress: form.sameAsPickup ? form.pickupAddress : form.returnAddress,
        sameAsPickup: form.sameAsPickup,
        pickupFee: quote.pickupDelivery.fee,
        returnFee: quote.returnDelivery.fee,
      },
      customer: {
        name: form.customerName.trim(),
        email: form.customerEmail.trim(),
        phone: form.customerPhone.trim(),
        dateOfBirth: form.driverDOB,
        timezone: form.customerTimezone,
      },
      options: {
        selectedExtras: billableExtras,
        addUnlimitedMileage: form.addUnlimitedMileage,
        wantsInstallments: form.wantsInstallments,
        promoCode: promo.promo?.code ?? null,
      },
      consent: {
        agreeTerms: form.agreeTerms,
        agreeCharges: form.agreeCharges,
        smsConsent: form.smsConsent,
      },
      quotedTotalCents: quote.grandTotalCents,
      // `payableNow` is either the whole total or exactly zero, so this reuses
      // the ONE rounded figure rather than rounding a second time and inviting
      // the two to disagree by a cent.
      quotedDueNowCents: quote.payableNow === 0 ? 0 : quote.grandTotalCents,
      currency: (tenant.currency_code ?? "USD").toUpperCase(),
    };
  }, [
    booking.state,
    tenant,
    vehicle,
    quote,
    form,
    mode,
    bookingLegs,
    billableExtras,
    promo.promo,
  ]);

  /**
   * Commit the booking, then show the card form.
   *
   * The order is forced (see `create-booking.ts`) and so is the failure
   * behaviour: if the write does not land, the customer is told so in plain
   * words and NO Stripe dialog opens. An empty card form over a booking that
   * does not exist is the one outcome worth going out of the way to avoid.
   */
  const handleCheckout = useCallback(async () => {
    // Still set, even though the button is now disabled while incomplete: it
    // reveals any field the customer never focused, which blur alone misses.
    setSubmitAttempted(true);
    setCheckoutMessage(null);

    if (!validation.isComplete) return;

    if (!rules.collectPaymentUpfront) {
      // Enquiry tenants take no card here. Submitting the enquiry is a separate
      // workstream, and inventing an endpoint would be a lie to unpick later.
      setCheckoutMessage(
        "Everything checks out. Enquiry submission is not connected yet — nothing has been sent.",
      );
      return;
    }

    if (!tenant || !vehicle || !quote.ready) return;

    const result = await createBooking({
      tenantId: tenant.id,
      vehicleId: vehicle.id,
      form,
      deliveryOption: mode,
      quote,
      selectedExtras: billableExtras,
      pickupLocation: bookingLegs.pickup,
      returnLocation: bookingLegs.return,
    });

    // null means a write was already in flight and this click was swallowed.
    if (result === null) return;

    if (!result.ok) {
      if (result.failure.detail !== null) {
        // The customer gets the sentence; the console gets the column that
        // actually refused, which is what makes this diagnosable at all.
        console.error(`[booking] ${result.failure.detail}`);
      }
      setCheckoutMessage(
        result.failure.retryable
          ? `${result.failure.message}`
          : result.failure.message,
      );
      return;
    }

    setPaymentOpen(true);
  }, [
    validation.isComplete,
    rules.collectPaymentUpfront,
    tenant,
    vehicle,
    quote,
    form,
    mode,
    billableExtras,
    bookingLegs,
    createBooking,
  ]);

  /* ── states ───────────────────────────────────────────────────────────── */

  if (tenantError) {
    return (
      <StatePanel
        icon={TriangleAlert}
        title="This site is not available"
        body={tenantError}
      />
    );
  }

  if (vehicleLoading || tenantLoading || !hydrated) {
    return <BookingPageSkeleton />;
  }

  if (notFound) {
    return (
      <StatePanel
        icon={CarFront}
        title="We could not find that vehicle"
        body="It may have been removed from the fleet, or the link may be wrong."
        action={
          <Button asChild variant="brand" size="lg">
            <Link href="/fleet">Browse the fleet</Link>
          </Button>
        }
      />
    );
  }

  if (isError || !vehicle) {
    return (
      <StatePanel
        icon={TriangleAlert}
        title="We could not load this vehicle"
        body="Something went wrong on our side. Please try again."
        action={
          <Button variant="brand" size="lg" onClick={() => void refetch()}>
            <RotateCw strokeWidth={2} />
            Try again
          </Button>
        }
      />
    );
  }

  const checkout: CheckoutState = {
    quote,
    collectPaymentUpfront: rules.collectPaymentUpfront,
    onCheckout: handleCheckout,
    block: checkoutBlock,
    checkoutNotice: checkoutMessage,
  };

  const priceBlock = (
    <PriceBlock
      quote={quote}
      quoteLoading={quoteLoading}
      collectPaymentUpfront={rules.collectPaymentUpfront}
      promoCode={promo.promo?.code ?? null}
      pricingRulesDegraded={pricingRulesDegraded}
      vehicleIsPaused={vehicle.isPaused}
    />
  );

  return (
    /* `pb-24` on a phone reserves the 65px fixed checkout bar, plus air. */
    <div className="container-page pt-4 pb-24 lg:pt-8 lg:pb-12">
      <Link
        href="/fleet"
        className="-my-1.5 inline-flex min-h-11 items-center gap-1.5 text-sm text-brand-text-soft transition-colors hover:text-brand-text"
      >
        <ArrowLeft className="size-4" strokeWidth={1.75} />
        Back to the fleet
      </Link>

      {/*
        THE DURABLE SURFACE. The payment dialog is dismissible and the fixed
        mobile bar is unmounted while it is open, so without this the only trace
        of a completed payment was one grey sentence under the total — and the
        route to the outstanding upload step existed nowhere on the page at all.
        It sits above the form deliberately: the form is now the least useful
        thing on screen.
      */}
      {paidHandoff !== null ? <PaidBookingNotice handoff={paidHandoff} /> : null}

      {/*
        VEHICLE LEFT (~38%), FORM RIGHT (~62%) — and the vehicle is FIRST in the
        DOM, so the phone's single column reads car-then-form without an
        `order-*` utility divorcing the visual order from the tab order.
      */}
      <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,38fr)_minmax(0,62fr)] lg:gap-8 xl:gap-10">
        <aside
          className={cn(
            "space-y-4",
            /*
              THE STICKY RAIL, and why it is capped rather than left to flow.

              A sticky element taller than the viewport pins its TOP and parks
              everything below the fold — which is exactly where the total and
              the button would end up. So the rail is a flex column no taller
              than the screen: the car and the itemised bill scroll inside it if
              they must, and the total-and-CTA sits outside that scroller and
              never moves.

              `overflow` lives on the INNER div, never on the <aside> — overflow
              on the sticky element's own box (or any ancestor) kills `position:
              sticky` outright. That is the mistake the previous pass made.

              The cap is `100svh - 11rem`, not `- 3rem` to match `top-6`. 11rem
              is roughly what sits above the rail before you scroll — navbar
              plus the back link — so the total and the button are on screen at
              scroll depth ZERO too, not only once the rail has stuck. Measured:
              the rail starts at y=165, so a 3rem cap put the CTA at y=954 on a
              900px screen. Under-filling the stuck rail by ~150px is the price,
              and it is the right one.
            */
            "lg:sticky lg:top-6 lg:col-start-1 lg:row-start-1 lg:flex lg:max-h-[calc(100svh-11rem)] lg:flex-col lg:space-y-0 lg:self-start",
          )}
        >
          <div className="space-y-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-2 lg:[scrollbar-gutter:stable] lg:[scrollbar-width:thin] lg:[&::-webkit-scrollbar]:w-1.5 lg:[&::-webkit-scrollbar-thumb]:rounded-full lg:[&::-webkit-scrollbar-thumb]:bg-brand-border">
            <VehicleCard vehicle={vehicle} />
            {/*
              The bill belongs beside the car on a desktop. On a phone it moves
              below the form — quoting a total above the dates that produce it
              is a number with nothing behind it.
            */}
            <div className="hidden lg:block">{priceBlock}</div>
          </div>

          <div className="hidden lg:block lg:shrink-0 lg:pt-3">
            <CheckoutTotal {...checkout} />
          </div>
        </aside>

        {/*
          `onBlur` here, not on each field: React's onBlur is `focusout`, which
          bubbles, so one listener on the wrapper sees every control leave focus.
          See `handleFormBlur` for why that matters now the CTA is disabled.
        */}
        <div className="lg:col-start-2 lg:row-start-1" onBlur={handleFormBlur}>
          <BookingForm
            rules={rules}
            modes={modes}
            pickupLocations={pickupLocations}
            returnLocations={returnLocations}
            extras={extras}
            quote={quote}
            errorFor={errorFor}
            isPickupDateDisabled={isPickupDateDisabled}
            isReturnDateDisabled={isReturnDateDisabled}
            areaFeeHint={areaFeeHint}
            areaFeePending={areaFeePending}
            promo={promo}
            rentalDays={validation.rentalDays}
          />

          <div className="mt-5 lg:hidden">{priceBlock}</div>
        </div>
      </div>

      {/*
        The fixed bar is UNMOUNTED while the payment dialog is open, not merely
        layered under it. At 360px the dialog's confirm button and the bar occupy
        the same 65px of screen, and a scrim the customer cannot see through is
        still a scrim they can tap by accident.
      */}
      {paymentOpen ? null : <MobileCheckoutBar {...checkout} />}

      <PaymentPanel
        open={paymentOpen}
        onOpenChange={handlePaymentOpenChange}
        request={paymentRequest}
        amountLabel={formatCurrency(quote.payableNow)}
        vehicleLabel={vehicle.displayName}
        resume={paymentReturn}
        onSucceeded={handlePaymentSucceeded}
      />
    </div>
  );
}

/**
 * DOM id -> the field it validates.
 *
 * The ids are the ones `BookingForm` already sets so its `<label for>` bindings
 * work; this map is the only thing coupling the two, and an id that changes
 * shows up as a field that stops revealing its error on blur rather than as a
 * crash. Several ids map to one field on purpose — the pickup leg is a location
 * picker, a delivery address or a meeting address depending on the tenant's
 * enabled modes, and all three answer `pickupLocation`.
 */
const FIELD_BY_DOM_ID: Readonly<Record<string, BookingField>> = {
  "pickup-date": "pickupDate",
  "pickup-time": "pickupTime",
  "return-date": "dropoffDate",
  "return-time": "dropoffTime",
  "pickup-location": "pickupLocation",
  "delivery-address": "pickupLocation",
  "pickup-address": "pickupLocation",
  "return-location": "returnLocation",
  "return-address": "returnLocation",
  "customer-name": "customerName",
  "customer-email": "customerEmail",
  "customer-phone": "customerPhone",
  "driver-dob": "driverDOB",
  "agree-terms": "agreeTerms",
  "agree-charges": "agreeCharges",
};

/* ─────────────────────── the paid-but-not-confirmed notice ───────────────── */

/**
 * The block that stays on the page after the payment dialog is closed.
 *
 * ── EVERY SENTENCE HERE IS CHOSEN AGAINST ONE RULE ──────────────────────────
 * It may not say the booking is confirmed, complete or booked. It is not:
 * payment has been taken, the documents are outstanding, and an OPERATOR still
 * has to approve. The confirmation email is sent by `notify-booking-approved`
 * from the portal at that approval, and telling a customer otherwise is how
 * somebody turns up at a depot for keys nobody is going to hand over.
 *
 * The primary action is the upload link when there is a token to build one
 * from. When there is not — the endpoint has not been redeployed, or this is a
 * stash from before the field existed — it says the link was emailed, which is
 * true (the settlement path sends it) and is the one honest fallback. A dead
 * link is never rendered.
 *
 * `processing` gets no link at all. The bank has not taken the money yet, and
 * inviting someone to dig out their insurance certificate for a payment that may
 * still be declined is work we should not be asking for.
 */
function PaidBookingNotice({ handoff }: { handoff: PaidBookingHandoff }) {
  const settled = handoff.kind === "succeeded";
  const href =
    settled && handoff.documentsToken !== null
      ? bookingDocumentsHref(handoff.documentsToken)
      : null;

  return (
    <div
      // `role="status"` rather than `alert`: this is the outcome of something
      // the customer just did on purpose, not an interruption.
      role="status"
      className={cn(
        "mt-4 rounded-[18px] border px-4 py-4 sm:px-5",
        settled
          ? "border-success-med bg-success-light"
          : "border-info-med bg-info-light",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0">
          {settled ? (
            <CheckCircle2 aria-hidden strokeWidth={1.75} className="size-5 text-success" />
          ) : (
            <Clock aria-hidden strokeWidth={1.75} className="size-5 text-info" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-brand-text">
            {settled ? "Payment received" : "Payment is being confirmed"}
          </h2>

          <p className="mt-1 text-sm leading-relaxed text-brand-text-soft">
            {settled
              ? "One step left before we can confirm this booking: a copy of your insurance document. An operator reviews it and we will email you as soon as your booking is confirmed."
              : "Your bank has not settled this yet. We will email you the moment it clears, with a link to send your insurance document."}
          </p>

          {handoff.rentalNumber !== null ? (
            <p className="mt-2 text-xs text-brand-text-subtle">
              Booking reference{" "}
              <span className="font-medium text-brand-text">
                {handoff.rentalNumber}
              </span>
            </p>
          ) : null}

          {href !== null ? (
            <Button asChild variant="brand" size="lg" className="mt-3 h-11 w-full sm:w-auto">
              <Link href={href}>
                Send my insurance document
                <ArrowRight aria-hidden strokeWidth={2} />
              </Link>
            </Button>
          ) : settled ? (
            <p className="mt-3 text-xs leading-relaxed text-brand-text-subtle">
              We are sending a link to your email so you can send your insurance
              document. It is valid for seven days — if it expires, that page will
              send you a fresh one.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────────── helpers ───────────────────────────── */

/** `vehicles.id` is a uuid; anything else in the URL is definitively not one. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Local Y-M-D, never `toISOString()` — that is UTC and moves the day. */
function isoFromDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function buildLeg(params: {
  mode: DeliveryOption;
  locationId: string | null;
  address: string;
  locationsById: ReadonlyMap<string, PickupLocation>;
  /** False when this tenant prices by distance and no distance is known. */
  areaPriceable: boolean;
}): QuoteDeliverySelection {
  switch (params.mode) {
    case "fixed":
      return { mode: "fixed" };
    case "location": {
      const location = params.locationId
        ? params.locationsById.get(params.locationId)
        : undefined;
      return { mode: "location", fee: location ? location.deliveryFee : null };
    }
    case "area":
      return {
        mode: "area",
        addressSelected: params.areaPriceable && params.address.trim() !== "",
        distanceKm: null,
      };
  }
}

/**
 * The loading state, laid out like the page it precedes.
 *
 * Same column split, same order, so nothing jumps sideways when the real
 * content lands — the vehicle rail on the left, the form on the right.
 */
function BookingPageSkeleton() {
  return (
    <div className="container-page pt-4 pb-24 lg:pt-8 lg:pb-12">
      <Skeleton className="h-5 w-32 bg-brand-stone" />

      <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,38fr)_minmax(0,62fr)] lg:gap-8 xl:gap-10">
        <div className="space-y-4 lg:col-start-1 lg:row-start-1">
          <div className="overflow-hidden rounded-[18px] border border-brand-border-soft bg-white">
            <Skeleton className="aspect-[16/10] w-full rounded-none bg-brand-stone" />
            <div className="space-y-3 p-4">
              <Skeleton className="h-6 w-2/3 bg-brand-stone" />
              <Skeleton className="h-5 w-1/3 bg-brand-stone" />
              <Skeleton className="h-24 w-full rounded-[12px] bg-brand-stone" />
            </div>
          </div>
          <Skeleton className="hidden h-56 w-full rounded-[18px] bg-brand-stone lg:block" />
        </div>

        <div className="space-y-4 rounded-[18px] border border-brand-border-soft bg-white p-4 sm:p-5 lg:col-start-2 lg:row-start-1">
          <Skeleton className="h-3 w-24 bg-brand-stone" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Skeleton className="h-11 bg-brand-stone" />
            <Skeleton className="h-11 bg-brand-stone" />
            <Skeleton className="h-11 bg-brand-stone" />
            <Skeleton className="h-11 bg-brand-stone" />
          </div>
          <Skeleton className="h-3 w-28 bg-brand-stone" />
          <Skeleton className="h-20 w-full bg-brand-stone" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Skeleton className="h-11 bg-brand-stone" />
            <Skeleton className="h-11 bg-brand-stone" />
            <Skeleton className="h-11 bg-brand-stone" />
            <Skeleton className="h-11 bg-brand-stone" />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatePanel({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: typeof CarFront;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="container-page py-20">
      <div className="mx-auto max-w-md rounded-[18px] border border-brand-border-soft bg-white px-6 py-10 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-brand-stone">
          <Icon
            aria-hidden
            strokeWidth={1.5}
            className="size-5 text-brand-text-soft"
          />
        </span>
        <h1 className="mt-4 text-lg font-semibold text-brand-text">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-brand-text-soft">{body}</p>
        {action ? <div className="mt-6">{action}</div> : null}
      </div>
    </div>
  );
}
