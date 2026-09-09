// =============================================================================
// stripe-live.ts — the fixtures and the two raw Stripe calls the money cases
// in `integrations/stripe/` need.
//
// WHY THIS IS A SEPARATE FILE FROM live-call.ts
// ---------------------------------------------
// live-call.ts answers one question — "which database am I pointed at, and am
// I allowed to touch it" — and it must keep answering only that, because it is
// the file anyone reviewing the safety of this suite reads first. Everything
// here is downstream of a `liveMoneyGate()` that already said yes: what to
// refund, and how to talk to Stripe directly.
//
// WHAT "TALK TO STRIPE DIRECTLY" MEANS, AND WHY IT IS NOT CHEATING
// ----------------------------------------------------------------
// The signup card step uses the inline Payment Element, so the card number is
// typed into a Stripe-hosted iframe and never reaches a Drive247 payload —
// which is exactly why step 04 of the spine stops at "the endpoint is up".
// Confirming a PaymentIntent therefore needs whatever the browser would have
// done, and the browser does two ordinary REST calls with the PUBLISHABLE key:
//
//   POST /v1/payment_methods                     (card -> pm_...)
//   POST /v1/payment_intents/{id}/confirm        (client_secret + pm_...)
//
// Both are publishable-key operations — the same ones Stripe.js makes. So the
// checkout cases can reach a real confirmed subscription without the browser
// automation the team lead ruled out ("wo test carry nahi ho payenge"), and
// without any Stripe SECRET key ever being needed by this suite. There is no
// secret key here, which is itself a guard: this file cannot create a charge,
// only confirm one that signup-payment-intent already created.
//
// FIXTURES ARE NEVER INVENTED
// ---------------------------
// A refund needs a rental that exists and has settled money on it. There is no
// safe way to guess one, so every money case reads its target out of the
// environment and throws when it is missing. Guessing a rental to refund is the
// payments-surface equivalent of guessing a project ref.
// =============================================================================

import { liveCall, type LiveResponse } from "./live-call";

// ---------------------------------------------------------------------------
// Test cards. Stripe's published numbers, and the reason they are safe to hold
// in a repository: they are rejected outright by a live-mode account, so the
// worst case for a mis-declared mode is a decline, not a charge.
// ---------------------------------------------------------------------------
export const STRIPE_TEST_CARDS = {
  /** Succeeds with no authentication step. */
  visa: "4242424242424242",
  /** `card_declined` / `generic_decline`. Fails at confirm, charges nothing. */
  genericDecline: "4000000000000002",
} as const;

/**
 * A rental id that cannot exist.
 *
 * Used by the one live refund probe that runs WITHOUT the money gate — the
 * Extension guard case. That case has to POST at process-refund to prove the
 * guard answers, and this is what makes the POST harmless even on the
 * assumption the test is there to disprove: if the Extension guard had been
 * deleted, execution falls through to the rental lookup, finds nothing, and
 * the authorization block 401s an anon caller long before any Stripe call.
 * The test is safe because of a SECOND independent barrier, not because of the
 * one it is testing.
 */
export const NON_EXISTENT_RENTAL_ID = "00000000-0000-0000-0000-000000000000";

