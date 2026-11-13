"use client";

/**
 * MOCK SIGNUP — the real signup screens with nothing real behind them.
 *
 * For rehearsing the onboarding UI over and over on localhost. Every screen,
 * every animation and every piece of copy is the real one; only the far end of
 * each call is fake:
 *
 *   - the `signup-*` edge functions        → answered here (onboarding-api.ts)
 *   - Supabase Auth (sign in, Google, …)   → answered here (lib/supabase/browser.ts)
 *   - Stripe                               → the real card form in TEST mode,
 *                                            validated but never confirmed (payment-step.tsx)
 *   - the hand-off to the portal           → /api/dev/mock-signup-handoff, which
 *                                            signs the rehearsal owner into their
 *                                            own workspace with first run re-armed
 *
 * Nothing creates a user, a tenant, a Stripe customer or a charge. Slug
 * availability and promo-code lookups are real READS and are left alone.
 *
 * ON BY DEFAULT IN `next dev`, OFF IN EVERY BUILD. `process.env.NODE_ENV` folds
 * to a literal at build time, so in production `isMockSignup()` is `false` and
 * every branch that asks it folds away.
 *
 *   ?mock=off    use the REAL signup on localhost (remembered in this browser)
 *   ?mock=on     back to the mock
 *   ?mock=reset  forget the signup in progress and start again
 *
 * For recording every screen (the list lives at /dev/signup-states):
 *
 *   ?scenario=<name>  make one fake answer fail or differ (see MOCK_SCENARIOS),
 *                     remembered for this tab until ?mock=reset or ?scenario=none
 *   ?plan=<id>        open the signup on that plan as soon as the page loads
 *   ?at=<stage>       start part-way through: payment | build | done, or
 *                     recover (paid, but the business details were lost)
 *   ?carry=<CODE>     arrive carrying a promo / referral code, like /r/<CODE> does
 *
 * Magic inputs (mock only): code 111111 / 222222 / 333333 on the code screen
 * are wrong / expired / locked; a password containing "wrong" fails to sign in;
 * the promo codes in MOCK_PROMO_CODES answer without asking the server.
 *
 * The signup in progress lives in sessionStorage, so a new tab is always a
 * fresh start, and a refresh puts you back on the same screen (including the
 * finished one). Closing the finished screen ends the run.
 */

import type { ProvisionMilestone } from "./onboarding-types";
import { isSignupPlanId, SIGNUP_PLANS } from "@/lib/plans";
import type { PromoOffer } from "@/lib/promo-offer";
import { normalizeReferralCode, REFERRAL_COOKIE } from "@/lib/referral-cookie";

const IS_DEV = process.env.NODE_ENV === "development";

/** The account the portal hand-off signs in as. */
export const MOCK_OWNER_EMAIL = "ilyasghulam35@gmail.com";

/** Stripe's TEST publishable key (the one /signup-preview uses). Never a live key. */
const MOCK_PUBLISHABLE_KEY =
  "pk_test_51OpazCHw4aNq4gdLwqocQbL63yx3IiQHUtQAUvR8oKI9zD2wLStLgx64lUOnmZ2y7TCgwayOM2rlr6K1oKman9Ht00Ecl9KJP9";

const OPT_OUT_KEY = "d247.signupMock.off";
const STORE_KEY = "d247.signupMock.state";
const SCENARIO_KEY = "d247.signupMock.scenario";
/** One-shot failures already spent this run, so "Try again" then works. */
const SPENT_KEY = "d247.signupMock.spent";
/** The provider's own key: the plan the signup screen reopens on after a load. */
const OPEN_PLAN_KEY = "d247.signup.openPlan";

const MILESTONES: ProvisionMilestone[] = [
  "validated",
  "payment_verified",
  "brand_ready",
  "workspace_created",
  "account_linked",
  "billing_ready",
  "subscription_linked",
  "site_published",
];
/** One fake milestone lands this often. The build screen paces itself on top. */
const MILESTONE_MS = 1500;
const TRIAL_DAYS = 14;

// ---------------------------------------------------------------------------
// On / off
// ---------------------------------------------------------------------------

let urlRead = false;

