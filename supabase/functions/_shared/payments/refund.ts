/**
 * Square integration — refund dispatch (the 5-line preamble).
 *
 *     const routed = await tryProviderRefund(supabase, tenantId, {
 *       paymentRecord, amountCents, reason,
 *     });
 *     if (routed.error)   return errorResponse(String(routed.reason), routed.httpStatus ?? 502);
 *     if (routed.handled) return jsonResponse(routed.body!);
 *     // ---- existing Stripe code below, byte-identical ----
 *
 * Checkout and refund deliberately share one fail policy. They previously
 * differed — checkout swallowed every API error, refund threw — so the same
 * Square outage produced a silent success on one path and a 500 on the other.
 *
 * Routing is by the PAYMENT ROW, not the tenant's current provider. A refund must
 * always be issued on the rail the original charge was taken on. The DB CHECK
 * payments_provider_handle_exclusivity_check makes the two impossible to confuse:
 * a Square payment cannot carry a stripe_* handle.
 */

import { PASSTHROUGH, ProviderOutcome, skip, failed, PaymentsSupabaseClient } from "./types.ts";
import { capabilitiesFor } from "./capabilities.ts";
import { resolveFromTenantRow } from "./resolve.ts";
import { refundSquarePayment } from "./square-adapter.ts";

export interface RefundSpec {
  /** The payments row being refunded. Must include payment_provider + handles. */
  paymentRecord: Record<string, unknown>;
  /** Omit for a full refund. */
  amountCents?: number;
  reason?: string;
}

export async function tryProviderRefund(
  supabase: PaymentsSupabaseClient,
  tenantId: string,
  spec: RefundSpec,
): Promise<ProviderOutcome> {
  // Route on the RECORD, never on the tenant's current provider.
  const recordProvider = spec.paymentRecord.payment_provider;
  if (recordProvider !== "square") return PASSTHROUGH;

  const caps = capabilitiesFor("square");

  if (spec.amountCents !== undefined && !caps.supportsPartialRefund) {
    return skip("provider_no_partial_refund", { provider: "square" });
  }

  const { data: tenantRow, error: tenantErr } = await supabase
    .from("tenants")
    .select("id, payment_provider, square_mode, country")
    .eq("id", tenantId)
    .single();

  // A tenant-read failure previously fell through to a default row, which
  // resolved square_mode to 'test' — so a LIVE refund would have been attempted
  // against the SANDBOX host and quietly done nothing. Refuse instead: we know
  // the payment is a Square payment (checked above), so we cannot fall back to
  // the Stripe rail, and guessing the mode on a refund is not acceptable.
  if (tenantErr || !tenantRow) {
    return failed("square_tenant_unreadable", 503, {
      tenantId,
      detail: tenantErr?.message ?? "tenant row not found",
      hint: "Cannot determine square_mode; refusing to guess between sandbox and live on a refund.",
    });
  }

  const resolution = resolveFromTenantRow(tenantRow as Record<string, unknown>);
  return await refundSquarePayment(supabase, resolution, spec);
}
