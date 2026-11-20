/**
 * "How did you hear about us?", "How many cars do you rent out?" and the
 * optional phone number on the signup.
 *
 * Both questions are required by the form. The server re-checks them in
 * `supabase/functions/_shared/signup-attribution.ts`, which holds the same lists.
 */

// Relative, not "@/": tests/integrations imports this file without the app alias.
import { isFleetSize, type FleetSize } from "./fleet-size";

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
  /** "How many cars do you rent out?" Optional in the type only for older callers. */
  fleetSize?: FleetSize | "";
  phone: string;
}

export const EMPTY_ATTRIBUTION: AttributionDraft = {
  heardAbout: "",
  heardAboutOther: "",
  fleetSize: "",
  phone: "",
};

/** What is sent to the server. */
export interface SignupAttribution {
  heardAbout: HeardAbout;
  heardAboutOther?: string;
  /** "1-5" | "6-20" | "21+". Picks the plan; see lib/fleet-size.ts. */
  fleetSize?: FleetSize;
  phone?: string;
}

export type AttributionField = "heardAbout" | "heardAboutOther" | "fleetSize" | "phone";

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

export function validateAttribution(
  draft: AttributionDraft,
): Partial<Record<AttributionField, string>> {
  const errors: Partial<Record<AttributionField, string>> = {};
  if (!isHeardAbout(draft.heardAbout)) {
    errors.heardAbout = "Please choose an answer.";
  } else if (draft.heardAbout === "other" && !draft.heardAboutOther.trim()) {
    errors.heardAboutOther = "Please tell us where you heard about us.";
  }
  if (!isFleetSize(draft.fleetSize)) {
    errors.fleetSize = "Please choose how many cars you rent out.";
  }
  if (!isValidPhone(draft.phone)) {
    errors.phone = "Please enter a valid phone number, or leave this blank.";
  }
  return errors;
}

/**
 * The draft as a request body, or null when there is no complete answer yet.
 *
 * A phone that does not validate is left out rather than holding up the answer:
 * the Google button sends whatever is usable and asks for the rest afterwards.
 * The fleet size rides along once it is picked; the screen after a Google
 * sign-in asks for it when it is missing (see `hasCompleteAttribution`).
 */
export function attributionFromDraft(draft: AttributionDraft): SignupAttribution | null {
  if (!isHeardAbout(draft.heardAbout)) return null;
  const other = draft.heardAboutOther.trim();
  if (draft.heardAbout === "other" && !other) return null;
  const phone = draft.phone.trim();
  return {
    heardAbout: draft.heardAbout,
    ...(draft.heardAbout === "other" ? { heardAboutOther: other } : {}),
    ...(isFleetSize(draft.fleetSize) ? { fleetSize: draft.fleetSize } : {}),
    ...(phone && isValidPhone(phone) ? { phone } : {}),
  };
}

/** True when both questions have an answer on record. */
export function hasCompleteAttribution(
  a: { heardAbout?: unknown; fleetSize?: unknown } | null | undefined,
): boolean {
  return Boolean(a && isHeardAbout(a.heardAbout) && isFleetSize(a.fleetSize));
}
