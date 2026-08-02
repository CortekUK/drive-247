"use client";

import type { SignupPlanId } from "@/lib/plans";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import {
  SIGNUP_ERROR_COPY,
  type OnboardingError,
  type ProvisionMilestone,
  type SignupErrorCode,
  type SlugCheckResult,
} from "./onboarding-types";

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------
export interface SignupBeginRequest {
  fullName: string;
  email: string;
  password: string;
  planId: SignupPlanId;
  companyWebsite?: string;
  formStartedAt?: number;
}
export interface SlugCheckRequest {
  slug: string;
  companyName?: string;
}
export interface PaymentIntentRequest {
  planId: SignupPlanId;
}
export interface ProvisionRequest {
  companyName: string;
  slug: string;
  location?: string;
  businessPhone?: string;
  fleetSize?: string;
  vehicleType?: string;
  businessColours?: string;
  logoUrl?: string;
  operatingSchedule?: {
    alwaysOpen?: boolean;
    days?: string[];
    opensAt?: string;
    closesAt?: string;
  };
  acceptedTerms: boolean;
}

// ---------------------------------------------------------------------------
// Response bodies
// ---------------------------------------------------------------------------
export interface SignupBeginResponse {
  success: true;
  email: string;
  planId: SignupPlanId;
  stage: "account_created";
}
export interface SlugCheckResponse extends SlugCheckResult {
  success: true;
}
export interface PaymentIntentResponse {
  success: true;
  /** null when alreadyPaid is true. */
  clientSecret: string | null;
  publishableKey: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  amountCents: number;
  currency: "usd";
  mode: "test" | "live";
  alreadyPaid: boolean;
}
export interface ResumeSignupDTO {
  planId: SignupPlanId;
  fullName: string;
  email: string;
  /** Re-verified against Stripe on every call. Never read from metadata alone. */
  paid: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  mode: "test" | "live";
  resumeStep: "account" | "payment" | "business" | "provisioning" | "done";
  business: ProvisionRequest | null;
  milestones: ProvisionMilestone[];
  result: ProvisionResponse | null;
  lastError: { code: SignupErrorCode; message: string } | null;
}
export interface SignupResumeResponse {
  success: true;
  /** null when this authenticated user has no in-flight signup. */
  signup: ResumeSignupDTO | null;
}
export interface ProvisionResponse {
  success: true;
  tenantId: string;
  slug: string;
  companyName: string;
  portalUrl: string;
  bookingUrl: string;
  portalSignInUrl: string | null;
  contentSeeded: boolean;
  milestones: ProvisionMilestone[];
}

/** The envelope every signup function returns on failure. */
export interface SignupErrorBody {
  error: string;
  code: SignupErrorCode;
  detail?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Error plumbing
// ---------------------------------------------------------------------------

/**
 * Thrown by every function in this module. It is a real `Error` subclass (not a
 * thrown object literal) so a stack survives, `instanceof` works across the
 * provider's many catch sites, and nothing trips `no-throw-literal`.
 */
export class OnboardingApiError extends Error implements OnboardingError {
  readonly code: SignupErrorCode;
  readonly detail?: Record<string, unknown>;

