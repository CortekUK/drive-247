/**
 * Square adapter — the only file that knows how Square takes money.
 *
 * Credentials come from `square_connections` via a SECURITY DEFINER RPC that
 * decrypts Vault secret ids, exactly as `accounting_get_tokens` does for Xero and
 * Zoho. Raw tokens are never stored in a column and never logged.
 */

import { ProviderResolution, servedBySquare, ProviderOutcome, skip, failed, SquareError, SquareMode, PaymentsSupabaseClient } from "./types.ts";
import { squareFetch, squareIdempotencyKey } from "./square-client.ts";
import { capabilitiesFor } from "./capabilities.ts";
import { mapSquarePaymentStatus, mapSquareRefundStatus } from "./square-status-map.ts";

export interface SquareCheckoutSpec {
  amountCents: number;
  /** ISO-4217. MUST match the connected Location's currency — Square binds
   *  currency to the location and will not convert. */
  currency: string;
  description?: string;
  /** Square has redirect_url (success only). There is NO cancel_url analogue. */
  redirectUrl?: string;
  /**
   * Our own correlation handle. Square's Order.metadata caps at 10 keys / 255
   * chars and reference_id at 40, versus the 15-key bags our Stripe sessions
   * carry — so we plant ONE short key and look the rest up locally, which is
   * also what stripe-webhook-live already does (.eq('stripe_checkout_session_id')).
   */
  reference: { paymentId: string };
}

interface SquareConnection {
  accessToken: string;
  merchantId: string;
  locationId: string;
  /** Square binds currency to the LOCATION and never converts. This is the only
   *  trustworthy currency for money we send — payments has no currency column. */
  locationCurrency: string;
  /** The mode the stored credential actually belongs to. */
  mode: SquareMode;
}

/**
 * Load a tenant's Square credentials for a SPECIFIC mode.
 *
 * p_square_mode is REQUIRED, not optional. square_get_tokens defaults it to NULL,
 * which disables the mode filter and returns whichever connection was connected
 * most recently — while the base URL is chosen independently from
 * tenants.square_mode. uq_square_connections_active is UNIQUE(tenant_id,
 * square_mode) WHERE status='active', so one active TEST and one active LIVE
 * connection can coexist by design. Passing NULL therefore makes it possible to
 * sign a sandbox-intent request with live credentials, or the reverse. The
 * benign outcome is a 401 storm; the malignant one reaches the live merchant.
 *
 * Returns null rather than throwing when there is no active connection, so
 * callers SKIP — a tenant mid-onboarding is not an error.
 */
async function loadConnection(
  supabase: PaymentsSupabaseClient,
  tenantId: string,
  mode: SquareMode,
): Promise<SquareConnection | null> {
  const { data, error } = await supabase.rpc("square_get_tokens", {
    p_tenant_id: tenantId,
    p_square_mode: mode,
  });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.access_token || !row?.location_id) return null;

  // Belt and braces: the RPC echoes the row's mode. If it ever disagrees with the
  // mode we are about to build a base URL from, fail LOUDLY rather than skip —
  // a silent skip here would look like "not connected" and hide a credential mixup.
  const rowMode = (row.square_mode as SquareMode) ?? mode;
  if (rowMode !== mode) {
    throw new Error(
      `square: credential/mode mismatch for tenant ${tenantId} — ` +
        `resolved mode '${mode}' but stored connection is '${rowMode}'. Refusing to proceed.`,
    );
  }

  return {
    accessToken: row.access_token as string,
    merchantId: (row.merchant_id as string) ?? "",
    locationId: row.location_id as string,
    locationCurrency: String(row.location_currency ?? "").toUpperCase(),
    mode: rowMode,
  };
}

/**
 * payments.amount is `numeric` in MAJOR units (dollars/pounds). Square's Money
 * object wants MINOR units (cents/pence).
 *
 * Math.round is load-bearing: 10.1 * 100 === 1009.9999999999999 in IEEE-754, and
 * Square rejects a non-integer amount with EXPECTED_INTEGER. A bare multiply also
 * silently under/over-charges by a penny at scale.
 *
 * Returns null on anything non-finite so callers fail explicitly instead of
 * sending NaN into a money API.
 */
export function majorToMinorUnits(amount: unknown): number | null {
  // Number(null) === 0 and Number('') === 0 and Number([]) === 0. On a money
  // path those must NOT become a zero-amount refund that looks deliberate —
  // reject them as unresolvable so the caller skips explicitly.
  if (amount === null || amount === undefined) return null;
  if (typeof amount === "string" && amount.trim() === "") return null;
  if (typeof amount !== "number" && typeof amount !== "string") return null;

  const n = Number(amount);
  if (!Number.isFinite(n)) return null;

  // Math.round is load-bearing, not defensive styling: 19.99 * 100 is
  // 1998.9999999999998 in IEEE-754, and Square rejects a non-integer amount with
  // EXPECTED_INTEGER. (Not every value is affected — 10.1 * 100 is exactly 1010 —
  // which is precisely why an unrounded multiply passes casual testing and then
  // fails on a real price.)
  return Math.round(n * 100);
}

