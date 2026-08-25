/**
 * Square integration — checkout dispatch (the 5-line preamble).
 *
 * USAGE at each of the 12 in-scope checkout creators. Adds lines, deletes none:
 *
 *     const routed = await tryProviderCheckout(supabase, tenantId, {
 *       amountCents, currency, description,
 *       redirectUrl: successUrl, reference: { paymentId },
 *       requiresStoredCredential: false,
 *     });
 *     if (routed.handled) return jsonResponse(routed.body!);
 *     // ---- existing Stripe code below, byte-identical ----
 *
 * The 3 multi-tenant cron sweepers (send-payg-reminders, auto-extend-rentals,
 * send-auto-extension-reminder) are a DIFFERENT shape and get no preamble: their
 * checkout.sessions.create sits inside a per-rental loop, so their only change is
 * `.eq('payment_provider','stripe')` on the driving query via predicates.ts.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { PASSTHROUGH, ProviderOutcome, skip } from "./types.ts";
import { resolvePaymentProvider } from "./resolve.ts";
import { capabilitiesFor } from "./capabilities.ts";
import { createSquareCheckout, SquareCheckoutSpec } from "./square-adapter.ts";

export interface CheckoutSpec extends SquareCheckoutSpec {
  /**
   * Set true for a flow that must charge this card again later with nobody
   * present (installments, auto-extend auto_charge, saved-card).
   *
   * This is THE gate. It is expressed as a requirement of the flow, never as a
   * test of the provider name, so provider #3 needs no new branch here.
   */
  requiresStoredCredential?: boolean;
}

export async function tryProviderCheckout(
  supabase: SupabaseClient,
  tenantId: string,
  spec: CheckoutSpec,
): Promise<ProviderOutcome> {
  const resolution = await resolvePaymentProvider(supabase, tenantId);
  if (resolution.provider === "stripe") return PASSTHROUGH;

  const caps = capabilitiesFor(resolution.provider);

  // Deliberate, non-error skip. Mirrors place-deposit-hold:209's shape so callers
  // and crons treat it as a no-op. A throw here would page someone for a feature
  // that is switched off on purpose.
  if (spec.requiresStoredCredential && !caps.supportsStoredCredential) {
    return skip("provider_cannot_store_credential", {
      provider: resolution.provider,
      hint: "This flow needs to charge a card later with nobody present; this processor's hosted checkout cannot vault a card.",
    });
  }

  return await createSquareCheckout(supabase, resolution, spec);
}