function env(name: string): string | null {
  const v = process.env[name];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// ---------------------------------------------------------------------------
// The refund fixture
// ---------------------------------------------------------------------------

export interface RefundFixture {
  /** The rental whose money the money cases are allowed to move. */
  rentalId: string;
  /** Ledger category to refund from. Defaults to "Rental". */
  category: string;
  /** The small amount the partial cases move, in major units (e.g. 1 = $1.00). */
  amount: number;
  /**
   * Access token of a PORTAL STAFF user on that rental's tenant.
   *
   * NOT the same token as D247_LIVE_SESSION_JWT, which the spine uses and which
   * belongs to a half-created signup user with no `app_users` row at all.
   * process-refund resolves the caller through `app_users` and requires
   * head_admin / admin / a manager with EDITOR on the payments tab, so a signup
   * token gets a 403 here and would look exactly like a broken function.
   */
  portalJwt: string;
}

const FIXTURE_VARS = {
  rentalId: "D247_LIVE_REFUND_RENTAL_ID",
  portalJwt: "D247_LIVE_PORTAL_JWT",
  category: "D247_LIVE_REFUND_CATEGORY",
  amount: "D247_LIVE_REFUND_AMOUNT",
} as const;

/**
 * Read the fixture, or throw saying precisely what is missing.
 *
 * Called only from inside a money-gated test, i.e. after `liveMoneyGate()` has
 * already approved the run — so a throw here is "you said yes and then did not
 * say to what", which is the same class of mistake as D247_LIVE_TESTS=1 with no
 * target and gets the same treatment.
 */
export function resolveRefundFixture(
  opts: { rentalIdVar?: string } = {},
): RefundFixture {
  // A case may name its own rental variable and fall back to the shared one.
  // The full-refund case does, because the partial cases in the neighbouring
  // file deliberately spend the shared fixture down to zero and run FIRST
  // (`partial-payment` sorts before `refund`). Without a second rental, the
  // full-refund case can only ever skip on a complete pass.
  const rentalVar = opts.rentalIdVar ?? FIXTURE_VARS.rentalId;
  const rentalId = env(rentalVar) ?? env(FIXTURE_VARS.rentalId);
  const portalJwt = env(FIXTURE_VARS.portalJwt);

  const missing: string[] = [];
  if (!rentalId) missing.push(FIXTURE_VARS.rentalId);
  if (!portalJwt) missing.push(FIXTURE_VARS.portalJwt);

  if (missing.length) {
    throw new Error(
      [
        "",
        "  Money movement is enabled but the refund fixture is incomplete.",
        "",
        ...missing.map((v) => `    missing: ${v}`),
        "",
        `    ${FIXTURE_VARS.rentalId}  the rental these cases may refund from.`,
        `    ${FIXTURE_VARS.portalJwt}     a head_admin/admin access token on that`,
        "                              rental's tenant. process-refund 403s anyone",
        "                              else, and a 403 reads like a broken function.",
        `    ${FIXTURE_VARS.category}  optional, default "Rental".`,
        `    ${FIXTURE_VARS.amount}    optional, default 1 (one currency unit).`,
        "",
        "  Nothing here is inferred. Picking a rental to refund by guessing is the",
        "  payments-surface version of guessing a project ref.",
        "",
      ].join("\n"),
    );
  }

  const rawAmount = env(FIXTURE_VARS.amount);
  const amount = rawAmount === null ? 1 : Number(rawAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(
      `${FIXTURE_VARS.amount}="${rawAmount}" is not a positive number. ` +
        `process-refund rejects refundAmount <= 0 outright, so this run would ` +
        `only ever prove that its required-field check works.`,
    );
  }

  return {
    rentalId: rentalId as string,
    portalJwt: portalJwt as string,
    category: env(FIXTURE_VARS.category) ?? "Rental",
    amount,
  };
}

/**
 * The body the portal's refund dialog builds, with this run's fixture in it.
 *
 * Kept in one place so the live cases POST the SAME shape the contract test
 * asserts. A live case with a hand-rolled body proves nothing about the payload
 * a real operator sends — it proves something about the payload this file
 * happens to send.
 */
export function refundBody(
  fixture: RefundFixture,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    rentalId: fixture.rentalId,
    paymentId: undefined,
    extensionId: undefined,
    refundType: "partial",
    refundAmount: fixture.amount,
    category: fixture.category,
    reason: "drive247 spine suite — automated Stripe integration case",
    processedBy: "admin",
    tenantId: undefined,
    ...over,
  };
}

/** POST at process-refund as the fixture's portal staff user. */
export function callProcessRefund(
  fixture: RefundFixture,
  body: Record<string, unknown>,
): Promise<LiveResponse> {
  return liveCall("process-refund", body, { token: fixture.portalJwt });
}

// ---------------------------------------------------------------------------
// Discovering how much is refundable, through the API alone
// ---------------------------------------------------------------------------

/**
 * An amount no fixture will ever have available.
 *
 * SAFETY, because "POST a million" deserves a paragraph. Two independent things
 * stop this moving a million:
 *
 *   1. the guard under test — `refundAmount > availableForRefund` returns 400
 *      before any Stripe client is constructed;
 *   2. the clamp that is NOT under test — even with (1) deleted, the Stripe
 *      branch refunds `Math.min(refundAmount, stripeUnrefunded, categoryCap)`,
 *      so Stripe can never be asked for more than that PaymentIntent still
 *      holds.
 *
 * On top of both, this only runs behind D247_LIVE_ALLOW_MONEY_MOVEMENT and a
 * hand-declared D247_LIVE_STRIPE_MODE=test.
 */
const PROBE_AMOUNT = 1_000_000;

export type RefundableBalance =
  | { state: "known"; available: number; raw: string; status: number }
  | { state: "exhausted"; raw: string; status: number }
  | { state: "unreadable"; raw: string; status: number };

/**
 * How much is still refundable in the fixture's category.
 *
 * There is no read-only endpoint for this, so the balance is read out of the
 * refusal: process-refund's own error names the figure —
 *
 *   "Refund amount ($1,000,000.00) exceeds available refundable amount ($42.00) for Rental"
 *
 * That makes the money cases self-configuring: nobody has to type a balance
 * into an env var and keep it correct as earlier cases spend it. The cost is a
 * dependency on the wording of one error string, so `state: "unreadable"` is a
 * first-class outcome rather than a crash, and the cases report it as failure
 * mode (a) — a developer reworded the message — with the raw body attached.
 */
export async function probeRefundableBalance(
  fixture: RefundFixture,
): Promise<RefundableBalance> {
  const res = await callProcessRefund(
    fixture,
    refundBody(fixture, { refundAmount: PROBE_AMOUNT, refundType: "partial" }),
  );
  const raw = typeof res.json?.error === "string" ? res.json.error : res.text;

  if (/No refundable amount available/i.test(raw)) {
    return { state: "exhausted", raw, status: res.status };
  }

  const m = /exceeds available refundable amount\s*\(([^)]+)\)/i.exec(raw);
  if (m) {
    const available = parseMoney(m[1]);
    if (available !== null) return { state: "known", available, raw, status: res.status };
  }

  return { state: "unreadable", raw, status: res.status };
}

