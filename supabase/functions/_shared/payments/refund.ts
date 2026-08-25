/**
 * Square integration — refund dispatch (the 5-line preamble).
 *
 *     const routed = await tryProviderRefund(supabase, tenantId, {
 *       paymentRecord, amountCents, reason,
 *     });
 *     if (routed.handled) return jsonResponse(routed.body!);
 *     // ---- existing Stripe code below, byte-identical ----
 *
 * Routing is by the PAYMENT ROW, not the tenant's current provider. A refund must
 * always be issued on the rail the original charge was taken on. The DB CHECK
 * payments_provider_handle_exclusivity_check makes the two impossible to confuse:
 * a Square payment cannot carry a stripe_* handle.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { PASSTHROUGH, ProviderOutcome, skip } from "./types.ts";
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
  supabase: SupabaseClient,
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

  const { data: tenantRow } = await supabase
    .from("tenants")
    .select("id, payment_provider, square_mode, country")
    .eq("id", tenantId)
    .single();

  const resolution = resolveFromTenantRow((tenantRow ?? { id: tenantId, payment_provider: "square" }) as Record<string, unknown>);
  return await refundSquarePayment(supabase, resolution, spec);
}