function readUrlSwitch(): void {
  if (urlRead || typeof window === "undefined") return;
  urlRead = true;
  try {
    const params = new URLSearchParams(window.location.search);
    const mock = params.get("mock");
    if (mock === "off") window.localStorage.setItem(OPT_OUT_KEY, "1");
    if (mock === "on") window.localStorage.removeItem(OPT_OUT_KEY);
    if (mock === "reset") {
      window.sessionStorage.removeItem(STORE_KEY);
      window.sessionStorage.removeItem(OPEN_PLAN_KEY);
      window.sessionStorage.removeItem(SCENARIO_KEY);
      window.sessionStorage.removeItem(SPENT_KEY);
      // A code carried in from an earlier run would otherwise ride along.
      document.cookie = `${REFERRAL_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
    }
    if (window.localStorage.getItem(OPT_OUT_KEY) === "1") return;

    const scenario = params.get("scenario");
    if (scenario === "none") window.sessionStorage.removeItem(SCENARIO_KEY);
    else if (scenario && scenario in MOCK_SCENARIOS) window.sessionStorage.setItem(SCENARIO_KEY, scenario);

    const carry = normalizeReferralCode(params.get("carry"));
    if (carry) document.cookie = `${REFERRAL_COOKIE}=${encodeURIComponent(carry)}; Max-Age=3600; Path=/; SameSite=Lax`;

    const plan = params.get("plan");
    const at = params.get("at");
    if (isSignupPlanId(plan)) {
      if (at === "payment" || at === "build" || at === "done" || at === "recover") seedAt(at, plan);
      // The provider reopens the signup on this plan when it mounts.
      window.sessionStorage.setItem(OPEN_PLAN_KEY, plan);
    }
  } catch {
    /* storage blocked: stay on the default */
  }
}

export function isMockSignup(): boolean {
  if (!IS_DEV || typeof window === "undefined") return false;
  readUrlSwitch();
  try {
    return window.localStorage.getItem(OPT_OUT_KEY) !== "1";
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// The fake server's state
// ---------------------------------------------------------------------------

type MockStatus = "account_created" | "payment_pending" | "paid" | "provisioning" | "provisioned";

interface MockStore {
  email: string;
  fullName: string;
  planId: string;
  status: MockStatus;
  signedIn: boolean;
  paid: boolean;
  business: Record<string, unknown> | null;
  userMetadata: Record<string, unknown>;
  provisionStartedAt: number | null;
}

function readStore(): MockStore | null {
  try {
    const raw = window.sessionStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as MockStore) : null;
  } catch {
    return null;
  }
}

function writeStore(next: MockStore | null): void {
  try {
    if (next) window.sessionStorage.setItem(STORE_KEY, JSON.stringify(next));
    else window.sessionStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
}

function patchStore(patch: Partial<MockStore>): MockStore | null {
  const current = readStore();
  if (!current) return null;
  const next = { ...current, ...patch };
  writeStore(next);
  return next;
}

// ---------------------------------------------------------------------------
// Scenarios: one switch per screen that only a failure (or a different plan
// set-up) can show. Listed, with how to reach each, at /dev/signup-states.
// ---------------------------------------------------------------------------

export const MOCK_SCENARIOS = {
  // Account
  "email-exists": "Create account answers: an account already exists for this email",
  "email-unverified": "Create account answers: this email started signing up and never entered its code",
  "email-disposable": "Create account answers: use a permanent business email",
  "begin-slug-taken": "Create account answers: the web address was taken a moment ago",
  "begin-rate-limited": "Create account answers: too many attempts",
  "begin-network": "Create account cannot reach the server",
  // Payment
  "pay-today": "The plan has no free trial: the card is charged today",
  "intent-fail": "The card form cannot be prepared (Stripe unavailable)",
  "intent-network": "The card form cannot be prepared (no connection)",
  "session-lost": "The session expires on the card step",
  "card-declined": "The card is declined",
  "card-auth-failed": "The bank's 3-D Secure check fails",
  "card-stripe-down": "Stripe cannot be reached when Subscribe is pressed",
  // Build
  "build-fail": "The build fails once (Try again then works)",
  "build-slug-taken": "The build finds the web address taken (Edit details)",
  "build-payment-required": "The build finds no confirmed payment and sends you back to the card",
  "build-stall": "The build stops moving (the 90-second 'taking longer' panel)",
  "done-unseeded": "Finished, but some booking-site pages still show default copy",
  "done-no-link": "Finished, without the one-click sign-in link",
} as const;

export type MockScenario = keyof typeof MOCK_SCENARIOS;

export function mockScenario(): MockScenario | null {
  try {
    const value = window.sessionStorage.getItem(SCENARIO_KEY);
    return value && value in MOCK_SCENARIOS ? (value as MockScenario) : null;
  } catch {
    return null;
  }
}

/** True the first time a one-shot failure is asked for in this run, false after. */
function spendOnce(name: string): boolean {
  try {
    const spent = new Set<string>(JSON.parse(window.sessionStorage.getItem(SPENT_KEY) ?? "[]"));
    if (spent.has(name)) return false;
    spent.add(name);
    window.sessionStorage.setItem(SPENT_KEY, JSON.stringify([...spent]));
    return true;
  } catch {
    return true;
  }
}

/**
 * The card outcome the payment step should show instead of succeeding, for the
 * two failures only Stripe itself can produce. Null = the card goes through.
 */
export function mockCardOutcome(): "CARD_DECLINED" | "CARD_AUTH_FAILED" | null {
  const scenario = mockScenario();
  if (scenario === "card-declined") return "CARD_DECLINED";
  if (scenario === "card-auth-failed") return "CARD_AUTH_FAILED";
  return null;
}

/** A believable business for runs that start part-way through. */
const SEED_BUSINESS = {
  companyName: "Harbor Car Rentals",
  slug: "harbor-car-rentals",
  acceptedTerms: true,
};

/** Starts a run already signed in, at the card, the build or the finish. */
function seedAt(at: "payment" | "build" | "done" | "recover", planId: string): void {
  const paid = at !== "payment";
  writeStore({
    email: MOCK_OWNER_EMAIL,
    fullName: "Jordan Miller",
    planId,
    status: at === "payment" ? "account_created" : at === "done" ? "provisioned" : "paid",
    signedIn: true,
    paid,
    business: at === "recover" ? null : SEED_BUSINESS,
    // Where the provider looks for the business once paid (tenant-draft.ts):
    // without it, the build asks for the details again ("One last thing").
    userMetadata: at === "recover" ? {} : { d247_tenant_draft: { v: 1, ...SEED_BUSINESS } },
    provisionStartedAt: at === "done" ? Date.now() - 60_000 : null,
  });
}

// ---------------------------------------------------------------------------
// Promo and referral codes
// ---------------------------------------------------------------------------

function offer(
  displayCode: string,
  kind: PromoOffer["kind"],
  discountType: PromoOffer["discountType"],
  discountValue: number,
  duration: PromoOffer["duration"],
  durationMonths: number | null,
  referrerName: string | null = null,
): PromoOffer {
  // The same wording promo-code-lookup builds (_shared/platform-promo-rules.ts).
  const discountText = discountType === "percent" ? `${discountValue}% off` : `$${discountValue} off`;
  const durationText =
    duration === "once"
      ? "on your first bill"
      : duration === "forever"
        ? "on every bill"
        : durationMonths === 1
          ? "for your first month"
          : `for your first ${durationMonths} months`;
  return {
    kind,
    displayCode,
    discountText,
    durationText,
    referrerName,
    duration,
    durationMonths,
    discountType,
    discountValue,
    currency: "usd",
  };
}

/** Codes that work: one per shape of offer the payment step draws differently. */
export const MOCK_PROMO_CODES: Record<string, PromoOffer> = {
  SAVE20: offer("SAVE20", "campaign", "percent", 20, "repeating", 3),
  SAVE15: offer("SAVE15", "campaign", "percent", 15, "repeating", 2),
  HALFOFF: offer("HALFOFF", "campaign", "percent", 50, "once", null),
  FLAT50: offer("FLAT50", "campaign", "fixed", 50, "once", null),
  FOREVER10: offer("FOREVER10", "campaign", "percent", 10, "forever", null),
  FREEMONTH: offer("FREEMONTH", "campaign", "percent", 100, "once", null),
  "REF-SUNSET": offer("REF-SUNSET", "referral", "percent", 20, "repeating", 3, "Sunset Rentals"),
  "REF-PRIVATE": offer("REF-PRIVATE", "referral", "fixed", 25, "once", null),
};

/** Codes that are refused: one per reason promo-code-lookup can give. */
export const MOCK_REFUSED_CODES: Record<string, string> = {
  NOSUCHCODE: "not_found",
  EXPIRED: "expired",
  MAXEDOUT: "maxed_out",
  RETIRED: "inactive",
  PLANONLY: "plan_not_eligible",
  REFPAUSED: "programme_disabled",
  OWNEROFF: "owner_disabled",
  MYOWNCODE: "self_referral",
  NOTNEW: "not_new_operator",
  REFERRED: "already_referred",
  ONECODE: "one_code_per_checkout",
  TOOMANY: "rate_limited",
  LOOKUPDOWN: "unavailable",
};

/** The plan's price and trial as the live catalogue has them (a public read), else the built-in ones. */
async function planTerms(planId: string): Promise<{ amountCents: number; trialDays: number }> {
  const fallback = SIGNUP_PLANS.find((p) => p.id === planId) ?? SIGNUP_PLANS[0];
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (base && key) {
    try {
      const res = await fetch(
        `${base.replace(/\/$/, "")}/rest/v1/signup_plans?select=amount_cents,trial_days&plan_key=eq.${encodeURIComponent(planId)}`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } },
      );
      const rows = (await res.json()) as Array<{ amount_cents?: number; trial_days?: number }>;
      const row = Array.isArray(rows) ? rows[0] : undefined;
      if (row && typeof row.amount_cents === "number") {
        return { amountCents: row.amount_cents, trialDays: row.trial_days ?? TRIAL_DAYS };
      }
    } catch {
      /* offline: the built-in catalogue */
    }
  }
  return { amountCents: fallback.amountCents, trialDays: TRIAL_DAYS };
}

function discountedCents(listCents: number, o: PromoOffer): number {
  const off = o.discountType === "percent" ? (listCents * o.discountValue) / 100 : o.discountValue * 100;
  return Math.max(0, Math.round(listCents - off));
}

/** Ends the run: the next one starts from the top. */
export function mockResetSignup(): void {
  writeStore(null);
}

/** Called by the payment step once the (test) card form validates. */
export function mockMarkPaid(): void {
  // The step reads a throw here as Stripe being unreachable.
  if (mockScenario() === "card-stripe-down") throw new Error("mock: Stripe unreachable");
  patchStore({ paid: true, status: "paid" });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** A believable network beat, so spinners and busy states are actually seen. */
const beat = () => sleep(450 + Math.random() * 350);

/** Advances the fake build by the clock, the way the real milestones arrive. */
function provisionProgress(store: MockStore): { done: ProvisionMilestone[]; finished: boolean } {
  if (store.status === "provisioned") return { done: [...MILESTONES], finished: true };
  if (store.status !== "provisioning" || !store.provisionStartedAt) return { done: [], finished: false };
  const elapsed = Date.now() - store.provisionStartedAt;
  let n = Math.min(MILESTONES.length, Math.floor(elapsed / MILESTONE_MS) + 1);
  // Stopped for good, so the watchdog's "taking longer" panel appears.
  if (mockScenario() === "build-stall") n = Math.min(n, 3);
  return { done: MILESTONES.slice(0, n), finished: n >= MILESTONES.length };
}

function settleIfFinished(store: MockStore): MockStore {
  const { finished } = provisionProgress(store);
  if (finished && store.status !== "provisioned") {
    return patchStore({ status: "provisioned" }) ?? store;
  }
  return store;
}

function slugOf(store: MockStore): string {
  const slug = store.business?.slug;
  return typeof slug === "string" && slug ? slug : "your-business";
}

function resultOf(store: MockStore) {
  const slug = slugOf(store);
  return {
    tenantId: "mock-tenant",
    slug,
    companyName: String(store.business?.companyName ?? "Your business"),
    portalUrl: `https://${slug}.portal.drive-247.com`,
    bookingUrl: `https://${slug}.drive-247.com`,
    portalSignInUrl:
      mockScenario() === "done-no-link" ? null : `${window.location.origin}/api/dev/mock-signup-handoff`,
    contentSeeded: mockScenario() !== "done-unseeded",
  };
}

function metaOf(store: MockStore) {
  const live = settleIfFinished(store);
  const { done } = provisionProgress(live);
  const result = live.status === "provisioned" ? resultOf(live) : null;
  return {
    v: 1,
    status: live.status,
    planId: live.planId,
    fullName: live.fullName,
    email: live.email,
    mode: "test" as const,
    stripeCustomerId: "cus_mock",
    stripeSubscriptionId: "sub_mock",
    business: live.business ?? undefined,
    milestones: done,
    ...(result ?? {}),
  };
}

// ---------------------------------------------------------------------------
// The edge functions
// ---------------------------------------------------------------------------

/** Thrown shape the api module turns into an OnboardingApiError. */
export class MockFunctionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/**
 * Answers a `signup-*` call. Returns `undefined` for anything that should go
 * to the real server (read-only lookups).
 */
export async function mockFunction(name: string, body: unknown): Promise<unknown | undefined> {
  const b = (body ?? {}) as Record<string, unknown>;
  const scenario = mockScenario();

  switch (name) {
    case "signup-begin": {
      await beat();
      if (scenario === "begin-network" && spendOnce(scenario)) {
        throw new MockFunctionError("NETWORK", "Could not reach the server.");
      }
      if (scenario === "begin-rate-limited" && spendOnce(scenario)) {
        throw new MockFunctionError("RATE_LIMITED", "Too many attempts.");
      }
      if (scenario === "email-disposable" && spendOnce(scenario)) {
        throw new MockFunctionError("EMAIL_DISPOSABLE", "Disposable email.", { field: "email" });
      }
      if (scenario === "begin-slug-taken" && spendOnce(scenario)) {
        const slug = String(b.slug ?? "your-business");
        throw new MockFunctionError("SLUG_TAKEN", "That web address is taken.", {
          field: "slug",
          slug,
          reason: "taken",
          suggestions: [`${slug}-rentals`, `${slug}-hire`, `${slug}-2`],
        });
      }
      if (scenario === "email-exists" || scenario === "email-unverified") {
        // The account is "already there": signed out, so the sign-in panel
        // can sign straight into it with any password not containing "wrong".
        writeStore({
          email: String(b.email ?? "").trim().toLowerCase(),
          fullName: String(b.fullName ?? ""),
          planId: String(b.planId ?? ""),
          status: "account_created",
          signedIn: false,
          paid: false,
          business: null,
          userMetadata: {},
          provisionStartedAt: null,
        });
        throw new MockFunctionError("EMAIL_EXISTS_SIGN_IN", "An account already exists.", { field: "email" });
      }
      writeStore({
        email: String(b.email ?? "").trim().toLowerCase(),
        fullName: String(b.fullName ?? ""),
        planId: String(b.planId ?? ""),
        status: "account_created",
        signedIn: false,
        paid: false,
        business: null,
        userMetadata: {},
        provisionStartedAt: null,
      });
      return {
        success: true,
        email: String(b.email ?? "").trim().toLowerCase(),
        planId: b.planId,
        stage: "account_created",
        requiresVerification: true,
      };
    }

    case "signup-verify-otp": {
      await beat();
      if (b.action === "resend") {
        // A confirmed account has no code to resend, which is how the provider
        // tells "sign in instead" from "finish your code".
        if (scenario === "email-exists") return { ok: false, code: "NOT_PENDING", error: "No code pending." };
        return { ok: true, resent: true };
      }
      // Any six digits will do, except three that show the failures. The
      // wording is signup-verify-otp's own.
      if (b.code === "111111") {
        return { ok: false, code: "OTP_INVALID", attemptsRemaining: 4, error: "That code is not right. 4 attempts left." };
      }
      if (b.code === "222222") {
        return { ok: false, code: "OTP_EXPIRED", error: "That code has expired. Ask for a new one." };
      }
      if (b.code === "333333") {
        return { ok: false, code: "OTP_LOCKED", error: "Too many attempts. Ask for a new code." };
      }
      return { ok: true, verified: true };
    }

    case "signup-begin-oauth": {
      await beat();
      const store = patchStore({ planId: String(b.planId ?? ""), status: "account_created" });
      return {
        success: true,
        email: store?.email ?? MOCK_OWNER_EMAIL,
        planId: b.planId,
        stage: "account_created",
      };
    }

    case "signup-resume": {
      await beat();
      const store = readStore();
      if (!store || !store.signedIn) return { success: true, signup: null };
      const live = settleIfFinished(store);
      const resumeStep =
        live.status === "provisioned"
          ? "done"
          : live.status === "provisioning"
            ? "provisioning"
            : live.paid
              ? "business"
              : "payment";
      return {
        success: true,
        signup: {
          planId: live.planId,
          fullName: live.fullName,
          email: live.email,
          paid: live.paid,
          stripeCustomerId: "cus_mock",
          stripeSubscriptionId: live.paid ? "sub_mock" : null,
          mode: "test",
          resumeStep,
          business: live.business,
          milestones: provisionProgress(live).done,
          result: live.status === "provisioned" ? { success: true, ...resultOf(live), milestones: [...MILESTONES] } : null,
          lastError: null,
        },
      };
    }

    case "signup-slug-check": {
      // Real availability, read-only, through the same public read the
      // pre-session field already uses.
      const { slugAvailabilityAnon } = await import("./onboarding-api");
      const res = await slugAvailabilityAnon(String(b.slug ?? ""));
      return { success: true, ...res };
    }

    case "signup-payment-intent":
    case "signup-payment-intent-v2": {
      await beat();
      if (scenario === "intent-fail" && spendOnce(scenario)) {
        throw new MockFunctionError("STRIPE_UNAVAILABLE", "Stripe unavailable.");
      }
      if (scenario === "intent-network" && spendOnce(scenario)) {
        throw new MockFunctionError("NETWORK", "Could not reach the server.");
      }
      if (scenario === "session-lost" && spendOnce(scenario)) {
        patchStore({ signedIn: false });
        throw new MockFunctionError("SESSION_LOST", "Session lost.");
      }
      const store = readStore();
      const planId = String(b.planId ?? store?.planId ?? "");

      // A code arriving with the request: answered from the table, the way
      // signup-payment-intent-v2 answers — refused ones with PROMO_INVALID.
      const code = typeof b.promoCode === "string" ? b.promoCode.toUpperCase() : null;
      if (code && MOCK_REFUSED_CODES[code]) {
        throw new MockFunctionError("PROMO_INVALID", "Promo code refused.", { reason: MOCK_REFUSED_CODES[code] });
      }
      const promo = code ? (MOCK_PROMO_CODES[code] ?? null) : null;

      if (store && !store.paid) patchStore({ status: "payment_pending" });
      const terms = await planTerms(planId);
      const trial = scenario !== "pay-today" && terms.trialDays > 0;
      const trialDays = trial ? terms.trialDays : 0;
      return {
        success: true,
        clientSecret: store?.paid ? null : "mock_seti_secret",
        publishableKey: MOCK_PUBLISHABLE_KEY,
        stripeCustomerId: "cus_mock",
        stripeSubscriptionId: "sub_mock",
        // Stripe's first invoice: nothing today on a trial, the discounted
        // price when a code applies, the plan price otherwise.
        amountCents: trial ? 0 : promo ? discountedCents(terms.amountCents, promo) : terms.amountCents,
        listAmountCents: terms.amountCents,
        currency: "usd",
        mode: "test",
        alreadyPaid: Boolean(store?.paid),
        promo,
        intentType: trial ? "setup" : "payment",
        trialDays,
        trialEndsAt: trial ? new Date(Date.now() + trialDays * 86_400_000).toISOString() : null,
      };
    }

    case "signup-provision": {
      const store = patchStore({
        business: b,
        status: "provisioning",
        provisionStartedAt: Date.now(),
      });
      if (!store) throw new MockFunctionError("SIGNUP_NOT_FOUND", "No signup in progress.");
      if (scenario === "build-fail" && spendOnce(scenario)) {
        await sleep(3 * MILESTONE_MS);
        patchStore({ status: "paid", provisionStartedAt: null });
        throw new MockFunctionError("INTERNAL", "The build failed.");
      }
      if (scenario === "build-slug-taken" && spendOnce(scenario)) {
        await sleep(2 * MILESTONE_MS);
        patchStore({ status: "paid", provisionStartedAt: null });
        const slug = String(b.slug ?? "your-business");
        throw new MockFunctionError("SLUG_TAKEN", "That web address is taken.", {
          field: "slug",
          slug,
          reason: "taken",
          suggestions: [`${slug}-rentals`, `${slug}-hire`, `${slug}-2`],
        });
      }
      if (scenario === "build-payment-required" && spendOnce(scenario)) {
        await sleep(MILESTONE_MS);
        patchStore({ status: "payment_pending", paid: false, provisionStartedAt: null });
        throw new MockFunctionError("PAYMENT_REQUIRED", "No confirmed payment.");
      }
      if (scenario === "build-stall") {
        // Never answers: the screen's own watchdog decides, as it would live.
        await new Promise<never>(() => {});
      }
      await sleep(MILESTONES.length * MILESTONE_MS + 200);
      const done = patchStore({ status: "provisioned" }) ?? store;
      return { success: true, ...resultOf(done), milestones: [...MILESTONES] };
    }

    case "signup-password-reset": {
      await beat();
      if (b.action === "complete" && b.code === "111111") {
        throw new MockFunctionError("RESET_CODE_INVALID", "That code is not valid.");
      }
      if (b.action === "complete") {
        // The account now exists with the new password, signed out.
        const email = String(b.email ?? "").trim().toLowerCase();
        if (!readStore()) {
          writeStore({
            email,
            fullName: "Jordan Miller",
            planId: "",
            status: "account_created",
            signedIn: false,
            paid: false,
            business: null,
            userMetadata: {},
            provisionStartedAt: null,
          });
        }
      }
      return { ok: true };
    }

    case "promo-code-lookup": {
      const code = String(b.code ?? "").toUpperCase();
      if (MOCK_PROMO_CODES[code]) {
        await beat();
        return { valid: true, ...MOCK_PROMO_CODES[code] };
      }
      if (MOCK_REFUSED_CODES[code]) {
        await beat();
        return { valid: false, reason: MOCK_REFUSED_CODES[code] };
      }
      // Any other code: the real, read-only lookup.
      return undefined;
    }

    default:
      // Anything else read-only: the real server.
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Supabase Auth
// ---------------------------------------------------------------------------

function mockUser(store: MockStore) {
  return {
    id: "mock-user",
    aud: "authenticated",
    email: store.email,
    app_metadata: { d247_signup: metaOf(store) },
    user_metadata: store.userMetadata,
    created_at: new Date().toISOString(),
  };
}

function mockSession(store: MockStore) {
  return {
    access_token: "mock-access-token",
    refresh_token: "mock-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: mockUser(store),
  };
}

const noSession = { message: "Auth session missing!", name: "AuthSessionMissingError", status: 400 };

/** The handful of auth methods the signup uses. Anything else falls through to the real client. */
export function createMockAuth(realAuth: object): object {
  const fake: Record<string, (...args: never[]) => unknown> = {
    async getSession() {
      const store = readStore();
      return { data: { session: store?.signedIn ? mockSession(store) : null }, error: null };
    },
    async getUser() {
      const store = readStore();
      if (!store?.signedIn) return { data: { user: null }, error: noSession };
      return { data: { user: mockUser(store) }, error: null };
    },
    async signInWithPassword({ email, password }: { email: string; password: string }) {
      await beat();
      const store = readStore();
      if (!store || store.email !== email.trim().toLowerCase() || /wrong/i.test(password)) {
        return {
          data: { user: null, session: null },
          error: { message: "Invalid login credentials", name: "AuthApiError", status: 400 },
        };
      }
      const next = patchStore({ signedIn: true })!;
      return { data: { user: mockUser(next), session: mockSession(next) }, error: null };
    },
    async signOut() {
      patchStore({ signedIn: false });
      return { error: null };
    },
    async updateUser({ data }: { data?: Record<string, unknown> }) {
      const store = readStore();
      if (!store?.signedIn) return { data: { user: null }, error: noSession };
      const next = patchStore({ userMetadata: { ...store.userMetadata, ...(data ?? {}) } })!;
      return { data: { user: mockUser(next) }, error: null };
    },
    async signInWithOAuth({ options }: { provider: string; options?: { redirectTo?: string } }) {
      // Pretend Google / Apple picked the rehearsal account and came straight back.
      writeStore({
        email: MOCK_OWNER_EMAIL,
        fullName: "Ghulam",
        planId: "",
        status: "account_created",
        signedIn: false,
        paid: false,
        business: null,
        userMetadata: {},
        provisionStartedAt: null,
      });
      await sleep(600);
      const back = options?.redirectTo ?? window.location.href;
      window.location.assign(`${back}${back.includes("?") ? "&" : "?"}code=mock`);
      return { data: { provider: "google", url: back }, error: null };
    },
    async exchangeCodeForSession() {
      const next = patchStore({ signedIn: true });
      if (!next) return { data: { session: null, user: null }, error: noSession };
      return { data: { session: mockSession(next), user: mockUser(next) }, error: null };
    },
  };

  return new Proxy(realAuth, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && prop in fake) return fake[prop];
      return Reflect.get(target, prop, receiver);
    },
  });
}

// Read the URL switches as soon as this module loads (it is imported by the
// signup provider), so ?plan= and ?at= are in storage before the provider's
// mount effect looks for a screen to reopen.
if (IS_DEV && typeof window !== "undefined") readUrlSwitch();
