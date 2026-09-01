"use client";

import { useCallback, useState } from "react";
import { FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import type { DeliveryOption } from "@/lib/stores/booking-store";

/**
 * Asking the server to mint a PaymentIntent for this booking.
 *
 * THE ONE THING TO UNDERSTAND: the browser never decides what is charged. It
 * posts what the customer filled in and what they were SHOWN, and the edge
 * function re-prices from the database, creates the rental and returns a client
 * secret for an amount it computed itself. `quotedTotal` / `quotedDueNow` go up
 * only so the server can refuse a booking whose displayed price no longer
 * matches — they are evidence, not instructions.
 *
 * ── CONTRACT WITH `create-booking-payment-intent` ────────────────────────────
 * That function is a separate workstream and is NOT deployed yet, so this hook
 * is written to fail LOUDLY and specifically rather than hang. A 404 from the
 * functions gateway is reported as "not connected in this environment", which
 * is the truth, instead of a generic network error the next person has to
 * bisect.
 *
 * Response shape required (see `BookingPaymentIntentResponse`):
 *
 *   { clientSecret, publishableKey, connectAccountId, rentalNumber,
 *     amount?, currency?, documentsToken?, documentsUrl? }
 *
 * `connectAccountId` MUST be present, even as null. These are Connect DIRECT
 * charges: a secret minted on a connected account can only be confirmed by a
 * Stripe.js instance constructed with `{ stripeAccount }`, so an omitted field
 * is indistinguishable from "platform charge" and would silently produce a
 * confirm that always fails. A response missing the key is rejected here.
 */

/* ─────────────────────────────── the request ─────────────────────────────── */

export interface BookingPaymentIntentRequest {
  tenantId: string;
  vehicleId: string;

  pickup: { date: string; time: string };
  dropoff: { date: string; time: string };

  delivery: {
    option: DeliveryOption;
    pickupLocationId: string | null;
    returnLocationId: string | null;
    pickupAddress: string;
    returnAddress: string;
    sameAsPickup: boolean;
    /** The two fees the customer was shown, mirrored out of the live quote. */
    pickupFee: number;
    returnFee: number;
  };

  customer: {
    name: string;
    email: string;
    phone: string;
    /** 'YYYY-MM-DD'. */
    dateOfBirth: string;
    /** IANA zone, so a server-side lead-time re-check is reproducible. */
    timezone: string;
  };

  options: {
    /** extraId -> quantity, already clamped to what is bookable. */
    selectedExtras: Record<string, number>;
    addUnlimitedMileage: boolean;
    wantsInstallments: boolean;
    /** The APPLIED code, not what is sitting in the input. */
    promoCode: string | null;
  };

  consent: {
    agreeTerms: boolean;
    agreeCharges: boolean;
    smsConsent: boolean;
  };

  /**
   * INTEGER MINOR UNITS, and deliberately not the major-unit float the page
   * renders: `quote.grandTotal` is a plain JS number that really does come out
   * as 305.775, and a server comparing that against its own re-price would
   * disagree on the third decimal of a figure no card network can charge.
   * `computeQuote` rounds once, at the end, into `grandTotalCents` — that is the
   * only figure either side should reason about.
   */
  quotedTotalCents: number;
  /** Zero for an enquiry-style tenant, who is quoted but not charged here. */
  quotedDueNowCents: number;
  /** ISO 4217, upper case. */
  currency: string;
}

/* ─────────────────────────────── the response ────────────────────────────── */

export interface BookingPaymentIntentResponse {
  clientSecret: string;
  publishableKey: string;
  /** The connected account the intent lives on. Null = platform charge. */
  connectAccountId: string | null;
  /** `rentals.rental_number` — shown on the receipt line. Null if not issued. */
  rentalNumber: string | null;
  /** Minor units, what will actually be taken. Optional: display only. */
  amount: number | null;
  currency: string | null;

  /**
   * ── THE DOCUMENT-UPLOAD HANDOFF ──────────────────────────────────────────
   * A bearer token for `/booking/documents/<token>`, minted alongside the
   * PaymentIntent and good for SEVEN DAYS. Paying does NOT confirm a booking
   * any more: the customer still has to send a photo of their licence and a
   * selfie, an operator still has to approve it, and only then is the
   * confirmation email sent. This token is how the browser reaches that screen
   * without waiting for the email.
   *
   * `documentsUrl` is the same destination as an absolute URL, built by the
   * server from the request's own origin. Kept because the server, not the
   * browser, is the authority on which host a tenant's booking site is served
   * from; nothing in this app renders it today.
   *
   * ── WHY OPTIONAL, AND WHY THAT IS NOT LAZINESS ───────────────────────────
   * Two independent reasons, both load-bearing:
   *
   *   1. This shape is also constructed by
   *      `@/lib/stripe/create-balance-payment-intent` (:172-182), which settles
   *      an EXISTING booking's outstanding balance from the customer portal.
   *      That path has no documents step — the booking was made weeks ago — so
   *      it has nothing to put here, and making the field required would force
   *      a fabricated `null` into a file that has no business knowing this
   *      feature exists.
   *   2. `create-booking-payment-intent` gained these fields ADDITIVELY. Until
   *      that deploy lands, every response is missing them, and a parser that
   *      insisted on their presence would reject a perfectly good client
   *      secret and block payment outright.
   *
   * Consumers must therefore read it as `?? null` and must NEVER render a link
   * from a token they do not have.
   */
  documentsToken?: string | null;
  /** Absolute form of the same link. Display/telemetry only — see above. */
  documentsUrl?: string | null;
}

/* ──────────────────────────────── the states ─────────────────────────────── */

export type PaymentIntentFailureKind =
  /** The function is not deployed in this environment (404 from the gateway). */
  | "not-deployed"
  /** The function ran and refused — bad dates, price drift, vehicle taken. */
  | "rejected"
  /** Reached nothing: offline, DNS, CORS, aborted. */
  | "unreachable"
  /** It answered 2xx with a body we cannot use. */
  | "malformed";

export interface PaymentIntentFailure {
  kind: PaymentIntentFailureKind;
  /** Safe to render verbatim. */
  message: string;
  /** Whether offering "Try again" would be honest. */
  retryable: boolean;
  /** For the console, never for the customer. */
  detail: string | null;
}

export type PaymentIntentState =
  | { status: "idle" }
  | { status: "creating" }
  | { status: "ready"; intent: BookingPaymentIntentResponse }
  | { status: "failed"; failure: PaymentIntentFailure };

export interface UsePaymentIntentResult {
  state: PaymentIntentState;
  /** Mint an intent. Safe to call again to retry; the previous one is dropped. */
  create: (request: BookingPaymentIntentRequest) => Promise<void>;
  /** Back to `idle` — used when the payment panel closes. */
  reset: () => void;
}

/* ───────────────────────────── error narrowing ───────────────────────────── */

const FUNCTION_NAME = "create-booking-payment-intent";

/**
 * Pull the HTTP status off a Supabase Functions error.
 *
 * `FunctionsHttpError.context` is typed `any` by the SDK, and this app is
 * `strict: true` with no `any` allowed, so it is narrowed through `unknown` and
 * an `instanceof Response` check rather than asserted.
 */
function statusOf(error: unknown): number | null {
  if (!(error instanceof FunctionsHttpError) && !(error instanceof FunctionsRelayError)) {
    return null;
  }
  const context: unknown = error.context;
  return context instanceof Response ? context.status : null;
}

/** The function's own `{ error }` body, when it sent one we can show. */
async function readServerMessage(error: unknown): Promise<string | null> {
  if (!(error instanceof FunctionsHttpError)) return null;
  const context: unknown = error.context;
  if (!(context instanceof Response)) return null;

  try {
    // `.clone()` — invoke() throws before reading the body, but cloning keeps
    // this safe if that ever changes.
    const body: unknown = await context.clone().json();
    if (body !== null && typeof body === "object") {
      const record: Record<string, unknown> = { ...body };
      for (const key of ["error", "message"]) {
        const value = record[key];
        if (typeof value === "string" && value.trim() !== "") return value.trim();
      }
    }
  } catch {
    // Not JSON, or already consumed. No message to show.
  }
  return null;
}

function describe(error: unknown): string | null {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === "string") return error;
  return null;
}

