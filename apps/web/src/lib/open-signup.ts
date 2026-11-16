/**
 * Opening the signup form from a button outside the pricing grid.
 *
 * The signup dialog belongs to <OnboardingProvider>, which sits inside the
 * pricing section. A button elsewhere (the hero, the header, the demo form's
 * thank-you screen) asks for it with an event. When no signup on this page takes
 * the event (another page, or the provider has not loaded yet), the button
 * follows SIGNUP_START_HREF instead, and the landing page opens the form when it
 * loads.
 */

export const OPEN_SIGNUP_EVENT = "drive247:open-signup";

/** The landing page with the signup form already open on the recommended plan. */
export const SIGNUP_START_HREF = "/?signup=start";

/** Ask the signup on this page to open. True when it did. */
export function requestSignupOpen(): boolean {
  if (typeof window === "undefined") return false;
  // The provider cancels the event to say "done".
  return !window.dispatchEvent(new Event(OPEN_SIGNUP_EVENT, { cancelable: true }));
}

/** Open the signup here if this page has one, otherwise go to the landing page with it open. */
export function openSignup(): void {
  if (!requestSignupOpen()) window.location.assign(SIGNUP_START_HREF);
}
