/**
 * feat-001: the rules for an account made by the 3-step signup, which arrives
 * in the portal before its email is proved and before it has a password.
 *
 * Pure: no imports, no Deno, no network, so Vitest and Deno run the same code.
 *
 * The two flags live in the account's `app_metadata` (only the server can set
 * them; the person cannot edit app_metadata). They are the ONLY thing any app
 * reads to decide whether the email is proved or a password is chosen.
 */

/** true from signup until the emailed code is entered (spec 01.4, 03.4). */
export const PENDING_EMAIL = "d247_signup_email_pending";
/** true from signup until the person chooses a password (spec 01.4, 03.11). */
export const PENDING_PASSWORD = "d247_signup_password_pending";

type Meta = Record<string, unknown> | null | undefined;

export function isEmailPending(appMeta: Meta): boolean {
  return appMeta?.[PENDING_EMAIL] === true;
}

export function isPasswordPending(appMeta: Meta): boolean {
  return appMeta?.[PENDING_PASSWORD] === true;
}

/** The password rule, unchanged from signup-begin: 8+ characters, a letter and a number (spec 03.10). */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string") return "Choose a password.";
  if (password.length < 8) return "Use at least 8 characters.";
  if (password.length > 72) return "Use 72 characters or fewer.";
  if (!/[A-Za-z]/.test(password)) return "Include at least one letter.";
  if (!/\d/.test(password)) return "Include at least one number.";
  return null;
}

/** Same pattern as tenant-provisioning's EMAIL_RE, plus a length cap. */
export function normaliseEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const email = input.trim().toLowerCase();
  if (email.length > 254) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : null;
}