export async function createSquareCheckout(
  supabase: PaymentsSupabaseClient,
  resolution: ProviderResolution,
  spec: SquareCheckoutSpec,
): Promise<ProviderOutcome> {
  const mode = resolution.squareMode ?? "test";
  const conn = await loadConnection(supabase, resolution.tenantId, mode);
  if (!conn) return skip("square_not_connected", { tenantId: resolution.tenantId });

  const caps = capabilitiesFor("square");

  // reference_id caps at 40 chars; a bare UUID is 36, so it fits. Guard anyway —
  // an over-long value is rejected by Square at request time, not truncated.
  const referenceId = spec.reference.paymentId.slice(0, caps.maxReferenceIdChars);

  const idempotencyKey = await squareIdempotencyKey(`chk-${spec.reference.paymentId}`);

  try {
    const res = await squareFetch<{ payment_link?: Record<string, unknown> }>({
      mode,
      accessToken: conn.accessToken,
      method: "POST",
      path: "/v2/online-checkout/payment-links",
      idempotencyKey,
      body: {
        quick_pay: {
          name: spec.description?.slice(0, 255) ?? "Payment",
          price_money: { amount: spec.amountCents, currency: spec.currency.toUpperCase() },
          location_id: conn.locationId,
        },
        // Square shows its own confirmation page when redirect_url is absent.
        checkout_options: spec.redirectUrl ? { redirect_url: spec.redirectUrl } : undefined,
        payment_note: referenceId,
      },
    });

    const link = res.payment_link ?? {};
    return servedBySquare({
      provider: "square",
      url: link.url,
      paymentLinkId: link.id,
      orderId: link.order_id,
      referenceId,
    });
  } catch (err) {
    if (err instanceof SquareError) {
      // NOT a skip. An expired token or an outage must reach the operator as a
      // failure, not as an HTTP 200 with no payment link in it.
      return failed("square_checkout_failed", err.httpStatus >= 500 ? 502 : 400, {
        category: err.category, code: err.code, detail: err.message,
      });
    }
    throw err;
  }
}

export async function refundSquarePayment(
  supabase: PaymentsSupabaseClient,
  resolution: ProviderResolution,
  spec: { paymentRecord: Record<string, unknown>; amountCents?: number; reason?: string },
): Promise<ProviderOutcome> {
  const mode = resolution.squareMode ?? "test";
  const conn = await loadConnection(supabase, resolution.tenantId, mode);
  if (!conn) return skip("square_not_connected", { tenantId: resolution.tenantId });

  const squarePaymentId = spec.paymentRecord.square_payment_id as string | undefined;
  if (!squarePaymentId) return skip("square_payment_id_missing");

  // AMOUNT.
  // payments has NO `amount_cents` column — it has `amount numeric` in MAJOR
  // units. An earlier version of this file read `amount_cents`, which is
  // undefined on every real row, so a FULL refund (the common case, where the
  // caller omits amountCents) silently became skip('refund_amount_unknown').
  // That is handled:true, so the operator saw an HTTP 200 success shape while no
  // money moved. Read the real column and convert explicitly.
  const amount = spec.amountCents ?? majorToMinorUnits(spec.paymentRecord.amount);
  if (amount === null || amount === undefined) {
    return skip("refund_amount_unresolvable", {
      hint: "payments.amount was missing or non-numeric; refusing to guess an amount on a money path.",
    });
  }
  if (amount <= 0) return skip("refund_amount_not_positive", { amount });

  // CURRENCY.
  // payments has NO currency column at all. The only trustworthy source is the
  // connected Square LOCATION, because Square binds currency to the location and
  // will not convert. The previous `?? 'USD'` default sent USD at a GBP location,
  // which Square rejects with INVALID_VALUE — a hardcoded currency on a money
  // path is worse than a hard failure, because it fails differently per tenant.
  const currency = conn.locationCurrency;
  if (!currency) {
    return skip("square_location_currency_unknown", {
      hint: "square_connections.location_currency is empty; reconnect the Square account so the location is resolved.",
    });
  }

  // IDEMPOTENCY. Keying on (payment, amount) alone silently collapses two
  // legitimate equal-amount partial refunds into one: the second call returns
  // the FIRST refund's object, the adapter reports success, and the customer is
  // short the money. A refund is legitimately repeatable, so the key must carry
  // the refund's own row identity. Fall back to the payment row id, and only
  // then to amount-only, so behaviour degrades rather than breaking.
  const refundIdentity =
    (spec.paymentRecord.refund_row_id as string | undefined) ??
    (spec.paymentRecord.id as string | undefined) ??
    String(amount);
  const idempotencyKey = await squareIdempotencyKey(
    `rfnd-${squarePaymentId}-${refundIdentity}-${amount}`,
  );

  try {
    const res = await squareFetch<{ refund?: Record<string, unknown> }>({
      mode,
      accessToken: conn.accessToken,
      method: "POST",
      path: "/v2/refunds",
      idempotencyKey,
      body: {
        payment_id: squarePaymentId,
        amount_money: { amount, currency },
        reason: spec.reason?.slice(0, 192),
      },
    });

    const refund = res.refund ?? {};
    // A Square refund is PENDING here and settles later via refund.updated, and
    // can still land REJECTED. Never write Completed off this response.
    return servedBySquare({
      provider: "square",
      refundId: refund.id,
      squareRefundId: refund.id,
      amountCents: amount,
      currency,
      status: mapSquareRefundStatus(String(refund.status ?? "PENDING")),
      settlesAsynchronously: true,
    });
  } catch (err) {
    // Without this, a currency/amount rejection escaped as an unhandled
    // SquareError and the caller returned a 500 instead of a usable message.
    if (err instanceof SquareError) {
      return failed("square_refund_failed", err.httpStatus >= 500 ? 502 : 400, {
        category: err.category,
        code: err.code,
        detail: err.message,
        amountCents: amount,
        currency,
      });
    }
    throw err;
  }
}

export { mapSquarePaymentStatus };
