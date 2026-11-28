/**
 * "How did you hear about us?" and the phone number on the signup.
 *
 * The phone number is required (2026-11-24, owner): a 21+ car lead left it
 * blank and the team could not call. "How did you hear about us?" is optional,
 * and "How many cars do you rent out?" is no longer asked (Ghulam, 2026-11-23).
 * The server re-checks what is sent in
 * `supabase/functions/_shared/signup-attribution.ts`, which holds the same
 * lists and does not require any of them: the form is what requires the phone.
 */

// Relative, not "@/": tests/integrations imports this file without the app alias.
import type { FleetSize } from "./fleet-size";

export const HEARD_ABOUT_OPTIONS = [
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "google_search", label: "Google search" },
  { value: "youtube", label: "YouTube" },
  { value: "friend_or_host", label: "A friend or another host" },
  { value: "turo_group", label: "Turo host group or forum" },
  { value: "other", label: "Other" },
] as const;

export type HeardAbout = (typeof HEARD_ABOUT_OPTIONS)[number]["value"];

export const HEARD_ABOUT_OTHER_MAX = 100;
export const PHONE_MAX = 40;

/** What the fields hold while someone is filling them in. */
export interface AttributionDraft {
  heardAbout: HeardAbout | "";
  heardAboutOther: string;
  /** No longer asked; kept in the type for older drafts and the dev mock. */
  fleetSize?: FleetSize | "";
  phone: string;
}

export const EMPTY_ATTRIBUTION: AttributionDraft = {
  heardAbout: "",
  heardAboutOther: "",
  fleetSize: "",
  phone: "",
};

/** What is sent to the server. Every part is optional. */
export interface SignupAttribution {
  heardAbout?: HeardAbout;
  heardAboutOther?: string;
  /** No longer asked. Signups from before 2026-11-23 may still carry it. */
  fleetSize?: FleetSize;
  phone?: string;
}

export type AttributionField = "heardAbout" | "heardAboutOther" | "phone";

export function isHeardAbout(value: unknown): value is HeardAbout {
  return HEARD_ABOUT_OPTIONS.some((option) => option.value === value);
}

/**
 * The shape of a phone number: 7 to 15 digits, with `+`, spaces, brackets, dots
 * or dashes allowed. Blank passes here (the server stores no phone then);
 * `validateAttribution` is what makes the field required.
 */
export function isValidPhone(raw: string): boolean {
  const typed = raw.trim();
  if (!typed) return true;
  if (typed.length > PHONE_MAX || !/^[+\d\s().-]+$/.test(typed)) return false;
  const digits = typed.replace(/\D/g, "").length;
  return digits >= 7 && digits <= 15;
}

/**
 * The phone number is required and must look like one. Leaving "How did you
 * hear about us?" unanswered, or picking "Other" without saying what, is fine.
 */
export function validateAttribution(
  draft: AttributionDraft,
): Partial<Record<AttributionField, string>> {
  const errors: Partial<Record<AttributionField, string>> = {};
  if (!draft.phone.trim()) {
    errors.phone = "Please enter your phone number.";
  } else if (!isValidPhone(draft.phone)) {
    errors.phone = "Please enter a valid phone number.";
  }
  return errors;
}

/**
 * The draft as a request body, or null when nothing was answered.
 *
 * A phone that does not validate is left out rather than holding anything up:
 * the Google button sends whatever is usable.
 */
export function attributionFromDraft(draft: AttributionDraft): SignupAttribution | null {
  const heardAbout = isHeardAbout(draft.heardAbout) ? draft.heardAbout : null;
  const other = draft.heardAboutOther.trim();
  const phone = draft.phone.trim();
  const answer: SignupAttribution = {
    ...(heardAbout ? { heardAbout } : {}),
    ...(heardAbout === "other" && other ? { heardAboutOther: other } : {}),
    ...(phone && isValidPhone(phone) ? { phone } : {}),
  };
  return Object.keys(answer).length > 0 ? answer : null;
}

/**
 * True when a usable phone number is on record. A Google signup without one is
 * shown the short question screen before the card. The other answers are
 * optional, so they are not checked.
 */
export function hasCompleteAttribution(
  a: { heardAbout?: unknown; fleetSize?: unknown; phone?: unknown } | null | undefined,
): boolean {
  return Boolean(a && typeof a.phone === "string" && a.phone.trim() !== "" && isValidPhone(a.phone));
}

/**
 * Review 1 (Ghulam's video, V4): the phone field's country picker. USA first
 * (the default), then the countries our operators sign up from. The stored
 * value stays one string, "+<dial> <number>", which `isValidPhone` accepts.
 */
export interface PhoneCountry { iso: string; dial: string; flag: string; example: string }
export const PHONE_COUNTRIES: readonly PhoneCountry[] = [
  { iso: "US", dial: "1", flag: "🇺🇸", example: "(555) 123-4567" },
  { iso: "CA", dial: "1", flag: "🇨🇦", example: "(555) 123-4567" },
  { iso: "GB", dial: "44", flag: "🇬🇧", example: "7400 123456" },
  { iso: "PK", dial: "92", flag: "🇵🇰", example: "301 2345678" },
  { iso: "AE", dial: "971", flag: "🇦🇪", example: "50 123 4567" },
  { iso: "IN", dial: "91", flag: "🇮🇳", example: "81234 56789" },
  { iso: "AU", dial: "61", flag: "🇦🇺", example: "412 345 678" },
  { iso: "MX", dial: "52", flag: "🇲🇽", example: "55 1234 5678" },
];

/** "+92 3012345678" -> Pakistan and "3012345678". No "+": USA and the text as typed. */
export function splitPhone(raw: string, preferredIso?: string): { country: PhoneCountry; number: string } {
  const typed = (raw ?? "").trim();
  const m = typed.match(/^\+(\d{1,3})\s*(.*)$/);
  if (m) {
    const matches = PHONE_COUNTRIES.filter((c) => typed.startsWith(`+${c.dial}`)).sort((a, b) => b.dial.length - a.dial.length);
    const best = matches.find((c) => c.iso === preferredIso) ?? matches[0];
    if (best) return { country: best, number: typed.slice(best.dial.length + 1).trim() };
  }
  return { country: PHONE_COUNTRIES.find((c) => c.iso === preferredIso) ?? PHONE_COUNTRIES[0], number: typed };
}

/** The stored value: "+1 5551234567". An empty number stays empty, so "required" still works. */
export function composePhone(country: PhoneCountry, number: string): string {
  const n = number.trim();
  return n ? `+${country.dial} ${n.replace(/^\+\d{1,3}\s*/, "")}` : "";
}
