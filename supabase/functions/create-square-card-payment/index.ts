// create-square-card-payment — charge a card tokenised in the browser.
//
// The counterpart to create-checkout-session's hosted link. The renter enters
// their card on OUR page, Square's Web Payments SDK tokenises it, and only the
// opaque single-use token reaches this function. A card number never does.
//
// WHY A SEPARATE FUNCTION RATHER THAN A BRANCH IN create-checkout-session
//
// That function's contract is "give me a URL to send someone to". This one
// takes the money synchronously and returns a result. Folding them together
// would mean one endpoint whose response shape depends on a flag, and whose
// Stripe path would have to grow a card-token branch it can never use.
// create-checkout-session stays byte-identical for Stripe as a result.
//
// SQUARE-ONLY, BY REFUSAL RATHER THAN BY ASSUMPTION. A Stripe tenant reaching
// here is a routing bug in the caller, and answering it would take money on the
// wrong rail. It is refused with 409 and named.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { resolvePaymentProvider } from "../_shared/payments/resolve.ts";
import { createSquareCardPayment } from "../_shared/payments/square-adapter.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const body = await req.json().catch(() => ({}));
    const {
      tenantId,
      sourceId,
      verificationToken,
      totalAmount,
      rentalId,
      bookingId,
      customerId,
      targetCategories,
      extensionId,
      // Emailed-link flow: settle THIS row rather than create another.
      paymentId,
    } = body ?? {};

    if (!tenantId) return errorResponse("tenantId is required");
    if (!sourceId) return errorResponse("sourceId (card token) is required");

    const amountNum = Number(totalAmount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return errorResponse("totalAmount must be a positive number");
    }

    const resolution = await resolvePaymentProvider(supabase, tenantId);
    if (resolution.provider !== "square") {
      return errorResponse(
        `This tenant takes payments through ${resolution.provider}. Use create-checkout-session instead.`,
        409,
      );
    }

    const { data: tenant } = await supabase
      .from("tenants")
      .select("currency_code")
      .eq("id", tenantId)
      .single();

    const referenceId = rentalId || bookingId || "";

    // customer_id is NOT NULL on payments, so resolve it before building the row
    // — the same reason create-checkout-session hoists this lookup.
    let resolvedCustomerId = customerId as string | undefined;
    if (!resolvedCustomerId && referenceId) {
      const { data: rental } = await supabase
        .from("rentals")
        .select("customer_id")
        .eq("id", referenceId)
        .single();
      resolvedCustomerId = rental?.customer_id;
    }

    const routed = await createSquareCardPayment(supabase, resolution, {
      amountCents: Math.round(amountNum * 100),
      currency: String(tenant?.currency_code ?? "USD").toLowerCase(),
      sourceId: String(sourceId),
      verificationToken: verificationToken ? String(verificationToken) : undefined,
      reference: { paymentId: String(referenceId) },
      existingPaymentRowId: paymentId ? String(paymentId) : undefined,
      // Only build a row to insert when we are NOT settling an existing one.
      paymentRow: paymentId ? undefined : resolvedCustomerId
        ? {
            ...(rentalId ? { rental_id: rentalId } : {}),
            customer_id: resolvedCustomerId,
            tenant_id: tenantId,
            amount: Math.round(amountNum * 100) / 100,
            remaining_amount: Math.round(amountNum * 100) / 100,
            payment_date: new Date().toISOString().split("T")[0],
            method: "Card",
            payment_type: "Payment",
            verification_status: "pending",
            booking_source: "website",
            ...(Array.isArray(targetCategories) && targetCategories.length > 0
              ? { target_categories: targetCategories }
              : {}),
            ...(extensionId ? { extension_id: extensionId } : {}),
          }
        : undefined,
    });

    // A skip is handled:true with no error flag — reported as success it would
    // tell a renter their card was charged when nothing was sent to Square.
    if (routed.error || routed.skipped) {
      return errorResponse(
        String(routed.reason ?? "Square card payment failed"),
        routed.httpStatus ?? (routed.skipped ? 409 : 502),
      );
    }

    return jsonResponse(routed.body ?? {});
  } catch (err) {
    console.error("[create-square-card-payment]", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
