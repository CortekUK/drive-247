"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useTenant } from "@nw/contexts/TenantContext";
import { useBookingQuote } from "@nw/hooks/use-booking-quote";
import { usePickupLocations } from "@nw/hooks/use-pickup-locations";
import { useRentalExtras } from "@nw/hooks/use-rental-extras";
import { useVehicle } from "@nw/hooks/use-vehicle";
import { useVehicleBookedDates } from "@nw/hooks/use-vehicle-availability";
import { useTenantBranding } from "@nw/hooks/use-tenant-branding";
import { useCreateBooking } from "@nw/hooks/use-create-booking";
import {
  readTripIntentFromLocation,
  sameTripAddress,
} from "@nw/lib/booking/trip-intent";
import type { BookingLocationLeg } from "@nw/lib/booking/types";
import {
  getTierFeeRange,
  hasActiveTiers,
  type DeliveryTierConfig,
} from "@nw/lib/domain";
import type {
  QuoteDeliverySelection,
  QuoteExtra,
  QuoteVehicle,
} from "@nw/lib/quote/types";
import {
  useBookingStore,
  useHydrateBookingStore,
  type DeliveryOption,
} from "@nw/lib/stores/booking-store";
import { toQuoteVehicle } from "@nw/lib/quote/quote-vehicle";
import type { PickupLocation, UnavailableReason } from "@nw/lib/vehicles/types";

import {
  describeOutstanding,
  type CheckoutBlock,
  type CheckoutState,
} from "./checkout-logic";
import {
  clearResumeParam,
  isUpcomingIsoDate,
  takeResumedBooking,
  trackBookingProgress,
  type BookingStage,
} from "@/lib/abandoned-booking-tracker";
import { deriveBookingRules, resolveDeliveryModes } from "./booking-rules";
import {
  readPaymentReturn,
  type BookingPaymentRequest,
  type PaymentOutcome,
  type PaymentReturn,
} from "./payment-panel-logic";
import {
  addDaysIso,
  isIsoDate,
  resolveBrowserTimezone,
  todayIso,
} from "./time-utils";
import { firstLegalPickup, firstLegalReturn } from "./trip-window";
import { usePromoCode } from "./use-promo-code";
import { validateBooking, type BookingField } from "./validation";

