// Payment plans — the Stripe PaymentProvider (engine seam, providers.ts).
//
// Moves money only. The engine owns when and how much; this file turns one
// ChargeRequest into one off-session PaymentIntent and one ChargeOutcome.
//
// THE CUSTOMER IS RESOLVED AT CHARGE TIME, NEVER SNAPSHOTTED. A Stripe
// Customer lives in exactly one platform account (UK / UAE) and one mode
// (test / live). A `cus_…` stored when the plan was made can be dead by the
// time the third payment runs — a test-era id after go-live broke every
// payment for a Kedic customer in July 2026. So the request carries OUR
// customers.id (`customerRef`), and every charge resolves the live `cus_…`
// through _shared/customer-account.ts, which validates it against Stripe
// (validateStripeCustomerId) on the account being charged.
//
// THE IDEMPOTENCY KEY IS THE ENGINE'S. `pp:{account}:{occurrence}:{attempt}`
// comes from pp_claim and goes to Stripe verbatim, with the connected account
// as the Stripe-Account header. A replay of the same key returns Stripe's
// stored answer (for 24 h); the engine only ever replays inside 23 h.
//
// ERRORS → OUTCOMES. A card decline is `declined` with Stripe's own
// decline_code / code, classified by classify.ts. A 5xx, a timeout, a dropped
// connection is `indeterminate` — the money may have moved, and only a replay
// of the SAME key may find out. A 409 idempotency_key_in_use is `in_use`. A
// request Stripe rejects as malformed is `declined` with a code the classifier
// files under integration_bug (pause + alert, never a customer email).

import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import type { PlatformAccount } from "../stripe-client.ts";
import { CUSTOMER_ACCOUNT_COLUMNS, getCustomerIdForAccount } from "../customer-account.ts";
import type { ChargeOutcome, ChargeRequest, PaymentProvider } from "../payment-plans/providers.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface StripeErrorLike {
  type?: string;
  code?: string;
  decline_code?: string;
  statusCode?: number;
  message?: string;
  raw?: { code?: string; decline_code?: string; payment_intent?: { id?: string }; message?: string };
  payment_intent?: { id?: string };
}

/** Map a thrown Stripe error to an outcome. Exported for the unit tests. */
export function outcomeFromStripeError(err: unknown): ChargeOutcome {
  const e = (err ?? {}) as StripeErrorLike;
  const code = e.code ?? e.raw?.code ?? null;
  const declineCode = e.decline_code ?? e.raw?.decline_code ?? null;
  const message = e.message ?? e.raw?.message ?? String(err);
  const providerRef = e.payment_intent?.id ?? e.raw?.payment_intent?.id ?? null;

  if (code === "idempotency_key_in_use" || e.statusCode === 409) return { kind: "in_use" };
  switch (e.type) {
    case "StripeCardError":
      return { kind: "declined", providerRef, declineCode, errorCode: code ?? "card_declined", message };
    case "StripeIdempotencyError":
      return { kind: "declined", providerRef, declineCode: null, errorCode: "idempotency_error", message };
    case "StripeRateLimitError":
      return { kind: "declined", providerRef, declineCode: null, errorCode: "rate_limit", message };
    case "StripeInvalidRequestError":
      // resource_missing (a deleted card) and friends keep their own code; an
      // un-coded invalid request is ours to fix.
      return { kind: "declined", providerRef, declineCode, errorCode: code ?? "invalid_request_error", message };
    case "StripeAuthenticationError":
      return { kind: "declined", providerRef: null, declineCode: null, errorCode: "platform_api_key_expired", message };
    case "StripePermissionError":
      return { kind: "declined", providerRef: null, declineCode: null, errorCode: "account_invalid", message };
    default:
      // StripeAPIError (5xx), StripeConnectionError, timeouts, anything we do
      // not recognise: we cannot know whether money moved.
      return { kind: "indeterminate", message };
  }
}

