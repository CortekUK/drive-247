/**
 * The signup "lead": what someone typed on the first page, saved before any
 * account exists (Neema, 2026-11-25).
 *
 * The account is only created once the business page is submitted, so people
 * who stopped earlier left nothing behind. Now the browser keeps a random lead
 * token (localStorage, plus a cookie because in-app browsers sometimes drop
 * one or the other) and `signup-lead` saves the answers against it, then moves
 * the lead's last step forward as they go. Bryan sees leads in admin →
 * Retention → Signups as "Started signup, not finished".
 *
 * Everything here is best-effort and never throws: saving a lead must never get
 * in the way of the signup itself.
 */

import type { FleetSize } from "@/lib/fleet-size";

export type LeadStep = "details" | "business" | "email_code" | "password" | "card" | "done";

export interface LeadDetails {
  fullName?: string;
  email?: string;
  phone?: string;
  fleetSize?: FleetSize | null;
  heardAbout?: string;
  heardAboutOther?: string;
  cityState?: string;
  planId?: string | null;
}

export interface SavedLead {
  email: string;
  fullName: string;
  phone: string;
  fleetSize: FleetSize | null;
  heardAbout: string;
  heardAboutOther: string;
  cityState: string;
  planId: string | null;
  lastStep: LeadStep;
}

/** Under the `d247.signup.` prefix, so `?fresh=1` (fresh-start.ts) forgets it too. */
const TOKEN_KEY = "d247.signup.leadToken";
const TOKEN_COOKIE = "d247_lead";
const TOKEN_RE = /^[a-f0-9]{64}$/;

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const hit = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
}

function existingToken(): string | null {
  try {
    const stored = window.localStorage.getItem(TOKEN_KEY);
    if (stored && TOKEN_RE.test(stored)) return stored;
  } catch {
    /* storage blocked: the cookie may still have it */
  }
  const cookie = readCookie(TOKEN_COOKIE);
  return cookie && TOKEN_RE.test(cookie) ? cookie : null;
}

function rememberToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* the cookie below still carries it */
  }
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${TOKEN_COOKIE}=${token}; Max-Age=${30 * 24 * 60 * 60}; Path=/; SameSite=Lax${secure}`;
}

/** This browser's lead token, made on first use. Null outside a browser. */
export function leadToken(create = true): string | null {
  if (typeof window === "undefined") return null;
  const found = existingToken();
  if (found) {
    rememberToken(found); // heal whichever store lost it
    return found;
  }
  if (!create) return null;
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  rememberToken(token);
  return token;
}

/** Forget the lead (a fresh start). */
export function forgetLead(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* nothing to do */
  }
  if (typeof document !== "undefined") document.cookie = `${TOKEN_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
}

/**
 * The app a link was opened inside, from its user agent: Instagram and Facebook
 * (and Messenger, TikTok) use their own browser, which Google refuses to sign
 * in from and which often reloads the page when someone switches apps.
 */
export function inAppBrowser(ua: string | undefined = typeof navigator !== "undefined" ? navigator.userAgent : ""): string | null {
  const s = ua ?? "";
  if (/Instagram/i.test(s)) return "instagram";
  if (/FBAN|FBAV|FB_IAB|FBIOS|FB4A/i.test(s)) return "facebook";
  if (/Messenger/i.test(s)) return "messenger";
  if (/musical_ly|BytedanceWebview|TikTok/i.test(s)) return "tiktok";
  return null;
}

function functionsUrl(): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Local testing only (scripts/dev-account-functions.ts), as in onboarding-api.ts.
  const localFns = process.env.NODE_ENV === "development" ? process.env.NEXT_PUBLIC_SIGNUP_FUNCTIONS_URL : "";
  if (localFns) return `${localFns.replace(/\/+$/, "")}/signup-lead`;
  return base ? `${base.replace(/\/$/, "")}/functions/v1/signup-lead` : null;
}

async function call(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const url = functionsUrl();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Save the lead at `step`, with any answers given. Fire and forget: resolves to
 * the lead id when the server accepted it, else null.
 */
export async function saveLead(step: LeadStep, details?: LeadDetails): Promise<string | null> {
  const token = leadToken(step === "details");
  if (!token) return null;
  const res = await call({
    action: "save",
    token,
    step,
    ...(details ? { details } : {}),
    ...(inAppBrowser() ? { inAppBrowser: inAppBrowser() } : {}),
  });
  return typeof res?.leadId === "string" ? res.leadId : null;
}

/** The answers this browser saved earlier, for a page that reloaded. Null when none. */
export async function readLead(): Promise<SavedLead | null> {
  const token = leadToken(false);
  if (!token) return null;
  const res = await call({ action: "read", token });
  const lead = res?.lead as SavedLead | null | undefined;
  return lead && typeof lead === "object" ? lead : null;
}