/* ──────────────────────────── response parsing ───────────────────────────── */

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * Validate the payload before anything downstream trusts it.
 *
 * Returns the parsed intent, or the reason it is unusable. `connectAccountId`
 * is checked for PRESENCE, not truthiness — see the contract note at the top.
 */
function parseIntent(
  payload: unknown,
): { ok: true; intent: BookingPaymentIntentResponse } | { ok: false; reason: string } {
  if (payload === null || typeof payload !== "object") {
    return { ok: false, reason: "the response was not an object" };
  }

  const body: Record<string, unknown> = { ...payload };

  const clientSecret = asString(body.clientSecret);
  if (clientSecret === null) return { ok: false, reason: "no clientSecret" };

  const publishableKey = asString(body.publishableKey);
  if (publishableKey === null) return { ok: false, reason: "no publishableKey" };

  if (!("connectAccountId" in body)) {
    return {
      ok: false,
      reason:
        "no connectAccountId field — it is required (null for a platform charge) " +
        "because a direct-charge secret cannot be confirmed without it",
    };
  }
  const rawAccount: unknown = body.connectAccountId;
  if (rawAccount !== null && typeof rawAccount !== "string") {
    return { ok: false, reason: "connectAccountId was neither a string nor null" };
  }

  const amount = typeof body.amount === "number" ? body.amount : null;

  return {
    ok: true,
    intent: {
      clientSecret,
      publishableKey,
      connectAccountId: asString(rawAccount),
      rentalNumber: asString(body.rentalNumber),
      amount,
      currency: asString(body.currency),
      // Additive, and NOT validated the way `connectAccountId` is: a response
      // without them is a valid response from a function that has not been
      // redeployed yet, and refusing it would stop the customer paying at all.
      // Absent, empty and null all collapse to null here, which is exactly the
      // value that makes the UI fall back to "we have emailed you the link"
      // instead of rendering a dead one.
      documentsToken: asString(body.documentsToken),
      documentsUrl: asString(body.documentsUrl),
    },
  };
}

