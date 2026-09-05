/**
 * Everything that can stop a booking, decided in one pure function.
 *
 * Pure so the same rules can run again on the server when the payment
 * workstream lands. Nothing here reads the store, the network or the clock
 * except through its arguments — `now` is passed in for exactly that reason.
 */

import { calendarDaysBetween } from "@/lib/domain";
import type { BookingFormState } from "@/lib/stores/booking-store";
import type { UnavailableReason, Vehicle } from "@/lib/vehicles/types";

import type { BookingRules, DeliveryModeAvailability } from "./booking-rules";
import {
  calculateAgeYears,
  formatHourSpan,
  hoursBetween,
  isClockTime,
  isIsoDate,
  zonedWallClockToInstant,
} from "./time-utils";

export type BookingField =
  | "pickupDate"
  | "pickupTime"
  | "dropoffDate"
  | "dropoffTime"
  | "pickupLocation"
  | "returnLocation"
  | "customerName"
  | "customerEmail"
  | "customerPhone"
  | "driverDOB"
  | "agreeTerms"
  | "agreeCharges";

export type BookingErrors = Partial<Record<BookingField, string>>;

export interface BookingValidationInput {
  form: BookingFormState;
  rules: BookingRules;
  modes: DeliveryModeAvailability;
  vehicle: Vehicle | null;
  /** From `useVehicleBookedDates`. Returns true when every day in the range is free. */
  isRangeAvailable: (startDate: string, endDate: string) => boolean;
  /** Why the vehicle is spoken for, when it is. Rendered verbatim if present. */
  unavailableReason?: UnavailableReason | null;
  now: Date;
}

export interface BookingValidation {
  errors: BookingErrors;
  /** Billable calendar days, or null before both dates are chosen. */
  rentalDays: number | null;
  /** Elapsed hours across the booking, or null before both date+time pairs are. */
  durationHours: number | null;
  /** True when the range is complete and legal — the quote may be trusted. */
  datesUsable: boolean;
  /** Every field that must be filled in is, and both consents are ticked. */
  isComplete: boolean;
}

/**
 * Deliberately permissive. A stricter pattern rejects real addresses
 * (apostrophes, plus-addressing, new TLDs) and the only thing that actually
 * proves an address is sending to it.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Enough digits to be a phone number in any plan, ignoring formatting. */
function looksLikePhone(raw: string): boolean {
  return raw.replace(/\D/g, "").length >= 7;
}

const UNAVAILABLE_COPY: Record<UnavailableReason, string> = {
  rented: "This vehicle is already booked for part of those dates.",
  blocked: "This vehicle is unavailable for part of those dates.",
  tenant_blocked: "We are not taking bookings across part of those dates.",
  buffer: "This vehicle is being turned around across part of those dates.",
};

