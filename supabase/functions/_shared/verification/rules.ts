// feat-003 driver verification: the one place the standard check's own rules live (spec 07.31).
// Pure: the only import is the shared secondary-driver name rule, which is pure too.
// Dates are ISO "YYYY-MM-DD" strings, compared in UTC (spec 07.15, 07.16).

import { driverNameMatchesDocument } from "../secondary-driver-rules.ts";

export type LineResult = "pass" | "fail" | "could_not_check" | "not_set";

export interface Line {
  check: string;
  result: LineResult;
  reason: string | null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function isIso(value: string | null | undefined): value is string {
  return !!value && ISO.test(value);
}

/** Whole years between a date of birth and a day. A 29 Feb birthday counts from 1 Mar in other years. */
export function ageOn(dob: string, day: string): number {
  const [by, bm, bd] = dob.split("-").map(Number);
  const [y, m, d] = day.split("-").map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return age;
}

/** Line 6, old enough (spec 07.16). */
export function oldEnoughLine(dob: string | null | undefined, minimumAge: number | null | undefined, today: string): Line {
  if (minimumAge === null || minimumAge === undefined) {
    return { check: "old_enough", result: "not_set", reason: "Set your minimum rental age in Settings, Rental rules" };
  }
  if (!isIso(dob)) return { check: "old_enough", result: "could_not_check", reason: "The date of birth could not be read" };
  return ageOn(dob, today) >= minimumAge
    ? { check: "old_enough", result: "pass", reason: null }
    : { check: "old_enough", result: "fail", reason: `Under your minimum age of ${minimumAge}` };
}

/** Line 5, not expired, against today (spec 07.15). */
export function notExpiredLine(expiry: string | null | undefined, today: string): Line {
  if (!isIso(expiry)) return { check: "not_expired", result: "could_not_check", reason: "The expiry date could not be read" };
  return expiry >= today
    ? { check: "not_expired", result: "pass", reason: null }
    : { check: "not_expired", result: "fail", reason: "The licence is out of date" };
}

export { licenceValidThrough } from "./expiry.ts";

/** Line 7, name matches (spec 07.17), reusing the secondary-driver rule. */
export function nameLine(customerName: string, first: string | null | undefined, last: string | null | undefined): Line {
  // No name read is a check we could not make, never a fail or a pass (spec 07.23).
  if (!`${first ?? ""}${last ?? ""}`.trim()) return { check: "name_matches", result: "could_not_check", reason: "The name on the licence could not be read" };
  if (driverNameMatchesDocument(customerName, first, last)) return { check: "name_matches", result: "pass", reason: null };
  const onLicence = `${first ?? ""} ${last ?? ""}`.trim() || "no name read";
  return { check: "name_matches", result: "fail", reason: `On file: ${customerName}. On the licence: ${onLicence}` };
}

const NOT_FULL_LICENCE: Array<[RegExp, string]> = [
  [/LEARNER/, "learner's permit"],
  [/INSTRUCTION/, "instruction permit"],
  [/PERMIT/, "permit"],
  [/PROVISIONAL/, "provisional licence"],
  [/ID_CARD|IDENTITY_CARD/, "ID card"],
];
const FULL_LICENCE = /(DRIVER_LICENSE|DRIVERS_LICENSE|_DL)(_|$)/;

/**
 * Line 8, right type of licence (spec 07.18). `accepted` is tenants.accepted_verification_document.
 * A subtype the rule does not recognise is could_not_check, never a pass.
 */
export function licenceTypeLine(
  documentType: string | null | undefined,
  subtype: string | null | undefined,
  accepted: string | null | undefined,
): Line {
  const type = (documentType ?? "").toLowerCase();
  const sub = (subtype ?? "").toUpperCase();
  if (type.includes("passport")) {
    return accepted === "passport" || accepted === "any"
      ? { check: "licence_type", result: "pass", reason: null }
      : { check: "licence_type", result: "fail", reason: "This is a passport, not a driving licence" };
  }
  if (type.includes("identity") || type.includes("id card")) {
    return { check: "licence_type", result: "fail", reason: "This is an ID card, not a full driving licence" };
  }
  if (!type.includes("driver")) {
    return { check: "licence_type", result: "could_not_check", reason: "The kind of document could not be read" };
  }
  for (const [pattern, kind] of NOT_FULL_LICENCE) {
    if (pattern.test(sub)) return { check: "licence_type", result: "fail", reason: `This is a ${kind}, not a full driving licence` };
  }
  if (FULL_LICENCE.test(sub)) return { check: "licence_type", result: "pass", reason: null };
  return { check: "licence_type", result: "could_not_check", reason: `Unknown licence kind: ${subtype ?? "none"}` };
}

/** Upper case, spaces and dashes removed: how a document number is compared with the blocked list (spec 07.19). */
export function normaliseDocumentNumber(value: string | null | undefined): string {
  return (value ?? "").toUpperCase().replace(/[\s-]/g, "");
}

/** The checks that decide Verified (spec 07.21). Line 6 may also be not_set. */
export const DECIDING_CHECKS = ["real_licence", "live_person", "face_match", "not_expired", "old_enough", "name_matches", "licence_type", "not_blocked"];

export type StandardOutcome = "verified" | "needs_review" | "failed";

/** Spec 07.21 to 07.23. `diditInReview` is Didit's "In Review" status. */
export function standardOutcome(lines: Line[], diditInReview: boolean): StandardOutcome {
  const deciding = lines.filter((l) => DECIDING_CHECKS.includes(l.check));
  if (deciding.some((l) => l.result === "fail")) return "failed";
  if (diditInReview) return "needs_review";
  for (const check of DECIDING_CHECKS) {
    const line = deciding.find((l) => l.check === check);
    if (!line) return "needs_review";
    if (line.result === "pass") continue;
    if (check === "old_enough" && line.result === "not_set") continue;
    return "needs_review";
  }
  return "verified";
}
