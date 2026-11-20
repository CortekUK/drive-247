// =============================================================================
// signup-finish-later — "Email me a link to finish later" on the card step.
//
// A phone visitor who is not ready to type a card asks for a link; it opens the
// card step on their computer, signed in, with the exit offer's code applied.
//
// WHY OUR OWN TOKEN
// -----------------
// Supabase's magic links expire in under a day, and the owner wants the link to
// work for at least a week. So the email carries a random token of ours, good
// for 7 days, and only its SHA-256 lives in `signup_finish_later_tokens`. When
// the link is opened, `signup-finish-later` (action "redeem") checks the token
// and only THEN mints a fresh Supabase sign-in for that one account, which the
// browser spends straight away.
//
// The token carries 256 random bits, so a plain SHA-256 is enough: there is
// nothing to brute-force, and a database dump of hashes signs nobody in.
//
// Pure (no Deno, no network) so the rules and the email can be tested in Node.
// =============================================================================

import { escapeHtml, renderDrive247Email } from "./drive247-email.ts";

/** How long a link keeps working. The owner asked for at least 7 days. */
export const FINISH_LATER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Sends per account per hour. */
export const FINISH_LATER_SENDS_PER_HOUR = 3;

/**
 * Opens per link. The link is not single-use on purpose: a mail app's link
 * preview, or tapping it on the phone first, must not burn it before they reach
 * the computer. Capped so a forwarded link is not a standing key.
 */
export const FINISH_LATER_MAX_REDEMPTIONS = 10;

/** The only code the email may carry: the exit offer's. */
export const FINISH_LATER_CODE = "WELCOME20";

export const FINISH_LATER_SUBJECT = "Finish setting up your Drive247 account";

const SITE = "https://www.drive-247.com";

function base64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 32 random bytes, URL-safe (43 characters). */
export function mintFinishLaterToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

/** A token the mint could have produced. Checked before anything is looked up. */
export function isFinishLaterTokenShape(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

/** Lowercase hex SHA-256. This, never the token, is what is stored. */
export async function hashFinishLaterToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function finishLaterExpiry(now: Date = new Date()): string {
  return new Date(now.getTime() + FINISH_LATER_TTL_MS).toISOString();
}

export interface FinishLaterTokenRow {
  auth_user_id: string;
  expires_at: string;
  revoked_at?: string | null;
  used_count?: number | null;
}

export type FinishLaterVerdict =
  | { ok: true }
  | { ok: false; reason: "not_found" | "expired" | "revoked" | "used_up" };

/** Whether a stored link may still sign its account in. */
export function checkFinishLaterToken(
  row: FinishLaterTokenRow | null | undefined,
  now: Date = new Date(),
): FinishLaterVerdict {
  if (!row || !row.auth_user_id) return { ok: false, reason: "not_found" };
  if (row.revoked_at) return { ok: false, reason: "revoked" };
  const expires = Date.parse(row.expires_at);
  if (!Number.isFinite(expires) || expires <= now.getTime()) return { ok: false, reason: "expired" };
  if ((row.used_count ?? 0) >= FINISH_LATER_MAX_REDEMPTIONS) return { ok: false, reason: "used_up" };
  return { ok: true };
}

/**
 * The signup this link is for, as far as a sign-in is concerned. Once the
 * portal exists the account is a portal owner, and a week-long email link must
 * never become a way into that: the visitor is sent to their portal instead.
 */
export function finishLaterSignupState(meta: { status?: string; tenantId?: string } | null): "open" | "provisioned" | "missing" {
  if (!meta) return "missing";
  if (meta.tenantId || meta.status === "provisioned" || meta.status === "provisioning") return "provisioned";
  return "open";
}

/** The link in the email. `code` is only ever the exit offer's. */
export function buildFinishLaterLink(token: string, code: string | null = FINISH_LATER_CODE): string {
  const url = new URL(SITE);
  url.searchParams.set("signup", "finish");
  url.searchParams.set("t", token);
  if (code === FINISH_LATER_CODE) url.searchParams.set("code", code);
  return url.toString();
}

/** Only the exit offer's code may ride in the link; anything else is dropped. */
export function finishLaterCode(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim().toUpperCase() === FINISH_LATER_CODE ? FINISH_LATER_CODE : null;
}

/**
 * The email. `offer` is what the code really gives (promo-code-lookup's own
 * wording, e.g. "20% off" + "for your first 3 months"), and is left out when
 * the code is not live, so the email never promises a discount the card step
 * will not apply.
 */
export function buildFinishLaterEmail(input: {
  fullName?: string | null;
  link: string;
  offer?: { discountText: string; durationText: string } | null;
}): { subject: string; html: string } {
  const first = (input.fullName ?? "").trim().split(/\s+/)[0] ?? "";
  const href = escapeHtml(input.link);
  const intro = [
    first ? `Hi ${escapeHtml(first)},` : "Hi,",
    "Here is the link you asked for. It opens the last step of your Drive247 signup with your account already filled in, so you can add your card when you are at your computer.",
    ...(input.offer
      ? [`${escapeHtml(input.offer.discountText)} ${escapeHtml(input.offer.durationText)} is already applied.`]
      : []),
  ];
  const html = renderDrive247Email({
    preheader: "Pick up your Drive247 signup where you left off.",
    eyebrow: "Finish your signup",
    title: "Finish setting up your account",
    intro,
    cta: { label: "Finish setting up", href },
    note: `This link works for 7 days and only for your account. If you did not ask for it, you can ignore this email.`,
  });
  return { subject: FINISH_LATER_SUBJECT, html };
}
