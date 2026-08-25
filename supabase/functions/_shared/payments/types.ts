/**
 * Square integration — provider seam types (binding decision: module-layout).
 *
 * This module is the ONLY place the two processors meet. It exists because the
 * platform must support a second payment processor for the TENANT <-> CUSTOMER
 * money flow without altering a single byte of the Stripe path.
 *
 * THE PASSTHROUGH CONTRACT — read this before using anything here.
 *
 * `tryProviderCheckout()` / `tryProviderRefund()` return a FLAT `ProviderOutcome`.
 * When `handled === false` the caller MUST continue into its own existing body,
 * unchanged. Stripe is the NATIVE RAIL: it is never delegated to, never
 * translated, never re-described. That is what makes "zero Stripe diff" literally
 * true and verifiable with one checksum command.
 *
 * The per-call-site diff is a fixed 5-line preamble that ADDS lines and DELETES
 * none:
 *
 *     const routed = await tryProviderCheckout(supabase, tenantId, spec);
 *     if (routed.handled) return jsonResponse(routed.body);
 *     // ---- existing Stripe code below, untouched ----
 *
 * DO NOT replace a Stripe triple with a "neutral" call. A neutral CheckoutSpec
 * rich enough to carry create-checkout-session's 12-key metadata bag, its 8
 * conditional spreads, custom_text.submit.message, client_reference_id and the
 * {CHECKOUT_SESSION_ID}-templated success_url would simply BE the Stripe API
 * under different field names — the god-interface docs/square-integration/
 * 04-IMPLEMENTATION-PLAN.md §2.2 bans. The neutral surface is the CEILING of
 * what Square can do, not a re-description of what Stripe does.
 *
 * Why FLAT and not a discriminated union: callers sit inside long existing
 * functions with their own control flow. A union forces a `switch` and tempts a
 * refactor of the surrounding body. A flat object with a boolean reads as a
 * guard clause and cannot restructure anything around it.
 */

/** The processor governing a tenant's customer-facing money flow. */
export type ProviderId = "stripe" | "square";

/** Square's test/live split. Unlike Stripe this changes the BASE URL, not just a key. */
export type SquareMode = "test" | "live";

/**
 * Result of resolving which processor owns a tenant's money.
 *
 * `provider` is never null: the column is NOT NULL DEFAULT 'stripe', so every one
 * of the 52 existing tenants and 1,026 existing payments resolves to 'stripe'
 * with zero backfill. Code MUST NOT treat absence as meaningful — see
 * `predicates.ts` for why `.is('payment_provider', null)` is banned.
 */
export interface ProviderResolution {
  tenantId: string;
  provider: ProviderId;
  /** Square only. Null for Stripe tenants. */
  squareMode: SquareMode | null;
  /** ISO-3166-1 alpha-2. Null for legacy tenants that predate the column. */
  country: string | null;
}

/**
 * The flat passthrough result. See the PASSTHROUGH CONTRACT above.
 *
 * handled=false  -> this is the native (Stripe) rail; caller continues unchanged.
 * handled=true   -> the Square adapter fully serviced the request; `body` is the
 *                   response payload the caller should return verbatim.
 * handled=true + skipped -> the operation is deliberately unavailable for this
 *                   tenant (see capabilities). This is a SKIP, never a THROW: it
 *                   mirrors the shape place-deposit-hold:209 already returns, so
 *                   existing callers and crons treat it as a no-op rather than an
 *                   error. Throwing here would turn an unsupported feature into a
 *                   pager alert.
 */
export interface ProviderOutcome {
  handled: boolean;
  body?: Record<string, unknown>;
  skipped?: boolean;
  /** Machine-readable skip cause, e.g. 'square_unsupported_stored_credential'. */
  reason?: string;
}

/** Not handled — caller proceeds with its own Stripe implementation. */
export const PASSTHROUGH: ProviderOutcome = Object.freeze({ handled: false });

/** Deliberate, non-error skip. */
export function skip(reason: string, extra?: Record<string, unknown>): ProviderOutcome {
  return { handled: true, skipped: true, reason, body: { skipped: true, reason, ...extra } };
}

/** Square serviced the request. */
export function servedBySquare(body: Record<string, unknown>): ProviderOutcome {
  return { handled: true, body };
}

/**
 * A Square API failure. Square returns an `errors[]` array with category+code,
 * structurally unlike Stripe's single error object, so it gets its own type
 * rather than being mashed into a Stripe-shaped one.
 */
export class SquareError extends Error {
  constructor(
    message: string,
    readonly category: string,
    readonly code: string,
    readonly httpStatus: number,
    readonly raw?: unknown,
  ) {
    super(message);
    this.name = "SquareError";
  }
}
