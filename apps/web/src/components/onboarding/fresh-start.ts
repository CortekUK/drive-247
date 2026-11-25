/**
 * `?fresh=1`: forget every signup this browser is part-way through, then open
 * a new one.
 *
 * The developer hub (apps/developer, Onboarding tab) links here, on
 * drive-247.com and on localhost. Its Reset clears a test signup on the
 * server, but the browser keeps its own copy: the half-filled form, the code
 * screen, the stand-in password, the chosen plan, "already saw the offer" and
 * the sign-in itself. No server can reach that, so this does.
 *
 * Every key the signup writes starts with one of the prefixes below
 * (tenant-draft.ts, pending-verify.ts, exit-offer.ts, signup-stand-in.ts,
 * lib/signup-prefill.ts, onboarding-provider.tsx and the localhost pretend run
 * in mock-signup.ts). Clearing by prefix keeps it right as keys are added.
 * The pretend run's on/off switch (`d247.signupMock.off`) is a preference, not
 * signup data, and is left alone.
 *
 * It runs once per page load, before anything reads that storage: when the
 * signup module loads and before the Supabase client is first made
 * (lib/supabase/browser.ts). It only clears storage; the provider opens the
 * new signup and tidies the address bar (`FRESH_START_PARAM`).
 *
 * It is harmless for anyone: it only clears this browser's own signup data.
 */

import { REFERRAL_COOKIE } from "@/lib/referral-cookie";

export const FRESH_START_PARAM = "fresh";

const LOCAL_PREFIXES = ["d247.signup.", "d247-signup-", "d247-web-auth"];
/** `d247.signup.*` and the pretend run's `d247.signupMock.*`. */
const SESSION_PREFIXES = ["d247.signup"];

let consumed = false;

export function isFreshStartRequest(search: string): boolean {
  try {
    return new URLSearchParams(search).get(FRESH_START_PARAM) === "1";
  } catch {
    return false;
  }
}

export function consumeFreshStart(): void {
  if (consumed || typeof window === "undefined") return;
  consumed = true;
  if (!isFreshStartRequest(window.location.search)) return;
  clearByPrefix(() => window.localStorage, LOCAL_PREFIXES);
  clearByPrefix(() => window.sessionStorage, SESSION_PREFIXES);
  // A promo code carried in from an earlier run would otherwise ride along.
  document.cookie = `${REFERRAL_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
  // And the signup lead's token (lib/signup-lead.ts; its localStorage copy goes above).
  document.cookie = `d247_lead=; Max-Age=0; Path=/; SameSite=Lax`;
}

function clearByPrefix(getStore: () => Storage, prefixes: string[]): void {
  try {
    const store = getStore();
    const doomed: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key && prefixes.some((p) => key.startsWith(p))) doomed.push(key);
    }
    for (const key of doomed) store.removeItem(key);
  } catch {
    /* storage blocked: there is nothing stored to clear */
  }
}
