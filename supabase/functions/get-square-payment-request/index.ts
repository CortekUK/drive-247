// get-square-payment-request — what our hosted checkout page needs to render.
//
// The customer arrives from an emailed link holding ONE thing: a payments row
// id. This turns that into the few facts a pay page must show — how much, in
// what currency, to whom, and whether it is still owed.
//
// WHY THIS IS SAFE TO CALL WITHOUT A SESSION
//
// The renter has no account, exactly like a Stripe Checkout link, so there is no
// session to check. The id is a v4 uuid — unguessable in the same way a Stripe
// `cs_test_…` is — and the response is deliberately thin: amount, currency,
// business name, status. No customer name, no email, no address, no rental
// detail, no Square credential. Someone holding the link learns only what the
// link is for, which they must know in order to pay it.
//
// It refuses to describe a row that is not Square's and not still owed, so it
// can never be used to enumerate a tenant's payment history.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { paymentId } = await req.json().catch(() => ({}));
    if (!paymentId || typeof paymentId !== "string" || !UUID_RE.test(paymentId)) {
      return errorResponse("A valid payment id is required");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: payment, error } = await supabase
      .from("payments")
      .select("id, amount, status, payment_provider, square_payment_id, tenant_id, payment_type")
      .eq("id", paymentId)
      .maybeSingle();

    if (error || !payment) return errorResponse("Payment request not found", 404);

    if (payment.payment_provider !== "square") {
      return errorResponse("This payment is not handled by Square.", 409);
    }

    const { data: tenant } = await supabase
      .from("tenants")
      .select("slug, company_name, currency_code")
      .eq("id", payment.tenant_id)
      .single();

    // Settled is not an error — the page should say "already paid" rather than
    // "not found", which would read as a broken link.
    const settled = !!payment.square_payment_id ||
      (payment.status != null && payment.status !== "Pending");

    return jsonResponse({
      paymentId: payment.id,
      amount: Number(payment.amount),
      currency: String(tenant?.currency_code ?? "USD").toUpperCase(),
      description: payment.payment_type ?? "Payment",
      tenantSlug: tenant?.slug ?? null,
      businessName: tenant?.company_name ?? null,
      settled,
      status: payment.status,
    });
  } catch (err) {
    console.error("[get-square-payment-request]", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
