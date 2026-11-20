/**
 * "Not ready just yet?" — the one-time offer on the card step.
 *
 * Shown once per person, and only to someone who has not applied a code:
 *   - laptop / desktop: when the mouse leaves through the top of the window;
 *   - phone: when they tap the X or press back.
 *
 * "Once" is remembered in two places: this browser (localStorage, so a reload
 * never shows it again) and the account (`exitOfferSeenAt` in the signup
 * metadata and `signup_attribution.exit_offer_seen_at`, so another device does
 * not either, and Bryan can see they have already been offered 20%).
 *
 * Pure apart from the storage helpers, which never throw.
 */

/** The code the offer applies. The owner creates it: 20% off for 3 months. */
export const EXIT_OFFER_CODE = "WELCOME20";

export const EXIT_OFFER_STORAGE_KEY = "d247.signup.exitOfferSeen";

export interface ExitOfferGate {
  step: string;
  paid: boolean;
  /** A promo or referral code is already on this subscription. */
  promoApplied: boolean;
  /** A request is in flight (minting an intent, confirming the card). */
  busy: boolean;
  /** This browser has shown it before. */
  seenLocally: boolean;
  /** The account says it was shown before (on any device). */
  seenOnAccount: boolean;
  /** Something else already covers the card (the offer itself, or the signup is closed). */
  covered: boolean;
}

export function shouldShowExitOffer(g: ExitOfferGate): boolean {
  return (
    g.step === "payment" &&
    !g.paid &&
    !g.promoApplied &&
    !g.busy &&
    !g.seenLocally &&
    !g.seenOnAccount &&
    !g.covered
  );
}

/**
 * The mouse left through the top of the window: towards the tabs, the address
 * bar or the close button. Leaving through a side or the bottom is not
 * someone heading off, and `relatedTarget` is set when the pointer only moved
 * onto another element (or into an iframe, like Stripe's card field).
 */
export function isExitIntent(e: { clientY: number; relatedTarget: unknown }): boolean {
  return e.relatedTarget == null && e.clientY <= 0;
}

/**
 * Phones (and tablets) get the X / back trigger and the "Email me a link"
 * button; anything with a fine pointer and room gets exit intent.
 */
export function isPhoneLike(win: { matchMedia?: (q: string) => { matches: boolean } } | undefined): boolean {
  if (!win?.matchMedia) return false;
  try {
    return win.matchMedia("(max-width: 639px)").matches || win.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function storage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readExitOfferSeen(store: StorageLike | null = storage()): boolean {
  try {
    return Boolean(store?.getItem(EXIT_OFFER_STORAGE_KEY));
  } catch {
    return false;
  }
}

export function writeExitOfferSeen(store: StorageLike | null = storage(), at: Date = new Date()): void {
  try {
    store?.setItem(EXIT_OFFER_STORAGE_KEY, at.toISOString());
  } catch {
    /* storage blocked: the account copy still remembers */
  }
}
