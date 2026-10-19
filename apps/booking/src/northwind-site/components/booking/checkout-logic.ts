/**
 * What the checkout says, with none of how it looks.
 *
 * Extracted verbatim from `booking-checkout.tsx` so the v1 checkout and the v2
 * one (`northwind-site/site-v2/booking/booking-checkout.tsx`) share one
 * `describeOutstanding` and one `CheckoutState` contract. `booking-checkout.tsx`
 * re-exports every name here, so no importer had to move.
 */

import type { QuoteResult } from "@nw/lib/quote/types";

import type { BookingErrors, BookingField } from "./validation";

/**
 * Why the button is dead, and whose problem it is.
 *
 * The two kinds are NOT interchangeable and must never share a sentence. A
 * `blocked` reason is ours — a paused vehicle, an undeliverable address,
 * pricing we could not load — and no amount of typing will clear it. An
 * `incomplete` reason is the customer's, is fixable in seconds, and names the
 * fields that are outstanding so a greyed-out button is never a dead end.
 */
export type CheckoutBlock = {
  kind: "blocked" | "incomplete";
  /** Rendered verbatim beneath the button. */
  message: string;
};

export interface CheckoutState {
  quote: QuoteResult;
  /** Enquiry tenants are quoted a value but charged nothing here. */
  collectPaymentUpfront: boolean;
  onCheckout: () => void;
  /** Null when the button is live. Anything else greys it out and says why. */
  block: CheckoutBlock | null;
  /** Transient word from the last attempt. Outlives nothing. */
  checkoutNotice: string | null;
}

/* ─────────────────── naming what is still outstanding ────────────────────── */

/**
 * What is missing, in the customer's words.
 *
 * The driver's four fields are named WITHOUT the possessive so they can share
 * one — "your name, email, phone number and date of birth" rather than four
 * separate "your"s, which is what the same list sounds like read aloud. The two
 * location questions carry their own wording because they are not possessions.
 */
const PERSON_LABELS: ReadonlyArray<readonly [BookingField, string]> = [
  ["customerName", "name"],
  ["customerEmail", "email"],
  ["customerPhone", "phone number"],
  ["driverDOB", "date of birth"],
];

const PLACE_LABELS: ReadonlyArray<readonly [BookingField, string]> = [
  ["pickupLocation", "where you will collect the car"],
  ["returnLocation", "where you will return it"],
];

const DATE_FIELDS: readonly BookingField[] = [
  "pickupDate",
  "pickupTime",
  "dropoffDate",
  "dropoffTime",
];

/** "a", "a and b", "a, b and c" — no serial comma, matching the rest of the copy. */
function joinPhrases(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function labelsFor(
  errors: BookingErrors,
  table: ReadonlyArray<readonly [BookingField, string]>,
): string[] {
  return table.filter(([field]) => errors[field] !== undefined).map(([, label]) => label);
}

/**
 * Turn a live validation result into one short line.
 *
 * Built from the SAME `BookingErrors` the fields render, so it can never drift
 * from what is actually blocking submission — and returns null the instant the
 * form is complete, which is also the instant the button goes live.
 *
 * Date problems get a pointer rather than a name: they are already on screen in
 * red (dates are the one group shown before any submit), and repeating
 * "Minimum rental period is 2 days" under the button says it twice.
 */
export function describeOutstanding(errors: BookingErrors): string | null {
  const clauses: string[] = [];

  if (DATE_FIELDS.some((field) => errors[field] !== undefined)) {
    clauses.push("check the dates above");
  }

  const places = labelsFor(errors, PLACE_LABELS);
  const people = labelsFor(errors, PERSON_LABELS);
  const details = people.length > 0 ? [...places, `your ${joinPhrases(people)}`] : places;
  if (details.length > 0) {
    clauses.push(`add ${joinPhrases(details)}`);
  }

  const needsTerms = errors.agreeTerms !== undefined;
  const needsCharges = errors.agreeCharges !== undefined;
  if (needsTerms && needsCharges) {
    clauses.push("tick both consent boxes below");
  } else if (needsTerms) {
    clauses.push("accept the rental terms");
  } else if (needsCharges) {
    clauses.push("authorise post-rental charges");
  }

  if (clauses.length === 0) return null;

  // One thing outstanding reads as an instruction and takes "to continue".
  // Several read as a short checklist, where a trailing "to continue" after a
  // list that already contains two "and"s is one conjunction too many — the
  // last step gets "then" instead, which is what a person would say.
  const sentence =
    clauses.length === 1
      ? `${clauses[0]} to continue`
      : `${clauses.slice(0, -1).join(", ")}, then ${clauses[clauses.length - 1]}`;

  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

/** The two DOM ids the reason line uses — one per copy, only one ever displayed. */
export const DESKTOP_REASON_ID = "checkout-reason-desktop";
export const MOBILE_REASON_ID = "checkout-reason-mobile";
