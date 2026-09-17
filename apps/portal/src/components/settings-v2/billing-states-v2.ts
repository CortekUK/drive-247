/**
 * v2 billing (Settings › Subscription opens /subscription): the view-only copy
 * and "which checkout brought us back". v2 ONLY: every caller gates on
 * `useV2('chrome')`.
 *
 * WHY THE RETURN NEEDS WORK. The subscription checkout and the lean credits
 * checkout both come back to `/subscription?status=success`. The return URLs
 * are part of the money payload sent to the checkout functions, so they stay
 * exactly as they are. Without a way to tell the two apart, a credits top-up
 * toasted "Your subscription is active" and a new subscription toasted
 * "Credits purchased successfully!".
 *
 * So the v2 surface that starts a checkout notes which one, in sessionStorage
 * (per tab, and it survives the round trip through Stripe in that tab). When
 * no note can be read (storage blocked, a checkout started elsewhere), the
 * page falls back to what it can see: credits can only be bought by a tenant
 * who is already subscribed, so a tenant seen unsubscribed, or holding a
 * subscription created minutes ago, came back from a subscription checkout.
 */

export const BILLING_READ_ONLY_COPY = "View only — ask an admin to make billing changes";

export type CheckoutKind = "subscription" | "credits";

const STORAGE_KEY = "drive247:v2-checkout-started";

/** An older note belongs to a checkout that was abandoned, not to this return. */
export const CHECKOUT_NOTE_MAX_AGE_MS = 60 * 60 * 1000;

/** A subscription row this new was created by the checkout being returned from. */
export const FRESH_SUBSCRIPTION_MS = 30 * 60 * 1000;

interface CheckoutNote {
  kind: CheckoutKind;
  /** The page Stripe sends the tenant back to. */
  path: string;
  at: number;
}

export function noteCheckoutStarted(kind: CheckoutKind, path: string, now: number = Date.now()): void {
  try {
    const note: CheckoutNote = { kind, path, at: now };
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(note));
  } catch {
    // Storage unavailable: the page falls back to guessCheckoutKind.
  }
}

export function clearCheckoutNote(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** The note for a return to `path`, or null when there is none that fits. Does not clear it. */
export function readCheckoutNote(path: string, now: number = Date.now()): CheckoutKind | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const note = JSON.parse(raw) as Partial<CheckoutNote> | null;
    if (!note || (note.kind !== "subscription" && note.kind !== "credits")) return null;
    if (typeof note.at !== "number" || !Number.isFinite(note.at)) return null;
    const age = now - note.at;
    if (age < 0 || age > CHECKOUT_NOTE_MAX_AGE_MS) return null;
    if (note.path !== path) return null;
    return note.kind;
  } catch {
    return null;
  }
}

/** No note: decide from the subscription the page can see. */
export function guessCheckoutKind(input: {
  /** A settled, successful read showed no subscription at some point on this visit. */
  sawUnsubscribed: boolean;
  subscriptionCreatedAt: string | null | undefined;
  /** When the tenant landed back on the page. */
  arrivedAt: number;
}): CheckoutKind {
  if (input.sawUnsubscribed) return "subscription";
  const created = input.subscriptionCreatedAt ? Date.parse(input.subscriptionCreatedAt) : Number.NaN;
  if (Number.isFinite(created)) {
    const age = input.arrivedAt - created;
    // A little negative slack: the row's clock is the database's, not the browser's.
    if (age >= -5 * 60 * 1000 && age <= FRESH_SUBSCRIPTION_MS) return "subscription";
  }
  return "credits";
}
