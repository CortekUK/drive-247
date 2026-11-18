/**
 * "How did you hear about us?" and the optional phone number on the signup.
 *
 * The answer is required by the form. The server re-checks it in
 * `supabase/functions/_shared/signup-attribution.ts`, which holds the same list.
 */

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
  phone: string;
}

export const EMPTY_ATTRIBUTION: AttributionDraft = {
  heardAbout: "",
  heardAboutOther: "",
  phone: "",
};

/** What is sent to the server. */
export interface SignupAttribution {
  heardAbout: HeardAbout;
  heardAboutOther?: string;
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

export function validateAttribution(
  draft: AttributionDraft,
): Partial<Record<AttributionField, string>> {
  const errors: Partial<Record<AttributionField, string>> = {};
  if (!isHeardAbout(draft.heardAbout)) {
    errors.heardAbout = "Please choose an answer.";
  } else if (draft.heardAbout === "other" && !draft.heardAboutOther.trim()) {
    errors.heardAboutOther = "Please tell us where you heard about us.";
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
 */
export function attributionFromDraft(draft: AttributionDraft): SignupAttribution | null {
  if (!isHeardAbout(draft.heardAbout)) return null;
  const other = draft.heardAboutOther.trim();
  if (draft.heardAbout === "other" && !other) return null;
  const phone = draft.phone.trim();
  return {
    heardAbout: draft.heardAbout,
    ...(draft.heardAbout === "other" ? { heardAboutOther: other } : {}),
    ...(phone && isValidPhone(phone) ? { phone } : {}),
  };
}
