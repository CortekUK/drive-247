/**
 * The booking form's decisions, with none of its markup.
 *
 * Extracted verbatim from `booking-form.tsx` so the v1 form and the v2 one
 * (`northwind-site/site-v2/booking/booking-form.tsx`) decide which legs are
 * required, which return control appears, what the date caption says and how an
 * extra's stock is described in ONE place. v1 renders exactly what it did.
 */

import type { QuoteResult } from "@nw/lib/quote/types";
import type { BookingStore, DeliveryOption } from "@nw/lib/stores/booking-store";
import type { PickupLocation, RentalExtra } from "@nw/lib/vehicles/types";

import type { BookingRules, DeliveryModeAvailability } from "./booking-rules";
import {
  formatClockLabel,
  formatDuration,
  formatIsoDateLabel,
} from "./time-utils";

/**
 * Which legs of the journey the validator will actually insist on.
 *
 * This is the one place in the form where "required" is not a constant: the
 * validator asks for a location, an address, or nothing at all, depending on
 * the delivery mode and on whether the tenant configured a fixed address. A
 * static asterisk would therefore be a lie in two of the three modes.
 *
 * The branches below mirror `validateBooking` §2 — same inputs, same order,
 * same conditions — so the marker cannot drift away from the rule it is
 * advertising. Anything that changes there has to change here to stay honest.
 *
 * The asymmetry in the fallthrough is real, not a slip in the mirror: in
 * 'fixed' mode the validator requires a PICKUP address when the tenant has
 * none configured (validation.ts:189), but it never requires the return
 * address on that path. That field is genuinely optional, and is labelled so.
 */
export function requiredLegs(
  mode: DeliveryOption,
  sameAsPickup: boolean,
  fixedPickupAddress: string | null,
): { pickup: boolean; return: boolean } {
  if (mode === "location" || mode === "area") {
    return { pickup: true, return: !sameAsPickup };
  }
  return { pickup: fixedPickupAddress === null, return: false };
}

/** The slice of the booking store the form's decisions read. */
type FormSlice = Pick<
  BookingStore,
  "deliveryOption" | "sameAsPickup" | "pickupDate" | "dropoffDate"
>;

/**
 * Everything the form derives before it renders a field: the effective mode,
 * the required legs, whether a separate return leg can be chosen, the return
 * placeholder, the one-line date caption, and whether the Options section shows.
 */
export function deriveBookingFormModel({
  form,
  rules,
  modes,
  quote,
  rentalDays,
}: {
  form: FormSlice;
  rules: BookingRules;
  modes: DeliveryModeAvailability;
  quote: QuoteResult;
  rentalDays: number | null;
}) {
  const mode: DeliveryOption = form.deliveryOption ?? modes.enabled[0] ?? "fixed";

  const required = requiredLegs(mode, form.sameAsPickup, rules.fixedPickupAddress);

  const returnAddressFallback = rules.fixedReturnAddress ?? rules.fixedPickupAddress;
  const canChooseReturnLeg = (returnLocationCount: number) =>
    mode === "fixed"
      ? rules.fixedPickupAddress === null
      : returnLocationCount > 0 || mode === "area";

  /*
    Two captions, one line. They were two stacked paragraphs; each cost a row of
    a page whose whole complaint was its height, and neither is a sentence the
    customer reads twice.
  */
  const dateCaptions: string[] = [];
  if (rentalDays !== null && form.pickupDate !== "" && form.dropoffDate !== "") {
    dateCaptions.push(
      `${formatDuration(rentalDays, rules.monthlyTierDays)} · ${formatIsoDateLabel(form.pickupDate)} → ${formatIsoDateLabel(form.dropoffDate)}`,
    );
  }
  if (rules.workingHours) {
    dateCaptions.push(
      `Collection and return between ${formatClockLabel(rules.workingHours.open)} and ${formatClockLabel(rules.workingHours.close)}`,
    );
  }

  const showOptions = quote.unlimitedMileage.available || rules.installmentsEnabled;

  return {
    mode,
    required,
    returnAddressFallback,
    canChooseReturnLeg,
    dateCaptions,
    showOptions,
  };
}

/**
 * The fixed-address panel's second line: the return address, only when it is a
 * different place from the pickup.
 */
export function fixedReturnSecondary(rules: BookingRules): string | null {
  return rules.fixedReturnAddress &&
    rules.fixedReturnAddress !== rules.fixedPickupAddress
    ? rules.fixedReturnAddress
    : null;
}

/**
 * The store writes for a new pickup date.
 *
 * A return that is now before the pickup is not a choice the customer made —
 * clear it rather than leaving it illegal.
 */
export function applyPickupDate(
  form: Pick<BookingStore, "dropoffDate" | "set">,
  iso: string,
): void {
  form.set("pickupDate", iso);
  if (form.dropoffDate !== "" && form.dropoffDate < iso) {
    form.set("dropoffDate", "");
  }
}

/** "SUMMER10 applied — 10% off the rental." The discount half of that line. */
export function describePromoDiscount(
  promo: { type: string; value: number },
  formatCurrency: (amount: number) => string,
): string {
  return promo.type === "percentage"
    ? `${promo.value}% off`
    : `${formatCurrency(promo.value)} off`;
}

/** One location's option label: "Airport · +$25.00" or "Depot · Free". */
export function describeLocationOption(
  location: PickupLocation,
  formatCurrency: (amount: number) => string,
): string {
  return `${location.name} · ${
    location.deliveryFee > 0 ? `+${formatCurrency(location.deliveryFee)}` : "Free"
  }`;
}

/** How an extra tile reads: its cap, whether it is sold out, and the stock note. */
export function describeExtra(extra: RentalExtra, quantity: number) {
  const cap = extra.bookableQuantity;
  const soldOut = cap !== null && cap <= 0;
  const shown = Math.min(quantity, cap ?? quantity);
  const image = extra.imageUrls[0];

  const stock = soldOut
    ? " · Unavailable for these dates"
    : cap !== null && cap <= 3
      ? ` · ${cap} left`
      : "";

  const billing = extra.billingType === "per_day" ? " per day" : " per rental";

  return { cap, soldOut, shown, image, stock, billing };
}