export function validateBooking(input: BookingValidationInput): BookingValidation {
  const { form, rules, modes, vehicle, isRangeAvailable, now } = input;
  const errors: BookingErrors = {};

  /* ── 1. dates and times ─────────────────────────────────────────────── */

  if (!isIsoDate(form.pickupDate)) errors.pickupDate = "Choose a pickup date.";
  if (!isClockTime(form.pickupTime)) errors.pickupTime = "Choose a pickup time.";
  if (!isIsoDate(form.dropoffDate)) errors.dropoffDate = "Choose a return date.";
  if (!isClockTime(form.dropoffTime)) errors.dropoffTime = "Choose a return time.";

  const hasRange = isIsoDate(form.pickupDate) && isIsoDate(form.dropoffDate);
  const rentalDays = hasRange
    ? calendarDaysBetween(form.pickupDate, form.dropoffDate)
    : null;

  const pickupInstant =
    isIsoDate(form.pickupDate) && isClockTime(form.pickupTime)
      ? zonedWallClockToInstant(form.pickupDate, form.pickupTime, rules.operatorTimezone)
      : null;
  const dropoffInstant =
    isIsoDate(form.dropoffDate) && isClockTime(form.dropoffTime)
      ? zonedWallClockToInstant(form.dropoffDate, form.dropoffTime, rules.operatorTimezone)
      : null;

  const durationHours =
    pickupInstant && dropoffInstant ? hoursBetween(pickupInstant, dropoffInstant) : null;

  if (hasRange && form.dropoffDate < form.pickupDate) {
    errors.dropoffDate = "The return date cannot be before the pickup date.";
  } else if (durationHours !== null && durationHours <= 0) {
    errors.dropoffTime = "The return must be after the pickup.";
  } else {
    if (durationHours !== null && durationHours < rules.minRentalHours) {
      errors.dropoffDate = `Minimum rental period is ${formatHourSpan(rules.minRentalHours)}.`;
    } else if (rentalDays !== null && rentalDays > rules.maxRentalDays) {
      errors.dropoffDate = `Maximum rental period is ${rules.maxRentalDays} day${
        rules.maxRentalDays === 1 ? "" : "s"
      }.`;
    }
  }

  // Lead time is judged in the OPERATOR's zone, because "24 hours' notice" is a
  // promise about their staffing, not about where the customer is sitting.
  if (!errors.pickupDate && pickupInstant && rules.leadTimeHours > 0) {
    const hoursUntilPickup =
      (pickupInstant.getTime() - now.getTime()) / (1000 * 60 * 60);
    if (hoursUntilPickup < rules.leadTimeHours) {
      const notice =
        rules.leadTimeHours >= 24 && rules.leadTimeHours % 24 === 0
          ? `${rules.leadTimeHours / 24} day${rules.leadTimeHours === 24 ? "" : "s"}`
          : `${rules.leadTimeHours} hour${rules.leadTimeHours === 1 ? "" : "s"}`;
      errors.pickupDate = `Bookings must be made at least ${notice} in advance.`;
    }
  }

  // Occupancy last: a range that is already illegal for other reasons should say
  // so first, rather than blaming another customer's rental.
  if (
    !errors.pickupDate &&
    !errors.dropoffDate &&
    hasRange &&
    !isRangeAvailable(form.pickupDate, form.dropoffDate)
  ) {
    errors.dropoffDate = input.unavailableReason
      ? UNAVAILABLE_COPY[input.unavailableReason]
      : UNAVAILABLE_COPY.rented;
  }

  // The operator can switch a vehicle off for a whole duration tier.
  if (!errors.dropoffDate && rentalDays !== null && vehicle) {
    const tierAvailable =
      rentalDays >= rules.monthlyTierDays
        ? vehicle.availableMonthly
        : rentalDays >= 7
          ? vehicle.availableWeekly
          : vehicle.availableDaily;
    if (!tierAvailable) {
      errors.dropoffDate = "This vehicle is not offered for a rental of that length.";
    }
  }

  const datesUsable =
    hasRange &&
    !errors.pickupDate &&
    !errors.pickupTime &&
    !errors.dropoffDate &&
    !errors.dropoffTime;

  /* ── 2. pickup and return ───────────────────────────────────────────── */

  const mode = form.deliveryOption ?? modes.enabled[0] ?? "fixed";

  if (mode === "location") {
    if (!form.pickupLocationId) {
      errors.pickupLocation = "Choose where you will collect the vehicle.";
    }
    if (!form.sameAsPickup && !form.returnLocationId) {
      errors.returnLocation = "Choose where you will return the vehicle.";
    }
  } else if (mode === "area") {
    if (form.pickupAddress.trim() === "") {
      errors.pickupLocation = "Enter the address to deliver to.";
    }
    if (!form.sameAsPickup && form.returnAddress.trim() === "") {
      errors.returnLocation = "Enter the address to collect from.";
    }
  } else if (!rules.fixedPickupAddress && form.pickupAddress.trim() === "") {
    // 'fixed' with no address on the tenant: v1 falls back to asking the
    // customer where they will meet, rather than showing an empty panel.
    errors.pickupLocation = "Enter the pickup address.";
  }

  /* ── 3. the driver ──────────────────────────────────────────────────── */

  if (form.customerName.trim() === "") {
    errors.customerName = "Enter your full name.";
  }
  if (form.customerEmail.trim() === "") {
    errors.customerEmail = "Enter your email address.";
  } else if (!EMAIL_PATTERN.test(form.customerEmail.trim())) {
    errors.customerEmail = "That does not look like an email address.";
  }
  if (form.customerPhone.trim() === "") {
    errors.customerPhone = "Enter your phone number.";
  } else if (!looksLikePhone(form.customerPhone)) {
    errors.customerPhone = "Enter a phone number we can reach you on.";
  }

  if (form.driverDOB.trim() === "") {
    errors.driverDOB = "Enter your date of birth.";
  } else {
    const age = calculateAgeYears(form.driverDOB);
    if (age === null || age < 0 || age > 120) {
      errors.driverDOB = "Enter a valid date of birth.";
    } else if (age < rules.minimumAge) {
      errors.driverDOB = `You must be at least ${rules.minimumAge} to rent this vehicle.`;
    }
  }

  /* ── 4. consent — BOTH are required ─────────────────────────────────── */

  if (!form.agreeTerms) {
    errors.agreeTerms = "Please accept the rental terms.";
  }
  if (!form.agreeCharges) {
    errors.agreeCharges = "Please authorise post-rental charges.";
  }

  return {
    errors,
    rentalDays,
    durationHours,
    datesUsable,
    isComplete: Object.keys(errors).length === 0,
  };
}
