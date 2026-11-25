/**
 * The code screen, remembered across a reload or a closed tab.
 *
 * People leave the signup to find the code: they switch to their mail app, the
 * phone unloads the tab, and when they come back the page starts from the top.
 * The account exists by then (unconfirmed), so starting again means typing the
 * whole form a second time, and many did not.
 *
 * This keeps just enough to put them back on "Check your inbox" for the same
 * address: who they are, the plan, and when the code was sent. Never the
 * password and never the code. It lives in `localStorage` (this browser only,
 * survives a closed tab) for a day (PENDING_VERIFY_TTL_MS), longer than a code
 * lasts (CODE_TTL_MS), so someone back after their code expired still lands here
 * and asks for a new one.
 *
 * The password is held in memory only, so after a reload the code screen still
 * works but the sign-in after it asks for the password once (see
 * `verifyEmailCode` in the provider).
 */

/** Mirrors OTP_TTL_MS in supabase/functions/_shared/signup-otp.ts (30 minutes). */
export const CODE_TTL_MS = 30 * 60 * 1000;

/**
 * How long the code screen itself is remembered: a day, like the stand-in
 * password (signup-stand-in.ts), and much longer than one code lasts (Neema,
 * 2026-11-25). Someone who comes back after their code expired lands on the code
 * screen with their business details kept, and asks for a new code there,
 * instead of starting the form again.
 */
export const PENDING_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

/** True once the code sent at `sentAt` can no longer be used: ask for a new one. */
export function isCodeExpired(sentAt: number | null | undefined, now: number = Date.now()): boolean {
  return Boolean(sentAt) && now - (sentAt as number) >= CODE_TTL_MS;
}

/** Mirrors OTP_RESEND_COOLDOWN_MS in the same file. */
export const RESEND_COOLDOWN_MS = 60 * 1000;

const KEY = "d247.signup.pendingVerify";

export interface PendingVerify {
  email: string;
  fullName: string;
  planId: string;
  /** Date.now() when the latest code was sent. */
  sentAt: number;
}

/** True while the code sent at `sentAt` can still be used. */
export function isPendingVerifyLive(record: PendingVerify | null, now: number = Date.now()): boolean {
  if (!record) return false;
  return now >= record.sentAt - 60_000 && now - record.sentAt < PENDING_VERIFY_TTL_MS;
}

/** Seconds left before "Resend code" may be pressed again for a code sent at `sentAt`. */
export function resendCooldownSeconds(sentAt: number | null, now: number = Date.now()): number {
  if (!sentAt) return Math.round(RESEND_COOLDOWN_MS / 1000);
  const left = Math.ceil((RESEND_COOLDOWN_MS - (now - sentAt)) / 1000);
  return Math.max(0, Math.min(Math.round(RESEND_COOLDOWN_MS / 1000), left));
}

function parse(raw: string | null): PendingVerify | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PendingVerify>;
    if (
      typeof v.email !== "string" ||
      !v.email.includes("@") ||
      typeof v.fullName !== "string" ||
      typeof v.planId !== "string" ||
      !v.planId ||
      typeof v.sentAt !== "number" ||
      !Number.isFinite(v.sentAt)
    ) {
      return null;
    }
    return { email: v.email, fullName: v.fullName, planId: v.planId, sentAt: v.sentAt };
  } catch {
    return null;
  }
}

/** The remembered code screen, or null when there is none or its code has expired. */
export function readPendingVerify(now: number = Date.now()): PendingVerify | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
  const record = parse(raw);
  if (record && isPendingVerifyLive(record, now)) return record;
  if (raw) clearPendingVerify();
  return null;
}

export function writePendingVerify(record: PendingVerify): void {
  if (typeof window === "undefined") return;
  // Field by field, so nothing else a caller hands over can ever be stored.
  const { email, fullName, planId, sentAt } = record;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ email, fullName, planId, sentAt }));
  } catch {
    /* storage blocked: a reload simply starts over, as before */
  }
}

export function clearPendingVerify(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