  constructor(code: SignupErrorCode, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = "OnboardingApiError";
    this.code = code;
    this.detail = detail;
  }
}

/**
 * The set of codes this build knows how to talk about. A server that ships a
 * NEWER code than this bundle must not be able to make the UI render an unknown
 * key of SIGNUP_ERROR_COPY (which would be `undefined` and paint a blank
 * banner) — unknown codes fall back to the HTTP status mapping below and keep
 * the server's own `error` string as the message.
 */
const KNOWN_ERROR_CODES = new Set<string>(Object.keys(SIGNUP_ERROR_COPY));

function isKnownCode(code: unknown): code is SignupErrorCode {
  return typeof code === "string" && KNOWN_ERROR_CODES.has(code);
}

/**
 * Last-resort mapping when a response carries no code we recognise. Note what
 * is deliberately absent: 404 is NOT mapped to SIGNUP_NOT_FOUND. A 404 from the
 * Functions gateway means "function not deployed" and carries a numeric `code`,
 * and telling a user "we couldn't find a signup in progress" when the endpoint
 * simply does not exist sends support down the wrong path.
 */
function codeFromStatus(status: number): SignupErrorCode {
  if (status === 401 || status === 403) return "UNAUTHENTICATED";
  if (status === 429) return "RATE_LIMITED";
  if (status === 502 || status === 503 || status === 504) return "STRIPE_UNAVAILABLE";
  return "INTERNAL";
}

/**
 * Normalises anything thrown anywhere in the flow — our own API errors, Stripe.js
 * errors already shaped as OnboardingError by the payment step, `TypeError:
 * Failed to fetch`, an AbortError from a timeout, the legible env-var Error from
 * getBrowserSupabase — into the one shape the UI branches on.
 */
export function toOnboardingError(e: unknown): OnboardingError {
  if (e instanceof OnboardingApiError) {
    return { code: e.code, message: e.message, detail: e.detail };
  }
  // A plain object that already carries a valid code (e.g. B3 handing a
  // CARD_DECLINED up from Stripe.js).
  if (e && typeof e === "object" && isKnownCode((e as { code?: unknown }).code)) {
    const err = e as { code: SignupErrorCode; message?: unknown; detail?: unknown };
    return {
      code: err.code,
      message: typeof err.message === "string" ? err.message : SIGNUP_ERROR_COPY[err.code],
      detail:
        err.detail && typeof err.detail === "object"
          ? (err.detail as Record<string, unknown>)
          : undefined,
    };
  }
  if (e instanceof DOMException && e.name === "AbortError") {
    return { code: "NETWORK", message: SIGNUP_ERROR_COPY.NETWORK };
  }
  if (e instanceof TypeError) {
    // `fetch` rejects with a TypeError for DNS failures, offline, and CORS.
    return { code: "NETWORK", message: SIGNUP_ERROR_COPY.NETWORK };
  }
  const message = e instanceof Error && e.message ? e.message : SIGNUP_ERROR_COPY.INTERNAL;
  return { code: "INTERNAL", message };
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/**
 * Read once per call rather than at module scope: `getBrowserSupabase()` and
 * this both throw when the env is missing, and edge case 38 requires the pricing
 * section to keep rendering in that state — only pressing Subscribe may fail.
 * A module-scope throw would take the whole section down at import time.
 */
function supabaseEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return { url, anonKey };
}

type AuthMode = "anon" | "session";

interface CallOptions {
  /** Abort after this long. Every call has one — a hung request with no timeout is an infinite spinner. */
  timeoutMs: number;
  auth: AuthMode;
  /**
   * Extra attempts granted to TRANSPORT failures only (no response at all, or a
   * 5xx). Non-zero is reserved for calls that are pure reads — retrying a write
   * that may already have landed is how you get two Stripe subscriptions.
   */
  retries?: number;
  /**
   * While a call with this key is in flight, an identical call returns the SAME
   * promise instead of issuing a second request. This is the double-submit guard
   * for every mutating endpoint: the UI's `disabled={busy}` covers the common
   * case, two tabs and a stray keyboard Enter do not.
   */
  dedupeKey?: string;
}

const inFlight = new Map<string, Promise<unknown>>();

async function authHeaders(auth: AuthMode): Promise<Record<string, string>> {
  const { anonKey } = supabaseEnv();
  if (auth === "anon") {
    return { Authorization: `Bearer ${anonKey}`, apikey: anonKey };
  }
  // getSession() transparently refreshes an expired token; if it still cannot
  // produce one the session is genuinely gone and we must not burn a request.
  const { data, error } = await getBrowserSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (error || !token) {
    throw new OnboardingApiError("SESSION_LOST", SIGNUP_ERROR_COPY.SESSION_LOST);
  }
  return { Authorization: `Bearer ${token}`, apikey: anonKey };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestOnce<T>(
  name: string,
  body: unknown,
  opts: CallOptions,
): Promise<T> {
  const { url } = supabaseEnv();
  const headers = await authHeaders(opts.auth);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${url}/functions/v1/${name}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  // Parse before branching on status: the failure envelope IS the interesting
  // part of a non-2xx, and `functions.invoke` throwing it away is exactly why
  // this module uses raw fetch (spec §3.3 transport rules).
  const raw = await response.text();
  let parsed: unknown = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const envelope = (parsed ?? {}) as Partial<SignupErrorBody>;
    const code = isKnownCode(envelope.code)
      ? envelope.code
      : codeFromStatus(response.status);
    const message =
      typeof envelope.error === "string" && envelope.error
        ? envelope.error
        : SIGNUP_ERROR_COPY[code];
    throw new OnboardingApiError(code, message, envelope.detail);
  }

  if (parsed === null || typeof parsed !== "object") {
    // 2xx with a body we cannot read is a server bug, not a user error.
    throw new OnboardingApiError("INTERNAL", SIGNUP_ERROR_COPY.INTERNAL);
  }
  return parsed as T;
}

/** True when a failure is worth a second attempt: nothing reached the server, or the server was momentarily unhealthy. */
function isRetryable(err: OnboardingError): boolean {
  return err.code === "NETWORK" || err.code === "INTERNAL" || err.code === "STRIPE_UNAVAILABLE";
}

async function callFunction<T>(name: string, body: unknown, opts: CallOptions): Promise<T> {
  const run = async (): Promise<T> => {
    const attempts = 1 + (opts.retries ?? 0);
    let lastError: OnboardingError | null = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await requestOnce<T>(name, body, opts);
      } catch (e) {
        const err = toOnboardingError(e);
        lastError = err;
        if (attempt === attempts - 1 || !isRetryable(err)) break;
        // Exponential backoff with jitter so a flapping network does not turn
        // into a synchronised stampede from every open tab.
        await sleep(400 * 2 ** attempt + Math.random() * 200);
      }
    }
    const err = lastError ?? { code: "INTERNAL" as const, message: SIGNUP_ERROR_COPY.INTERNAL };
    throw new OnboardingApiError(err.code, err.message, err.detail);
  };

  if (!opts.dedupeKey) return run();

  const existing = inFlight.get(opts.dedupeKey) as Promise<T> | undefined;
  if (existing) return existing;

  const promise = run().finally(() => {
    inFlight.delete(opts.dedupeKey as string);
  });
  inFlight.set(opts.dedupeKey, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// The five endpoints
// ---------------------------------------------------------------------------

/**
 * Step 1. The only call made with the anon key as the bearer, because by
 * definition no user session exists until this returns.
 */
export function signupBegin(b: SignupBeginRequest): Promise<SignupBeginResponse> {
  return callFunction<SignupBeginResponse>("signup-begin", b, {
    auth: "anon",
    timeoutMs: 25_000,
    dedupeKey: `signup-begin:${b.email.trim().toLowerCase()}`,
  });
}

/**
 * Authoritative resume state. A pure read that re-verifies money against Stripe,
 * so it is both safe and worth retrying when the network hiccups.
 */
export function signupResume(): Promise<SignupResumeResponse> {
  return callFunction<SignupResumeResponse>(
    "signup-resume",
    {},
    { auth: "session", timeoutMs: 25_000, retries: 2, dedupeKey: "signup-resume" },
  );
}

/** Pure read. Debounced by the caller; deduped per slug here. */
export function signupSlugCheck(b: SlugCheckRequest): Promise<SlugCheckResponse> {
  return callFunction<SlugCheckResponse>("signup-slug-check", b, {
    auth: "session",
    timeoutMs: 15_000,
    retries: 1,
    dedupeKey: `signup-slug-check:${b.slug}`,
  });
}

/**
 * Creates (or re-uses) the Stripe Customer + incomplete Subscription. Not
 * auto-retried: it is server-side idempotent, but a silent second attempt makes
 * a Stripe-side failure indistinguishable from a client-side one in the logs.
 * The user retries explicitly via `onRetryIntent`.
 */
export function signupPaymentIntent(b: PaymentIntentRequest): Promise<PaymentIntentResponse> {
  return callFunction<PaymentIntentResponse>("signup-payment-intent", b, {
    auth: "session",
    timeoutMs: 30_000,
    dedupeKey: `signup-payment-intent:${b.planId}`,
  });
}

/**
 * Password recovery, step 1: ask for a code.
 *
 * ALWAYS resolves to `{ ok: true }` — the server returns the same envelope
 * whether the address is unknown, ineligible or fine, so the UI has nothing to
 * branch on and cannot become an existence oracle. Anon-authed by definition:
 * the whole premise is that the caller cannot sign in.
 *
 * Not retried. A retry on a timeout could mint a second code and invalidate the
 * one already in the user's inbox, which reads as "the code you were sent is
 * wrong". The user resends explicitly instead.
 */
export function signupResetRequest(email: string): Promise<{ ok: true }> {
  return callFunction<{ ok: true }>(
    "signup-password-reset",
    { action: "request", email: email.trim().toLowerCase() },
    {
      auth: "anon",
      timeoutMs: 25_000,
      dedupeKey: `signup-reset-request:${email.trim().toLowerCase()}`,
    },
  );
}

/**
 * Password recovery, step 2: verify the code AND set the new password in ONE
 * server call. There is deliberately no "verify only" endpoint — a client-side
 * gate followed by a separate password write is exactly the shape of the
 * platform's existing `reset-password-with-otp` hole.
 *
 * Never retried: it consumes the code, so a transparent second attempt would
 * always fail with RESET_CODE_INVALID and look like the user mistyped.
 *
 * NOT DEDUPED. `callFunction` returns the FIRST in-flight promise for a
 * matching key without inspecting the new body, so a bare constant key here
 * was a silent wrong-outcome bug: submit code+password A, close the dialog
 * while it hangs, reopen, submit the same code with password B — the second
 * call never leaves the browser, resolves with the first call's `{ok:true}`,
 * and the user is told "Password updated" for a password that was never set.
 * The server consumes the code, so a genuine duplicate fails safely on its own
 * and needs no client-side guard.
 */
export function signupResetComplete(b: {
  email: string;
  code: string;
  newPassword: string;
}): Promise<{ ok: true }> {
  return callFunction<{ ok: true }>(
    "signup-password-reset",
    {
      action: "complete",
      email: b.email.trim().toLowerCase(),
      code: b.code,
      newPassword: b.newPassword,
    },
    { auth: "anon", timeoutMs: 25_000 },
  );
}

/**
 * The long one. 3 minutes because it inserts a tenant, calls OpenAI, seeds ~10
 * CMS pages and makes several Stripe round trips; a shorter timeout would abort
 * a request that is still succeeding server-side. Even if this DOES time out the
 * work continues — the milestone poller is what actually decides the outcome
 * (edge case 41).
 */
export function signupProvision(b: ProvisionRequest): Promise<ProvisionResponse> {
  return callFunction<ProvisionResponse>("signup-provision", b, {
    auth: "session",
    timeoutMs: 180_000,
    dedupeKey: "signup-provision",
  });
}

// ---------------------------------------------------------------------------
// Reading the signup blob out of the user's own app_metadata
// ---------------------------------------------------------------------------

export type ClientSignupStatus =
  | "account_created"
  | "payment_pending"
  | "paid"
  | "provisioning"
  | "provisioned"
  | "failed";

/**
 * The browser-visible projection of `auth.users.raw_app_meta_data.d247_signup`
 * (written service-role-side by the signup functions — see spec §3.6).
 *
 * Everything here is a HINT used to pick a starting step and to drive the boot
 * screen. It is never treated as proof: `signup-resume` and `signup-provision`
 * both re-retrieve the subscription from Stripe before believing anything about
 * money. `app_metadata` (not `user_metadata`) is used precisely because the end
 * user cannot write it — but a hint is still all it is.
 */
export interface ClientSignupMeta {
  v: number;
  status: ClientSignupStatus;
  planId: string;
  fullName?: string;
  email?: string;
  mode?: "test" | "live";
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  business?: {
    companyName?: string;
    slug?: string;
    location?: string;
    businessPhone?: string;
    fleetSize?: string;
    vehicleType?: string;
    businessColours?: string;
    logoUrl?: string;
    operatingSchedule?: {
      alwaysOpen?: boolean;
      days?: string[];
      opensAt?: string;
      closesAt?: string;
    };
  };
  tenantId?: string;
  slug?: string;
  portalUrl?: string;
  bookingUrl?: string;
  portalSignInUrl?: string | null;
  contentSeeded?: boolean;
  milestones?: ProvisionMilestone[];
  lastError?: { code?: string; message?: string; at?: string };
}

const SIGNUP_STATUSES: ReadonlySet<string> = new Set<ClientSignupStatus>([
  "account_created",
  "payment_pending",
  "paid",
  "provisioning",
  "provisioned",
  "failed",
]);

/** Pull the signup blob off a GoTrue user object. Returns null when absent, malformed, or a foreign schema version. */
export function readSignupMeta(
  user: { app_metadata?: Record<string, unknown> | null } | null | undefined,
): ClientSignupMeta | null {
  const blob = user?.app_metadata?.["d247_signup"];
  if (!blob || typeof blob !== "object") return null;
  const meta = blob as Partial<ClientSignupMeta>;
  // A future version of the blob must be ignored rather than half-read: an old
  // bundle guessing at a new shape is how you resume someone onto the wrong step.
  if (meta.v !== 1) return null;
  if (typeof meta.status !== "string" || !SIGNUP_STATUSES.has(meta.status)) return null;
  return meta as ClientSignupMeta;
}

/**
 * Round-trips to GoTrue and returns the freshest signup blob.
 *
 * `getUser()`, never `getSession()`: the cached session holds the JWT that was
 * minted at sign-in, and `app_metadata` inside it is frozen at that moment. The
 * boot screen would therefore never see a single milestone. `getUser()` hits
 * `/auth/v1/user` and returns what the row actually says right now.
 *
 * Returns null (rather than throwing) when there is no session at all, so the
 * passive mount check on a first-time visitor costs nothing and logs nothing.
 */
export async function fetchSignupMeta(): Promise<ClientSignupMeta | null> {
  const { data, error } = await getBrowserSupabase().auth.getUser();
  if (error || !data.user) return null;
  return readSignupMeta(data.user);
}