/** A PaymentIntent that came back without throwing → outcome. */
export function outcomeFromIntent(pi: Stripe.PaymentIntent): ChargeOutcome {
  switch (pi.status) {
    case "succeeded":
      return { kind: "succeeded", providerRef: pi.id };
    case "requires_action":
    case "requires_confirmation":
      // off_session + confirm normally throws authentication_required instead;
      // if Stripe hands the intent back, it is the same situation.
      return { kind: "declined", providerRef: pi.id, declineCode: "authentication_required", errorCode: "authentication_required", message: `PaymentIntent ${pi.status}` };
    case "requires_payment_method": {
      const last = pi.last_payment_error;
      return {
        kind: "declined",
        providerRef: pi.id,
        declineCode: last?.decline_code ?? null,
        errorCode: last?.code ?? "card_declined",
        message: last?.message ?? "The card was declined",
      };
    }
    default:
      // processing / requires_capture / canceled: not a clean success. Leave
      // it to recovery (replay, then lookup) rather than guess.
      return { kind: "indeterminate", message: `PaymentIntent ${pi.id} is ${pi.status}` };
  }
}

export class StripePaymentProvider implements PaymentProvider {
  readonly name = "stripe" as const;
  readonly mode: "test" | "live";
  readonly account: string | null;
  readonly platformAccount: PlatformAccount;
  private readonly stripe: Stripe;
  private readonly db: Db;
  private readonly tenantId: string;

  constructor(opts: { stripe: Stripe; mode: "test" | "live"; account: string | null; platformAccount: PlatformAccount; db: Db; tenantId: string }) {
    this.stripe = opts.stripe;
    this.mode = opts.mode;
    this.account = opts.account;
    this.platformAccount = opts.platformAccount;
    this.db = opts.db;
    this.tenantId = opts.tenantId;
  }

  private get options(): { stripeAccount: string } | undefined {
    return this.account ? { stripeAccount: this.account } : undefined;
  }

  /**
   * The live Stripe customer for OUR customers row on THIS account, or null.
   * Never mints one: an off-session charge needs a customer that already holds
   * a card, and a freshly minted customer holds none.
   */
  private async resolveCustomer(customerRowId: string): Promise<string | null> {
    const { data: customer, error } = await this.db
      .from("customers")
      .select(`id, tenant_id, ${CUSTOMER_ACCOUNT_COLUMNS}`)
      .eq("id", customerRowId)
      .maybeSingle();
    if (error) throw new Error(`customer lookup failed: ${error.message}`);
    if (!customer) return null;
    // Defence in depth: a plan's customer must be the plan's tenant's.
    if (customer.tenant_id !== this.tenantId) throw new Error(`customer ${customerRowId} does not belong to tenant ${this.tenantId}`);
    return await getCustomerIdForAccount({
      supabase: this.db,
      stripe: this.stripe,
      account: this.platformAccount,
      stripeAccount: this.account,
      customerRowId,
      customer,
    });
  }

