/**
 * feat-001 spec 04: who sees the portal's "confirm your email and choose a
 * password" window, and when it stops being optional.
 *
 * The one place these rules live. Pure (no imports), so the spec 04 eval runs
 * it in Vitest. The flags are written by the server only (signup-begin sets
 * them, signup-verify-email and signup-set-password clear them), in the
 * account's app_metadata, which the person cannot edit.
 */

export const PENDING_EMAIL = "d247_signup_email_pending";
export const PENDING_PASSWORD = "d247_signup_password_pending";

/** The window can be closed until this many hours after the account was made (spec 04.4). */
export const VERIFY_DEADLINE_HOURS = 72;

type MaybeUser = { app_metadata?: Record<string, unknown> | null; created_at?: string | null } | null | undefined;

export function isEmailPending(user: MaybeUser): boolean {
  return user?.app_metadata?.[PENDING_EMAIL] === true;
}

export function isPasswordPending(user: MaybeUser): boolean {
  return user?.app_metadata?.[PENDING_PASSWORD] === true;
}

/** Anyone with a flag still set sees the window; Google signups and finished accounts never do (04.7). */
export function needsSignupVerify(user: MaybeUser): boolean {
  return isEmailPending(user) || isPasswordPending(user);
}

/** True from exactly 72 hours after `createdAt` (04.4). */
export function isSignupVerifyOverdue(createdAt: Date | string, now: Date = new Date()): boolean {
  const start = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  if (Number.isNaN(start.getTime())) return false;
  return now.getTime() - start.getTime() >= VERIFY_DEADLINE_HOURS * 60 * 60 * 1000;
}

/** "2 days left", "1 day left", "5 hours left", "Less than an hour left", or null once overdue (04.6). */
export function timeLeftText(createdAt: Date | string, now: Date = new Date()): string | null {
  const start = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  if (Number.isNaN(start.getTime())) return null;
  const msLeft = start.getTime() + VERIFY_DEADLINE_HOURS * 60 * 60 * 1000 - now.getTime();
  if (msLeft <= 0) return null;
  const DAY = 24 * 60 * 60 * 1000;
  // Over a day left: count whole days UP, so a signup minutes ago reads
  // "3 days left", not "2". Under a day: whole hours, counted down.
  if (msLeft > DAY) {
    const days = Math.ceil(msLeft / DAY);
    return `${days} ${days === 1 ? "day" : "days"} left`;
  }
  const hours = Math.floor(msLeft / (60 * 60 * 1000));
  if (hours >= 1) return `${hours} ${hours === 1 ? "hour" : "hours"} left`;
  return "Less than an hour left";
}

/** The signup password rule (8+ characters, a letter and a number), unchanged from signup. */
export const SIGNUP_PASSWORD_RULES: ReadonlyArray<{ label: string; test: (password: string) => boolean }> = [
  { label: "8 characters or more", test: (p) => p.length >= 8 && p.length <= 72 },
  { label: "A letter", test: (p) => /[A-Za-z]/.test(p) },
  { label: "A number", test: (p) => /\d/.test(p) },
];