/**
 * The booking page's data and decisions, as one hook.
 *
 * Lifted VERBATIM out of `vehicle-booking-page.tsx` so the current site and the
 * v2 site (`@nw/site-v2/booking/vehicle-booking-page`) run the same seeding,
 * availability, quote, validation, write path, payment handoff and tracking —
 * only their markup differs. Nothing in here renders. A change to how a booking
 * behaves is made here, once, and both pages pick it up.
 *
 * The comments below are the ones that sat beside this code in the page; they
 * still describe it exactly.
 */

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
export interface PaidBookingHandoff {
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

export function useVehicleBooking(vehicleId: string) {
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

    // The first pickup that clears the lead time — see `trip-window.ts`.
    const {
      date: firstPickup,
      slot: firstSlot,
      preferredSlot,
    } = firstLegalPickup(rules);

    if (!isIsoDate(state.pickupDate) || state.pickupDate < firstPickup) {
      patch.pickupDate = firstPickup;
    }
    const pickupDate = patch.pickupDate ?? state.pickupDate;

    const firstReturn = firstLegalReturn(pickupDate, rules);
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

  /* ── "Finish your booking" from the recovery email ─────────────────────
   * ?resume=<token> brings back the dates and contact details the renter had
   * entered for THIS car, on any device. It overrides the seeded defaults
   * (that is the point of the link), but an address only fills a hole, for
   * the same reason the trip intent above does: which arrangement accepts a
   * typed address is the seeding's call. Dates that have gone by are left to
   * the seeding. A browser that already holds this booking keeps its own copy.
   */
  useEffect(() => {
    if (!hydrated || !tenant?.id) return;
    let cancelled = false;
    void takeResumedBooking(tenant.id).then((resumed) => {
      if (cancelled || !resumed) return;
      clearResumeParam();
      if (!resumed.ok) return;
      if (resumed.site !== "v2" || resumed.sameSession || resumed.vehicleId !== vehicleId) return;
      const s = resumed.state;
      const text = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v : null);
      const patch: Parameters<typeof form.patch>[0] = {};
      if (isUpcomingIsoDate(s.pickupDate) && isUpcomingIsoDate(s.dropoffDate) && s.dropoffDate >= s.pickupDate) {
        patch.pickupDate = s.pickupDate;
        patch.dropoffDate = s.dropoffDate;
        const pickupTime = text(s.pickupTime);
        const dropoffTime = text(s.dropoffTime);
        if (pickupTime) patch.pickupTime = pickupTime;
        if (dropoffTime) patch.dropoffTime = dropoffTime;
      }
      const name = text(s.customerName);
      const email = text(s.customerEmail);
      const phone = text(s.customerPhone);
      if (name) patch.customerName = name;
      if (email) patch.customerEmail = email;
      if (phone) patch.customerPhone = phone;
      const address = text(s.pickupLocation);
      if (address && useBookingStore.getState().pickupAddress === "") patch.pickupAddress = address;
      if (Object.keys(patch).length > 0) form.patch(patch);
    });
    return () => {
      cancelled = true;
    };
    // `form` is a fresh object on every store write (see the seeding above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, tenant?.id, vehicleId]);

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

  const quoteVehicle = useMemo<QuoteVehicle | null>(
    () => (vehicle ? toQuoteVehicle(vehicle) : null),
    [vehicle],
  );

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

  /* ── abandoned-booking tracking ───────────────────────────────────────────
   * Reports how far the renter got (debounced, fire-and-forget) so Drive 247
   * can follow up if they leave halfway. See lib/abandoned-booking-tracker.ts.
   */
  const trackedRentalId =
    booking.state.status === "ready" ? booking.state.booking.rentalId : null;
  useEffect(() => {
    if (!hydrated || !tenant?.id || !vehicle) return;
    const stage: BookingStage =
      paidHandoff !== null
        ? "completed"
        : paymentOpen
          ? "payment"
          : trackedRentalId !== null
            ? "checkout"
            : form.customerEmail.trim() !== ""
              ? "details"
              : "vehicle";
    const timer = window.setTimeout(() => {
      trackBookingProgress({
        tenantId: tenant.id,
        site: "v2",
        stage,
        vehicleId: vehicle.id,
        vehicleName: vehicle.displayName,
        pickupDate: form.pickupDate || null,
        pickupTime: form.pickupTime || null,
        dropoffDate: form.dropoffDate || null,
        dropoffTime: form.dropoffTime || null,
        pickupLocation: form.pickupAddress || null,
        customerName: form.customerName || null,
        customerEmail: form.customerEmail || null,
        customerPhone: form.customerPhone || null,
        rentalId: paidHandoff?.rentalId ?? trackedRentalId,
      });
    }, stage === "completed" ? 0 : 1500);
    return () => window.clearTimeout(timer);
  }, [
    hydrated,
    tenant?.id,
    vehicle,
    paidHandoff,
    paymentOpen,
    trackedRentalId,
    form.customerEmail,
    form.customerName,
    form.customerPhone,
    form.pickupDate,
    form.pickupTime,
    form.dropoffDate,
    form.dropoffTime,
    form.pickupAddress,
  ]);

  /* ── what the page renders from ───────────────────────────────────────────
   * Plain objects built per render, exactly as the page built them inline. The
   * prop bundles exist so both pages hand the form, the bill and the payment
   * dialog the SAME inputs; they are only meaningful once `vehicle` is loaded,
   * which is the only time either page renders them.
   */
  const checkout: CheckoutState = {
    quote,
    collectPaymentUpfront: rules.collectPaymentUpfront,
    onCheckout: handleCheckout,
    block: checkoutBlock,
    checkoutNotice: checkoutMessage,
  };

  const priceBlockProps = {
    quote,
    quoteLoading,
    collectPaymentUpfront: rules.collectPaymentUpfront,
    promoCode: promo.promo?.code ?? null,
    pricingRulesDegraded,
    vehicleIsPaused: vehicle?.isPaused ?? false,
  };

  const formProps = {
    rules,
    modes,
    pickupLocations,
    returnLocations,
    extras,
    quote,
    errorFor,
    isPickupDateDisabled,
    isReturnDateDisabled,
    areaFeeHint,
    areaFeePending,
    promo,
    rentalDays: validation.rentalDays,
  };

  const paymentPanelProps = {
    open: paymentOpen,
    onOpenChange: handlePaymentOpenChange,
    request: paymentRequest,
    amountLabel: formatCurrency(quote.payableNow),
    vehicleLabel: vehicle?.displayName ?? "",
    resume: paymentReturn,
    onSucceeded: handlePaymentSucceeded,
  };

  return {
    /* load states */
    hydrated,
    tenant,
    tenantLoading,
    tenantError,
    vehicle,
    vehicleLoading,
    notFound,
    isError,
    refetch,
    /* the booking */
    form,
    rules,
    modes,
    mode,
    quote,
    quoteLoading,
    pricingRulesDegraded,
    promo,
    validation,
    formatCurrency,
    /* after payment */
    paidHandoff,
    paymentOpen,
    /* ready-made bundles */
    checkout,
    priceBlockProps,
    formProps,
    paymentPanelProps,
    handleFormBlur,
  };
}

export type VehicleBooking = ReturnType<typeof useVehicleBooking>;

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
