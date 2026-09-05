"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist, type PersistOptions } from "zustand/middleware";

/**
 * The customer's in-progress booking for ONE vehicle.
 *
 * This replaced an 85-line wizard store. There are no steps any more: v2's flow
 * is a single vehicle page with a sidebar, so `step` / `next` / `prev` had no
 * meaning left and every consumer of them is gone.
 *
 * Three deliberate shape changes carried over from that rewrite:
 *
 *  1. DATES ARE 'YYYY-MM-DD' STRINGS, not `Date`. The pricing engine
 *     (`calculateRentalPriceBreakdown`) and every `date` column in Postgres are
 *     date-only. A `Date` here would be a local-midnight instant that shifts a
 *     day either side of UTC the moment it is serialised — which is exactly the
 *     bug `parseDateString` exists to avoid. Times are separate 'HH:mm' fields.
 *
 *  2. `selectedExtras` IS `Record<string, number>`. v1's store declares it
 *     `string[]` while every consumer reads and writes it as an id->quantity
 *     record; that lie only survives because apps/booking sets
 *     `ignoreBuildErrors: true`. v2 is `strict: true`, so it is modelled as what
 *     it actually is.
 *
 *  3. `driverDOB` REPLACED `driverAge`. The old field held a range string
 *     ("25-30"), which cannot be validated against `tenants.minimum_rental_age`
 *     — a real date can.
 *
 * Verification and insurance fields (`licenseFileName`, `insurance`,
 * `insuranceFileName`) are GONE on purpose: in the new flow those are collected
 * after payment, so holding them here would model a step that no longer exists.
 */

/** The three pickup/return arrangements a tenant can enable. */
export type DeliveryOption = "fixed" | "location" | "area";

export interface BookingFormState {
  /** The vehicle being booked. Set from the route, not chosen in a wizard. */
  vehicleId: string | null;

  // ── When ───────────────────────────────────────────────────────────────
  /** 'YYYY-MM-DD'. Empty string means "not chosen yet". */
  pickupDate: string;
  /** 'HH:mm', 24-hour. */
  pickupTime: string;
  /** 'YYYY-MM-DD'. */
  dropoffDate: string;
  /** 'HH:mm', 24-hour. */
  dropoffTime: string;

  // ── Where ──────────────────────────────────────────────────────────────
  /**
   * Which arrangement the customer picked. Null until the page resolves the
   * tenant's enabled modes — a tenant with exactly one enabled mode has it
   * selected for them rather than being asked.
   */
  deliveryOption: DeliveryOption | null;
  /** `pickup_locations.id` when `deliveryOption === 'location'`. */
  pickupLocationId: string | null;
  /** `pickup_locations.id` for the return leg. */
  returnLocationId: string | null;
  /** Free-text address: the operator's own in 'fixed', the customer's in 'area'. */
  pickupAddress: string;
  returnAddress: string;
  /** Return happens wherever pickup did — the common case, so it defaults on. */
  sameAsPickup: boolean;
  /**
   * The fee each leg contributed, mirrored out of the live quote. Held here so
   * a later checkout step can post what the customer was actually shown rather
   * than recomputing it and risking a different answer.
   */
  pickupDeliveryFee: number;
  returnDeliveryFee: number;

  // ── Who ────────────────────────────────────────────────────────────────
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  /** 'YYYY-MM-DD'. Validated against `tenants.minimum_rental_age`. */
  driverDOB: string;
  /**
   * IANA zone the customer is sitting in, e.g. 'Europe/London'. Lead-time is
   * judged against the OPERATOR's zone; recording the customer's makes a
   * server-side re-check reproducible instead of guessing.
   */
  customerTimezone: string;

  // ── Options ────────────────────────────────────────────────────────────
  /** What the customer typed. The APPLIED promo lives in the page, not here. */
  promoCode: string;
  /** extraId -> quantity. Absent id or 0 both mean "not selected". */
  selectedExtras: Record<string, number>;
  addUnlimitedMileage: boolean;
  /**
   * The customer ASKS to pay in installments; an admin builds the plan
   * afterwards. There is deliberately no plan selector in the customer flow.
   */
  wantsInstallments: boolean;

