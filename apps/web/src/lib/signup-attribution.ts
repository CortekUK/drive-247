/**
 * "How did you hear about us?" and the phone number on the signup.
 *
 * Both are optional (Ghulam, 2026-11-23). "How many cars do you rent out?" is
 * no longer asked. The server re-checks what is sent in
 * `supabase/functions/_shared/signup-attribution.ts`, which holds the same
 * lists and never required either answer.
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

/** Blank is fine, because the field is optional. Mirrors the server's rule. */
export function isValidPhone(raw: string): boolean {
  const typed = raw.trim();
  if (!typed) return true;
  if (typed.length > PHONE_MAX || !/^[+\d\s().-]+$/.test(typed)) return false;
  const digits = typed.replace(/\D/g, "").length;
  return digits >= 7 && digits <= 15;
}

/**
 * Only a typed phone number can be wrong. Leaving the question unanswered, or
 * picking "Other" without saying what, is fine.
 */
export function validateAttribution(
  draft: AttributionDraft,
): Partial<Record<AttributionField, string>> {
  const errors: Partial<Record<AttributionField, string>> = {};
  if (!isValidPhone(draft.phone)) {
    errors.phone = "Please enter a valid phone number, or leave this blank.";
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
