/**
 * The stand-in password, so the password can come AFTER the email code.
 *
 * The agreed order (Ghulam, 2026-11-23) is about you → business → email code →
 * password → card. `signup-begin` still creates the account with a password,
 * and the browser can only get a session for it by signing in with that
 * password once the code has confirmed the address. So the business page sends
 * a random stand-in instead of a password nobody has chosen yet; the browser
 * signs in with it after the code, and the password screen replaces it with
 * the real one (`auth.updateUser`). No server change was needed for the order.
 *
 * The stand-in is a credential, so it is kept as briefly as possible: in
 * memory, plus a copy in THIS TAB's sessionStorage so a reload on the code
 * screen can still sign in. It is forgotten the moment the real password is
 * set, and sessionStorage dies with the tab. A stand-in that is lost (a new
 * tab) is not a dead end: the sign-in panel's "Forgot password?" sets one.
 *
 * `PASSWORD_PENDING_META_KEY` marks, on the account itself, that the stand-in
 * is still in place, so a signup resumed later (another tab, another day) is
 * asked for its password before the card, and not dropped into a portal
 * whose login nobody knows.
 */

const STORAGE_KEY = "d247.signup.standIn";
/** A code is good for well under this; anything older is not worth trying. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** `user_metadata` flag: true from the code until the real password is set. */
export const PASSWORD_PENDING_META_KEY = "d247_signup_password_pending";

/**
 * 32 random bytes, base64url, plus a letter and a digit so it always passes
 * `signup-begin`'s rule (8+ characters, a letter and a number).
 */
export function makeStandInPassword(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let raw = "";
  for (const b of bytes) raw += String.fromCharCode(b);
  const b64 = btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64}a1`;
}

export function rememberStandIn(email: string, password: string): void {
  try {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ email: email.trim().toLowerCase(), password, at: Date.now() }),
    );
  } catch {
    /* storage blocked: the in-memory copy still covers this page */
  }
}

/** The stand-in for this address, if this tab still has it. */
export function readStandIn(email: string): string | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { email?: unknown; password?: unknown; at?: unknown };
    if (typeof v.email !== "string" || typeof v.password !== "string" || typeof v.at !== "number") return null;
    if (v.email !== email.trim().toLowerCase() || Date.now() - v.at > MAX_AGE_MS) return null;
    return v.password;
  } catch {
    return null;
  }
}

export function forgetStandIn(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to forget */
  }
}

/** Whether the signed-in account is still on its stand-in password. */
export function isPasswordPending(user: { user_metadata?: Record<string, unknown> | null } | null | undefined): boolean {
  return user?.user_metadata?.[PASSWORD_PENDING_META_KEY] === true;
}
