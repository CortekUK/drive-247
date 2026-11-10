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
 * The signup in progress lives in sessionStorage, so a new tab is always a
 * fresh start, and a refresh puts you back on the same screen (including the
 * finished one). Closing the finished screen ends the run.
 */

import type { ProvisionMilestone } from "./onboarding-types";

const IS_DEV = process.env.NODE_ENV === "development";

/** The account the portal hand-off signs in as. */
export const MOCK_OWNER_EMAIL = "ilyasghulam35@gmail.com";

/** Stripe's TEST publishable key (the one /signup-preview uses). Never a live key. */
const MOCK_PUBLISHABLE_KEY =
  "pk_test_51OpazCHw4aNq4gdLwqocQbL63yx3IiQHUtQAUvR8oKI9zD2wLStLgx64lUOnmZ2y7TCgwayOM2rlr6K1oKman9Ht00Ecl9KJP9";

const OPT_OUT_KEY = "d247.signupMock.off";
const STORE_KEY = "d247.signupMock.state";

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
      window.sessionStorage.removeItem("d247.signup.openPlan");
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

/** Ends the run: the next one starts from the top. */
export function mockResetSignup(): void {
  writeStore(null);
}

/** Called by the payment step once the (test) card form validates. */
export function mockMarkPaid(): void {
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
  const n = Math.min(
    MILESTONES.length,
    Math.floor((Date.now() - store.provisionStartedAt) / MILESTONE_MS) + 1,
  );
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
    portalSignInUrl: `${window.location.origin}/api/dev/mock-signup-handoff`,
    contentSeeded: true,
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

  switch (name) {
    case "signup-begin": {
      await beat();
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
      if (b.action === "resend") return { ok: true, resent: true };
      // Any six digits will do.
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
      const store = readStore();
      if (store && !store.paid) patchStore({ status: "payment_pending" });
      return {
        success: true,
        clientSecret: store?.paid ? null : "mock_seti_secret",
        publishableKey: MOCK_PUBLISHABLE_KEY,
        stripeCustomerId: "cus_mock",
        stripeSubscriptionId: "sub_mock",
        amountCents: 0,
        currency: "usd",
        mode: "test",
        alreadyPaid: Boolean(store?.paid),
        intentType: "setup",
        trialDays: TRIAL_DAYS,
        trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000).toISOString(),
      };
    }

    case "signup-provision": {
      const store = patchStore({
        business: b,
        status: "provisioning",
        provisionStartedAt: Date.now(),
      });
      if (!store) throw new MockFunctionError("SIGNUP_NOT_FOUND", "No signup in progress.");
      await sleep(MILESTONES.length * MILESTONE_MS + 200);
      const done = patchStore({ status: "provisioned" }) ?? store;
      return { success: true, ...resultOf(done), milestones: [...MILESTONES] };
    }

    case "signup-password-reset": {
      await beat();
      return { ok: true };
    }

    default:
      // promo-code-lookup and anything else read-only: the real server.
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
    async signInWithPassword({ email }: { email: string; password: string }) {
      await beat();
      const store = readStore();
      if (!store || store.email !== email.trim().toLowerCase()) {
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
