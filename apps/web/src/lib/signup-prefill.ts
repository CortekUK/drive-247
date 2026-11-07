/**
 * A company name typed on the landing page, waiting for the signup to pick it up.
 *
 * The closing section ("What's your rental company called?") sits outside the
 * pricing grid's <OnboardingProvider>, so it cannot open the signup itself. It
 * saves the name here and sends the visitor to the plans; the provider takes the
 * name the next time a plan opens a fresh signup and puts it in the business
 * name field, with the web address derived from it as usual.
 *
 * Session storage, so it lives for this tab only, and it is removed the moment
 * it is read. It is a convenience: every failure (storage blocked, private mode)
 * answers null and the field simply starts empty.
 */
import { FIELD_MAX } from "@/lib/signup-validation";

const KEY = "d247.signup.companyName";

export function saveSignupPrefill(companyName: string): void {
  const value = companyName.trim().slice(0, FIELD_MAX.companyName);
  try {
    if (value) window.sessionStorage.setItem(KEY, value);
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // Storage unavailable: the signup asks for the name as it always has.
  }
}

/** Reads the saved name once and forgets it. */
export function takeSignupPrefill(): string | null {
  try {
    const value = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    return value?.trim() || null;
  } catch {
    return null;
  }
}