/* ─────────────────────────────── the hook ────────────────────────────────── */

const NOT_DEPLOYED_COPY =
  "Card payment is not switched on for this site yet. Nothing has been charged " +
  "— please get in touch and we will take your booking directly.";

/**
 * ── WHY "COULD NOT REACH" AND "NOT DEPLOYED" SHARE ONE SCREEN ────────────────
 * A Supabase Functions URL for a function that does not exist answers 404 with
 * NO CORS headers, so the browser refuses the response and `fetch` rejects. The
 * SDK reports that as `FunctionsFetchError` with no status — byte-identical to
 * a dropped connection. Verified against the real gateway: today's undeployed
 * `create-booking-payment-intent` produces exactly this, not the 404 branch
 * above, so the 404 branch only fires when the function EXISTS and its router
 * 404s.
 *
 * The two causes are therefore indistinguishable from the browser, and the copy
 * names both rather than confidently blaming the customer's wifi.
 * `navigator.onLine` is trusted only in the negative: false really does mean no
 * network, while true means very little.
 */
const UNREACHABLE_COPY =
  "We could not reach our payment service — card payment may not be switched on " +
  "for this site yet. Nothing has been charged. Please try again, or get in " +
  "touch and we will take your booking directly.";

const OFFLINE_COPY =
  "You appear to be offline, so we could not reach our payment service. Nothing " +
  "has been charged — reconnect and try again.";

const MALFORMED_COPY =
  "Our payment service answered in a way we did not understand. Nothing has " +
  "been charged. Please try again in a moment.";

/** False is meaningful; true is not. See the note above. */
function looksOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function usePaymentIntent(): UsePaymentIntentResult {
  const [state, setState] = useState<PaymentIntentState>({ status: "idle" });

  const reset = useCallback(() => setState({ status: "idle" }), []);

  const create = useCallback(async (request: BookingPaymentIntentRequest) => {
    setState({ status: "creating" });

    const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, {
      body: request,
    });

    if (error) {
      const status = statusOf(error);
      const detail = describe(error);

      // 404 is the interesting one: the gateway answers it for a function that
      // was never deployed, which is exactly today's state. Say so plainly
      // instead of blaming the customer's connection.
      if (status === 404) {
        setState({
          status: "failed",
          failure: {
            kind: "not-deployed",
            message: NOT_DEPLOYED_COPY,
            // Retrying a route that answered a clean 404 just answers 404 again.
            retryable: false,
            detail: `${FUNCTION_NAME} returned 404 — the edge function is not deployed.`,
          },
        });
        return;
      }

      if (status !== null && status >= 400 && status < 500) {
        const serverMessage = await readServerMessage(error);
        setState({
          status: "failed",
          failure: {
            kind: "rejected",
            message:
              serverMessage ??
              "We could not start this payment. Nothing has been charged — " +
                "please check your details and try again.",
            retryable: true,
            detail,
          },
        });
        return;
      }

      if (status === null) {
        const offline = looksOffline();
        setState({
          status: "failed",
          failure: {
            kind: "unreachable",
            message: offline ? OFFLINE_COPY : UNREACHABLE_COPY,
            retryable: true,
            detail:
              `${FUNCTION_NAME} could not be reached (${detail ?? "no detail"}). ` +
              "A CORS-blocked 404 and a dead connection are the same error here — " +
              "check whether the edge function is deployed before chasing the network.",
          },
        });
        return;
      }

      setState({
        status: "failed",
        failure: {
          kind: "rejected",
          message: MALFORMED_COPY,
          retryable: true,
          detail,
        },
      });
      return;
    }

    const parsed = parseIntent(data);
    if (!parsed.ok) {
      setState({
        status: "failed",
        failure: {
          kind: "malformed",
          message: MALFORMED_COPY,
          retryable: true,
          detail: `${FUNCTION_NAME} responded 2xx but ${parsed.reason}.`,
        },
      });
      return;
    }

    setState({ status: "ready", intent: parsed.intent });
  }, []);

  return { state, create, reset };
}