/**
 * "$1,234.56" / "£12.00" / "AED 42.00" -> 1234.56.
 *
 * The function formats with `Intl.NumberFormat` under en-US, en-GB or en-IE
 * (see _shared/format-utils.ts), all of which put `,` in the thousands and `.`
 * in the decimal, and its own catch-all fallback is `${CODE} ${n.toFixed(2)}`.
 * So stripping everything that is not a digit or a separator is enough, and
 * anything unexpected returns null rather than a wrong number.
 */
export function parseMoney(text: string): number | null {
  const digits = text.replace(/[^0-9.,]/g, "").replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(digits)) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

/** Two decimal places, the way money is compared. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// The two publishable-key Stripe calls
// ---------------------------------------------------------------------------

export interface StripeRestResponse {
  status: number;
  json: any;
  text: string;
}

/**
 * Refuse anything that is not a Stripe TEST publishable key.
 *
 * `signup-payment-intent` returns the key it actually built the subscription
 * with, so this is the one check in the whole suite that observes the real
 * Stripe mode rather than trusting a declaration. If the deployed function is
 * wired to live keys, D247_LIVE_STRIPE_MODE=test was a false statement, and the
 * next line of the test would confirm a PaymentIntent on a live account.
 */
export function assertStripeTestPublishableKey(pk: unknown): asserts pk is string {
  if (typeof pk !== "string" || !pk.startsWith("pk_test_")) {
    throw new Error(
      [
        "",
        "  ############################################################",
        "  #  STOPPING: THIS TARGET IS NOT IN STRIPE TEST MODE        #",
        "  ############################################################",
        "",
        `  signup-payment-intent handed back publishableKey: ${
          typeof pk === "string" ? `${pk.slice(0, 12)}…` : String(pk)
        }`,
        "",
        "  D247_LIVE_STRIPE_MODE=test said this run was in test mode. The deployed",
        "  function disagrees, and it is the one holding the keys. Confirming a",
        "  PaymentIntent from here would charge a real card on a live account.",
        "",
        "  Nothing has been confirmed. Fix the target or the declaration.",
        "",
      ].join("\n"),
    );
  }
}

/** `pi_3Xyz..._secret_abc` -> `pi_3Xyz...`. */
export function paymentIntentIdOf(clientSecret: string): string {
  const [id] = clientSecret.split("_secret_");
  if (!id?.startsWith("pi_")) {
    throw new Error(
      `Not a PaymentIntent client secret: "${clientSecret.slice(0, 16)}…". ` +
        `signup-payment-intent returns the secret of the first invoice's ` +
        `PaymentIntent; a SetupIntent secret here means the subscription was ` +
        `created with a different payment_behavior.`,
    );
  }
  return id;
}

async function stripeForm(
  path: string,
  publishableKey: string,
  form: Record<string, string>,
): Promise<StripeRestResponse> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${publishableKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(form).toString(),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Stripe always answers JSON; a non-JSON body means something in front of
    // it answered instead, which is worth seeing raw.
  }
  return { status: res.status, json, text };
}

/**
 * Tokenise a raw test card into a PaymentMethod, exactly as Stripe.js does.
 *
 * Publishable key only — raw card data over a publishable key is the documented
 * Elements path. The same call with a SECRET key would be rejected on a
 * non-PCI-enabled account, which is a useful accident: this file has no way to
 * hold a secret key even if someone added one to the environment.
 */
export function stripeCreateTestPaymentMethod(
  publishableKey: string,
  cardNumber: string,
): Promise<StripeRestResponse> {
  assertStripeTestPublishableKey(publishableKey);
  return stripeForm("payment_methods", publishableKey, {
    type: "card",
    "card[number]": cardNumber,
    "card[exp_month]": "12",
    // Comfortably ahead, and derived rather than hardcoded so this file does
    // not quietly start failing on an expiry date in some future year.
    "card[exp_year]": String(new Date().getFullYear() + 5),
    "card[cvc]": "123",
  });
}

/** Confirm the subscription's first PaymentIntent with that PaymentMethod. */
export function stripeConfirmPaymentIntent(
  publishableKey: string,
  clientSecret: string,
  paymentMethodId: string,
): Promise<StripeRestResponse> {
  assertStripeTestPublishableKey(publishableKey);
  return stripeForm(`payment_intents/${paymentIntentIdOf(clientSecret)}/confirm`, publishableKey, {
    client_secret: clientSecret,
    payment_method: paymentMethodId,
    // No redirect-based methods are in play (payment_settings pins card), but
    // Stripe requires the parameter to be present for any confirm that could
    // in principle redirect.
    return_url: "https://drive-247.com/signup/return",
  });
}

/**
 * The signup session token the checkout money cases need, or a skip reason.
 *
 * Separate from the fixture above because these two cases refund nothing — they
 * need a half-finished signup to pay FOR, not a rental to take money out of.
 */
export function signupSessionJwt(): string | null {
  return env("D247_LIVE_SESSION_JWT");
}
