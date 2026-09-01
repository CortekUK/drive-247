import { FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import type { BookingPaymentIntentResponse } from "@/hooks/use-payment-intent";

/**
 * Minting a PaymentIntent to SETTLE AN EXISTING BOOKING'S BALANCE.
 *
 * ── WHY THIS IS NOT `usePaymentIntent` ──────────────────────────────────────
 * Same endpoint, deliberately different request type. `create-booking-payment-
 * intent` destructures exactly eleven fields off the body — `rentalId`,
 * `tenantSlug`/`tenantId`, `customerId`, `customerEmail`, `customerName`,
 * `expectedAmount`, `source` and four flow flags this path never sets. It reads
 * NONE of the booking payload (`vehicleId`, `pickup`, `dropoff`, `delivery`,
 * `options`, `consent`, `quotedTotalCents`) that `BookingPaymentIntentRequest`
 * requires.
 *
 * A portal balance payment has no such payload — the booking was made weeks
 * ago. Satisfying that type would mean inventing values, and one of the fields
 * is `consent.agreeTerms`: writing `true` there would be a fabricated consent
 * record in the source, for a field the server throws away. So the request type
 * here is the SUBSET the endpoint actually reads, and nothing is invented.
 *
 * The RESPONSE type is imported rather than redeclared: one definition of the
 * shape both callers parse, so a field added to the endpoint cannot be picked
 * up by one path and missed by the other.
 *
 * ── THE AMOUNT IS THE SERVER'S ──────────────────────────────────────────────
 * `expectedAmount` is an INTEGRITY CHECK, never an instruction. The endpoint
 * prices the charge by summing the rental's open `ledger_entries` charges and
 * refuses the whole request (409 `amount_mismatch`) if our figure differs by
 * more than a cent — so the customer can never be shown one number and charged
 * another. It is sent in MAJOR units (dollars), which is what that comparison
 * is against.
 *
 * ── RETRY IS FREE, AND THAT IS THE ENDPOINT'S DOING ─────────────────────────
 * Calling this twice for the same rental does NOT mint a second intent: the
 * function looks for a `Pending` payments row on the rental carrying a
 * PaymentIntent id, retrieves it, and hands back the SAME client secret when it
 * is still confirmable and still for the same amount. So "try again" after a
 * declined card reuses the booking and its in-flight intent instead of
 * stranding a second Pending row for the webhook to pick the wrong one of.
 */

/* ─────────────────────────────── the request ─────────────────────────────── */

export interface BalancePaymentRequest {
  /** `rentals.id`. Without it the endpoint 400s — the amount comes from here. */
  rentalId: string;
  /** Preferred over `tenantId` by the endpoint's own resolution order. */
  tenantSlug: string | null;
  tenantId: string;
  /** `customers.id`, so the card is vaulted against the right person. */
  customerId: string;
  customerEmail: string;
  customerName: string;
  /** MAJOR units — dollars, not cents. See above. */
  expectedAmount: number;
}

/* ─────────────────────────────── the outcome ─────────────────────────────── */

export interface BalanceIntentFailure {
  /** Safe to render verbatim. */
  message: string;
  /** Whether offering "Try again" would be honest. */
  retryable: boolean;
  /** For the console, never for the customer. */
  detail: string | null;
}

export type BalanceIntentResult =
  | { ok: true; intent: BookingPaymentIntentResponse }
  | { ok: false; failure: BalanceIntentFailure };

/* ───────────────────────────── error narrowing ───────────────────────────── */

const FUNCTION_NAME = "create-booking-payment-intent";

/**
 * Pull the HTTP status off a Supabase Functions error.
 *
 * `FunctionsHttpError.context` is typed `any` by the SDK and this app is
 * `strict: true` with no `any` allowed, so it is narrowed through `unknown` and
 * an `instanceof Response` check rather than asserted.
 */
function statusOf(error: unknown): number | null {
  if (
    !(error instanceof FunctionsHttpError) &&
    !(error instanceof FunctionsRelayError)
  ) {
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
 * `connectAccountId` is checked for PRESENCE, not truthiness. These are Connect
 * DIRECT charges: a secret minted on a connected account can only be confirmed
 * by a Stripe.js instance built with `{ stripeAccount }`, so an OMITTED field is
 * indistinguishable from "platform charge" and would silently produce a confirm
 * that always fails. Null is a real, meaningful answer; missing is not.
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

  return {
    ok: true,
    intent: {
      clientSecret,
      publishableKey,
      connectAccountId: asString(rawAccount),
      rentalNumber: asString(body.rentalNumber),
      // MAJOR units. The endpoint returns `amount: amountDue`, the rounded
      // dollar figure — NOT the `amountMinorUnits` it hands Stripe. Dividing
      // this by 100 puts "$1.13" on a button that charges $113.25.
      amount: typeof body.amount === "number" ? body.amount : null,
      currency: asString(body.currency),
    },
  };
}

/* ──────────────────────────────── the copy ───────────────────────────────── */

const NOT_DEPLOYED_COPY =
  "Card payment is not switched on for this site yet. Nothing has been charged " +
  "— please get in touch and we will take the payment directly.";

/**
 * ── WHY "COULD NOT REACH" AND "NOT DEPLOYED" SHARE ONE MESSAGE ──────────────
 * A Supabase Functions URL for a function that does not exist answers 404 with
 * NO CORS headers, so the browser refuses the response and `fetch` rejects. The
 * SDK reports that as a fetch error with no status — byte-identical to a dropped
 * connection. The two causes are indistinguishable from the browser, so the copy
 * names both rather than confidently blaming the customer's wifi.
 * `navigator.onLine` is trusted only in the negative: false really does mean no
 * network, while true means very little.
 */
const UNREACHABLE_COPY =
  "We could not reach our payment service — card payment may not be switched on " +
  "for this site yet. Nothing has been charged. Please try again, or get in " +
  "touch and we will take the payment directly.";

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

/* ─────────────────────────────── the call ────────────────────────────────── */

export async function createBalancePaymentIntent(
  request: BalancePaymentRequest,
): Promise<BalanceIntentResult> {
  const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, {
    body: {
      rentalId: request.rentalId,
      tenantSlug: request.tenantSlug,
      tenantId: request.tenantId,
      customerId: request.customerId,
      customerEmail: request.customerEmail,
      customerName: request.customerName,
      expectedAmount: request.expectedAmount,
      // Copied into Stripe metadata for provenance. NOT 'portal' — the endpoint
      // maps that one value to `booking_source: 'admin'`, and this payment was
      // made by the customer themselves, not taken by an operator.
      source: "customer_portal",
      // `placeDepositHoldAfter` is deliberately absent. A deposit hold belongs
      // to the original booking flow; re-authorising one every time a customer
      // settles an outstanding charge would put a second hold on their card.
    },
  });

  if (error) {
    const status = statusOf(error);
    const detail = describe(error);

    if (status === 404) {
      return {
        ok: false,
        failure: {
          message: NOT_DEPLOYED_COPY,
          // Retrying a route that answered a clean 404 answers 404 again.
          retryable: false,
          detail: `${FUNCTION_NAME} returned 404 — the edge function is not deployed.`,
        },
      };
    }

    if (status !== null && status >= 400 && status < 500) {
      // The endpoint's 409s are the interesting ones and all carry a sentence
      // written for a human: `no_open_charges`, `nothing_due`, `amount_mismatch`.
      // Show them verbatim rather than flattening three different truths into
      // one generic apology.
      const serverMessage = await readServerMessage(error);
      return {
        ok: false,
        failure: {
          message:
            serverMessage ??
            "We could not start this payment. Nothing has been charged — " +
              "please refresh and try again.",
          retryable: true,
          detail,
        },
      };
    }

    if (status === null) {
      return {
        ok: false,
        failure: {
          message: looksOffline() ? OFFLINE_COPY : UNREACHABLE_COPY,
          retryable: true,
          detail:
            `${FUNCTION_NAME} could not be reached (${detail ?? "no detail"}). ` +
            "A CORS-blocked 404 and a dead connection are the same error here — " +
            "check whether the edge function is deployed before chasing the network.",
        },
      };
    }

    return {
      ok: false,
      failure: { message: MALFORMED_COPY, retryable: true, detail },
    };
  }

  const parsed = parseIntent(data);
  if (!parsed.ok) {
    return {
      ok: false,
      failure: {
        message: MALFORMED_COPY,
        retryable: true,
        detail: `${FUNCTION_NAME} responded 2xx but ${parsed.reason}.`,
      },
    };
  }

  return { ok: true, intent: parsed.intent };
}