  /** The plan's card if given, else the customer's default card, else their first card. */
  private async resolvePaymentMethod(customerId: string, preferred: string | null): Promise<string | null> {
    if (preferred) return preferred;
    // deno-lint-ignore no-explicit-any
    const cust: any = await this.stripe.customers.retrieve(customerId, { expand: ["invoice_settings.default_payment_method"] }, this.options);
    const dpm = cust?.invoice_settings?.default_payment_method;
    const fromDefault = typeof dpm === "string" ? dpm : dpm?.id ?? null;
    if (fromDefault) return fromDefault;
    const pms = await this.stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 1 }, this.options);
    return pms?.data?.[0]?.id ?? null;
  }

  async charge(req: ChargeRequest): Promise<ChargeOutcome> {
    if ((req.account ?? null) !== (this.account ?? null)) {
      // The key embeds the account; charging elsewhere would be a different charge.
      return { kind: "declined", providerRef: null, declineCode: null, errorCode: "account_invalid", message: `Request is for ${req.account ?? "the platform"}, provider is ${this.account ?? "the platform"}` };
    }
    if (!Number.isSafeInteger(req.amountCents) || req.amountCents < 1) {
      return { kind: "declined", providerRef: null, declineCode: null, errorCode: "amount_too_small", message: `Bad amount ${req.amountCents}` };
    }

    let customerId: string | null;
    let paymentMethodId: string | null;
    try {
      customerId = req.customerRef ? await this.resolveCustomer(req.customerRef) : null;
      paymentMethodId = customerId ? await this.resolvePaymentMethod(customerId, req.paymentMethodRef) : null;
    } catch (err) {
      // Nothing has been charged yet, but we could not find out which card to
      // use (Stripe or the DB is unreachable). An indeterminate attempt is
      // replayed with the SAME key, which re-runs this lookup — safe.
      const outcome = outcomeFromStripeError(err);
      return outcome.kind === "declined" ? outcome : { kind: "indeterminate", message: `Could not resolve the card: ${(err as Error)?.message ?? err}` };
    }
    if (!customerId || !paymentMethodId) {
      return { kind: "declined", providerRef: null, declineCode: null, errorCode: "no_payment_method", message: "No saved card to charge for this customer on this account" };
    }

    try {
      const pi = await this.stripe.paymentIntents.create(
        {
          amount: req.amountCents,
          currency: req.currency.toLowerCase(),
          customer: customerId,
          payment_method: paymentMethodId,
          off_session: true,
          confirm: true,
          description: `Payment plan instalment (rental ${String(req.metadata.rental_id ?? "").slice(0, 8).toUpperCase()})`,
          metadata: req.metadata,
        },
        { idempotencyKey: req.idempotencyKey, ...(this.account ? { stripeAccount: this.account } : {}) },
      );
      return outcomeFromIntent(pi);
    } catch (err) {
      return outcomeFromStripeError(err);
    }
  }

  async refund(providerRef: string, amountCents: number, idempotencyKey: string): Promise<{ ok: boolean; message?: string }> {
    try {
      await this.stripe.refunds.create(
        { payment_intent: providerRef, amount: amountCents, metadata: { type: "payment_plan_compensation" } },
        { idempotencyKey, ...(this.account ? { stripeAccount: this.account } : {}) },
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, message: (err as Error)?.message ?? String(err) };
    }
  }

  /**
   * The charge made for an attempt, by its metadata, NET of refunds. Search is
   * eventually consistent (about a minute); recovery only looks up attempts
   * older than ten minutes. A PaymentIntent still `processing` THROWS: "we do
   * not know yet" must never read as "there is no charge", which would let
   * recovery abandon the attempt and charge again.
   */
  async findByAttempt(attemptId: string): Promise<{ providerRef: string; amountCents: number } | null> {
    if (!UUID.test(attemptId)) throw new Error(`findByAttempt: not an attempt id: ${attemptId}`);
    const found = await this.stripe.paymentIntents.search({ query: `metadata['attempt_id']:'${attemptId}'`, limit: 10 }, this.options);
    const mine = (found?.data ?? []).filter((pi) => pi.metadata?.attempt_id === attemptId);
    if (mine.some((pi) => pi.status === "processing" || pi.status === "requires_capture")) {
      throw new Error(`findByAttempt: a PaymentIntent for attempt ${attemptId} is still ${mine.find((pi) => pi.status === "processing" || pi.status === "requires_capture")!.status}`);
    }
    const succeeded = mine.filter((pi) => pi.status === "succeeded");
    if (succeeded.length === 0) return null;
    if (succeeded.length > 1) throw new Error(`findByAttempt: ${succeeded.length} succeeded PaymentIntents for attempt ${attemptId} — reconcile by hand`);
    const pi = await this.stripe.paymentIntents.retrieve(succeeded[0].id, { expand: ["latest_charge"] }, this.options);
    // deno-lint-ignore no-explicit-any
    const charge: any = pi.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
    const refunded = Number(charge?.amount_refunded ?? 0);
    const net = Number(pi.amount_received ?? pi.amount) - refunded;
    return net > 0 ? { providerRef: pi.id, amountCents: net } : null;
  }
}

/**
 * The provider for a tenant that cannot be charged by the engine in slice 1
 * (a Square tenant, or a live Own-Stripe tenant with no connected account).
 * Every charge is refused with a code the classifier treats as an integration
 * bug: the plan pauses and an operator is told, and no customer is emailed.
 */
export class UnavailableProvider implements PaymentProvider {
  readonly name: "stripe" | "square";
  readonly mode: "test" | "live";
  readonly account: string | null = null;
  constructor(private readonly reason: string, opts: { name: "stripe" | "square"; mode: "test" | "live" }) {
    this.name = opts.name;
    this.mode = opts.mode;
  }
  charge(): Promise<ChargeOutcome> {
    return Promise.resolve({ kind: "declined", providerRef: null, declineCode: null, errorCode: "provider_not_supported", message: this.reason });
  }
  refund(): Promise<{ ok: boolean; message?: string }> {
    return Promise.resolve({ ok: false, message: this.reason });
  }
  findByAttempt(): Promise<{ providerRef: string; amountCents: number } | null> {
    return Promise.reject(new Error(this.reason));
  }
}