  // ── Consent ────────────────────────────────────────────────────────────
  /** Rental terms & conditions. */
  agreeTerms: boolean;
  /**
   * Authorisation for post-rental charges (fuel, mileage excess, damage).
   * SEPARATE from `agreeTerms` and equally required — v1 gates its pay button
   * on `agreeTerms && agreeCharges` (BookingCheckoutStep.tsx:1570).
   */
  agreeCharges: boolean;
  /** Only ever collected when the tenant has Twilio SMS switched on. */
  smsConsent: boolean;
}

export interface BookingActions {
  set: <K extends keyof BookingFormState>(
    key: K,
    value: BookingFormState[K],
  ) => void;
  patch: (values: Partial<BookingFormState>) => void;
  /** Sets one extra's quantity. A quantity of 0 or less removes the key. */
  setExtraQuantity: (extraId: string, quantity: number) => void;
  /**
   * Point the store at a vehicle. Switching to a DIFFERENT vehicle drops the
   * extras and the mileage upgrade, because both are priced per vehicle and
   * carrying them across would show a total the new car cannot honour.
   */
  startVehicle: (vehicleId: string) => void;
  reset: () => void;
}

export type BookingStore = BookingFormState & BookingActions;

const INITIAL: BookingFormState = {
  vehicleId: null,

  pickupDate: "",
  pickupTime: "",
  dropoffDate: "",
  dropoffTime: "",

  deliveryOption: null,
  pickupLocationId: null,
  returnLocationId: null,
  pickupAddress: "",
  returnAddress: "",
  sameAsPickup: true,
  pickupDeliveryFee: 0,
  returnDeliveryFee: 0,

  customerName: "",
  customerEmail: "",
  customerPhone: "",
  driverDOB: "",
  customerTimezone: "",

  promoCode: "",
  selectedExtras: {},
  addUnlimitedMileage: false,
  wantsInstallments: false,

  agreeTerms: false,
  agreeCharges: false,
  smsConsent: false,
};

/* ─────────────────────────── persisted-state hygiene ─────────────────────
 * localStorage is writable by anything running on the origin, so what comes
 * back is `unknown` and is treated that way. A malformed blob must not be able
 * to put a string into `pickupDeliveryFee` (which would concatenate into a
 * total) or a non-numeric quantity into `selectedExtras` (which would poison
 * the extras line). Anything that fails a check falls back to INITIAL.
 */

const str = (raw: unknown, fallback: string): string =>
  typeof raw === "string" ? raw : fallback;

const bool = (raw: unknown, fallback: boolean): boolean =>
  typeof raw === "boolean" ? raw : fallback;

const nullableStr = (raw: unknown): string | null =>
  typeof raw === "string" && raw !== "" ? raw : null;

const money = (raw: unknown): number =>
  typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : 0;

const deliveryOption = (raw: unknown): DeliveryOption | null =>
  raw === "fixed" || raw === "location" || raw === "area" ? raw : null;

function extrasRecord(raw: unknown): Record<string, number> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [id, value] of Object.entries(raw)) {
    const qty = typeof value === "number" ? Math.floor(value) : Number.NaN;
    if (Number.isFinite(qty) && qty > 0) out[id] = qty;
  }
  return out;
}

function toFormState(raw: unknown): BookingFormState {
  if (typeof raw !== "object" || raw === null) return { ...INITIAL };
  const p = raw as Record<string, unknown>;
  return {
    vehicleId: nullableStr(p.vehicleId),

    pickupDate: str(p.pickupDate, ""),
    pickupTime: str(p.pickupTime, ""),
    dropoffDate: str(p.dropoffDate, ""),
    dropoffTime: str(p.dropoffTime, ""),

    deliveryOption: deliveryOption(p.deliveryOption),
    pickupLocationId: nullableStr(p.pickupLocationId),
    returnLocationId: nullableStr(p.returnLocationId),
    pickupAddress: str(p.pickupAddress, ""),
    returnAddress: str(p.returnAddress, ""),
    sameAsPickup: bool(p.sameAsPickup, true),
    pickupDeliveryFee: money(p.pickupDeliveryFee),
    returnDeliveryFee: money(p.returnDeliveryFee),

    customerName: str(p.customerName, ""),
    customerEmail: str(p.customerEmail, ""),
    customerPhone: str(p.customerPhone, ""),
    driverDOB: str(p.driverDOB, ""),
    customerTimezone: str(p.customerTimezone, ""),

    promoCode: str(p.promoCode, ""),
    selectedExtras: extrasRecord(p.selectedExtras),
    addUnlimitedMileage: bool(p.addUnlimitedMileage, false),
    wantsInstallments: bool(p.wantsInstallments, false),

    // Consent is NEVER persisted and NEVER restored. A tick that survives a
    // reload is a tick nobody made in this session, and these are the record
    // that the customer agreed to the terms and to post-rental charges.
    agreeTerms: false,
    agreeCharges: false,
    smsConsent: false,
  };
}

