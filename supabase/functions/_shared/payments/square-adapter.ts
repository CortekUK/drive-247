/**
 * Square adapter — the only file that knows how Square takes money.
 *
 * Credentials come from `square_connections` via a SECURITY DEFINER RPC that
 * decrypts Vault secret ids, exactly as `accounting_get_tokens` does for Xero and
 * Zoho. Raw tokens are never stored in a column and never logged.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { ProviderResolution, servedBySquare, ProviderOutcome, skip, SquareError } from "./types.ts";
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
}

/**
 * Load a tenant's Square credentials.
 *
 * Returns null rather than throwing when there is no active connection, so
 * callers can SKIP (a tenant mid-onboarding is not an error).
 */
async function loadConnection(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<SquareConnection | null> {
  const { data, error } = await supabase.rpc("square_get_tokens", { p_tenant_id: tenantId });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.access_token || !row?.location_id) return null;
  return {
    accessToken: row.access_token as string,
    merchantId: (row.merchant_id as string) ?? "",
    locationId: row.location_id as string,
  };
}

export async function createSquareCheckout(
  supabase: SupabaseClient,
  resolution: ProviderResolution,
  spec: SquareCheckoutSpec,
): Promise<ProviderOutcome> {
  const conn = await loadConnection(supabase, resolution.tenantId);
  if (!conn) return skip("square_not_connected", { tenantId: resolution.tenantId });

  const caps = capabilitiesFor("square");
  const mode = resolution.squareMode ?? "test";

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
      return skip("square_checkout_failed", {
        category: err.category, code: err.code, detail: err.message,
      });
    }
    throw err;
  }
}

export async function refundSquarePayment(
  supabase: SupabaseClient,
  resolution: ProviderResolution,
  spec: { paymentRecord: Record<string, unknown>; amountCents?: number; reason?: string },
): Promise<ProviderOutcome> {
  const conn = await loadConnection(supabase, resolution.tenantId);
  if (!conn) return skip("square_not_connected", { tenantId: resolution.tenantId });

  const squarePaymentId = spec.paymentRecord.square_payment_id as string | undefined;
  if (!squarePaymentId) return skip("square_payment_id_missing");

  const amount = spec.amountCents ?? (spec.paymentRecord.amount_cents as number | undefined);
  if (amount === undefined) return skip("refund_amount_unknown");

  const currency = String(spec.paymentRecord.currency ?? "USD").toUpperCase();
  const idempotencyKey = await squareIdempotencyKey(`rfnd-${squarePaymentId}-${amount}`);

  const res = await squareFetch<{ refund?: Record<string, unknown> }>({
    mode: resolution.squareMode ?? "test",
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
  // NOTE: a Square refund is PENDING here and settles later on refund.updated.
  // Do NOT write Completed off this response — see square-status-map.ts.
  return servedBySquare({
    provider: "square",
    refundId: refund.id,
    status: mapSquareRefundStatus(String(refund.status ?? "PENDING")),
    settlesAsynchronously: true,
  });
}

export { mapSquarePaymentStatus };