function pickFormState(state: BookingStore): BookingFormState {
  return {
    vehicleId: state.vehicleId,
    pickupDate: state.pickupDate,
    pickupTime: state.pickupTime,
    dropoffDate: state.dropoffDate,
    dropoffTime: state.dropoffTime,
    deliveryOption: state.deliveryOption,
    pickupLocationId: state.pickupLocationId,
    returnLocationId: state.returnLocationId,
    pickupAddress: state.pickupAddress,
    returnAddress: state.returnAddress,
    sameAsPickup: state.sameAsPickup,
    pickupDeliveryFee: state.pickupDeliveryFee,
    returnDeliveryFee: state.returnDeliveryFee,
    customerName: state.customerName,
    customerEmail: state.customerEmail,
    customerPhone: state.customerPhone,
    driverDOB: state.driverDOB,
    customerTimezone: state.customerTimezone,
    promoCode: state.promoCode,
    selectedExtras: state.selectedExtras,
    addUnlimitedMileage: state.addUnlimitedMileage,
    wantsInstallments: state.wantsInstallments,
    // Consent is not written either — see `toFormState`. Keeping a stale
    // "agreed" flag in a store we then refuse to trust is a record of consent
    // nobody gave, sitting in a place anything on the origin can read.
    agreeTerms: false,
    agreeCharges: false,
    smsConsent: false,
  };
}

const persistOptions: PersistOptions<BookingStore, BookingFormState> = {
  name: "drive247-v2-booking",
  version: 1,
  // `createJSONStorage` swallows a throwing getter and returns undefined, so
  // this is safe during server rendering where `localStorage` does not exist.
  storage: createJSONStorage(() => localStorage),
  /**
   * Hydration is deferred to `useHydrateBookingStore` rather than running while
   * the store module evaluates. Rehydrating eagerly would give the first client
   * render different values from the server HTML for every persisted field, and
   * React would discard the tree with a hydration mismatch.
   */
  skipHydration: true,
  partialize: pickFormState,
  merge: (persisted, current) => ({ ...current, ...toFormState(persisted) }),
};

export const useBookingStore = create<BookingStore>()(
  persist(
    (set) => ({
      ...INITIAL,

      set: (key, value) =>
        set(() => ({ [key]: value }) as Pick<BookingFormState, typeof key>),

      patch: (values) => set(() => values),

      setExtraQuantity: (extraId, quantity) =>
        set((state) => {
          const next = { ...state.selectedExtras };
          const qty = Math.floor(quantity);
          if (!Number.isFinite(qty) || qty <= 0) delete next[extraId];
          else next[extraId] = qty;
          return { selectedExtras: next };
        }),

      startVehicle: (vehicleId) =>
        set((state) =>
          state.vehicleId === vehicleId
            ? { vehicleId }
            : {
                vehicleId,
                selectedExtras: {},
                addUnlimitedMileage: false,
                // Both consents are a statement about a specific booking, so a
                // change of car withdraws them.
                agreeTerms: false,
                agreeCharges: false,
              },
        ),

      reset: () => set({ ...INITIAL }),
    }),
    persistOptions,
  ),
);

/**
 * Run the deferred rehydration, and report when it is done.
 *
 * Returns false on the server and on the first client render — which is what
 * makes the two agree — then true once the persisted booking is back in the
 * store. Gate anything that renders a persisted value on this.
 */
export function useHydrateBookingStore(): boolean {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const unsubscribe = useBookingStore.persist.onFinishHydration(() => {
      setHydrated(true);
    });
    void useBookingStore.persist.rehydrate();
    // Sync storage finishes inside `rehydrate()`, i.e. BEFORE the subscription
    // above can fire on some paths. Asking directly covers that ordering.
    if (useBookingStore.persist.hasHydrated()) setHydrated(true);
    return unsubscribe;
  }, []);

  return hydrated;
}
