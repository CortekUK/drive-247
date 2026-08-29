// Create a Stripe Checkout Session for excess mileage payment and email the customer a pay link

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getConnectAccountId, getChargePlatformAccount, getStripeClientForAccount, getStripeOptions } from "../_shared/stripe-client.ts";
import { sendResendEmail, getTenantBranding, wrapWithBrandedTemplate } from "../_shared/resend-service.ts";
import { formatCurrency } from "../_shared/format-utils.ts";
import { tryProviderCheckout } from "../_shared/payments/checkout.ts";
import { hidePlateForTenant, vehicleLabel } from "../_shared/vehicle-privacy.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { rentalId, amount, tenantId } = await req.json();

    if (!rentalId || !amount || amount <= 0) {
      return errorResponse("Missing required fields: rentalId, amount (positive)");
    }

    console.log("[EXCESS-MILEAGE-LINK] Creating payment link for rental:", rentalId, "amount:", amount);

    // Fetch rental with customer and vehicle
    const { data: rental, error: rentalError } = await supabase
      .from("rentals")
      .select(`
        id, tenant_id, customer_id, vehicle_id,
        customer:customers(id, name, email, phone),
        vehicle:vehicles(id, make, model, reg)
      `)
      .eq("id", rentalId)
      .single();

    if (rentalError || !rental) {
      return errorResponse("Rental not found", 404);
    }

    const effectiveTenantId = tenantId || rental.tenant_id;
    const hidePlate = await hidePlateForTenant(supabase, effectiveTenantId);

    // Fetch tenant details for Stripe and branding
    const { data: tenantData, error: tenantError } = await supabase
      .from("tenants")
      .select("slug, payment_provider, stripe_mode, stripe_account_id, stripe_onboarding_complete, payment_model, own_stripe_account_id, own_stripe_test_account_id, currency_code")
      .eq("id", effectiveTenantId)
      .single();

    if (tenantError || !tenantData) {
      return errorResponse("Tenant not found", 404);
    }

    const currencyCode = tenantData.currency_code || "USD";
    const stripeMode = (tenantData.stripe_mode || "test") as "test" | "live";
    const platformAccount = getChargePlatformAccount(tenantData);
    const stripe = getStripeClientForAccount(platformAccount, stripeMode);
    const connectAccountId = getConnectAccountId(tenantData);
    const stripeOptions = getStripeOptions(connectAccountId);

    const customer = rental.customer as { id: string; name: string; email: string; phone: string } | null;
    const vehicle = rental.vehicle as { id: string; make: string; model: string; reg: string } | null;

    if (!customer?.email) {
      return errorResponse("Customer email not found");
    }

    const bookingDomain = `${tenantData.slug}.drive-247.com`;

    // ---- PROVIDER DISPATCH (Square) -------------------------------------
    // A one-off charge for excess mileage. No setup_future_usage anywhere in
    // this session, so nothing charges the card again later and Square serves
    // it perfectly well.
    const routedMileage = await tryProviderCheckout(supabase, effectiveTenantId, {
      amountCents: Math.round(amount * 100),
      currency: currencyCode.toLowerCase(),
      description: "Excess Mileage Charge",
      redirectUrl: `https://${bookingDomain}/booking-success?type=invoice&status=paid`,
      reference: { paymentId: String(rentalId) },
      requiresStoredCredential: false,
      // Pre-inserted by the seam rather than written below.
      //
      // This function used to write its own row, correctly, but AFTER the link
      // existed. The window is small and it is real: Square emits
      // payment.created the instant the buyer pays, and a buyer who pays before
      // this insert commits hits a webhook with nothing to match. Handing the
      // row to the seam closes it — and makes every Square call site in the
      // codebase follow one ordering rule instead of two.
      paymentRow: {
        rental_id: rentalId,
        customer_id: rental.customer_id,
        vehicle_id: rental.vehicle_id,
        tenant_id: effectiveTenantId,
        amount,
        remaining_amount: amount,
        payment_date: new Date().toISOString().split("T")[0],
        apply_from_date: new Date().toISOString().split("T")[0],
        method: "Card",
        payment_type: "Excess Mileage",
        platform_account: platformAccount,
      },
    });

    if (routedMileage.error) {
      return errorResponse(
        String(routedMileage.reason ?? "Square checkout failed"),
        routedMileage.httpStatus ?? 502,
      );
    }

    // Deliberately NOT an early return. Everything below — the payments row and
    // the customer email — is the point of this function, and both are
    // provider-neutral. Returning here would create a Square link that nobody is
    // ever sent and that no local row can correlate a webhook to.
    //
    // A SKIP IS NOT A LINK. skip() is handled:true with no error flag and a body
    // of {skipped, reason} — no url. Treating it as a Square success set
    // paymentUrl to "" and still sent the customer a branded "Pay Now" button
    // pointing at nothing, while the `if (!squareBody)` fence below suppressed
    // the Stripe row too. Refuse instead: no link is a failure, not a send.
    if (routedMileage.skipped) {
      return errorResponse(
        `Square payment link NOT created: ${routedMileage.reason ?? "provider skipped"}. ` +
          `No email has been sent.`,
        409,
      );
    }

    const squareBody = routedMileage.handled
      ? ((routedMileage.body ?? {}) as Record<string, unknown>)
      : null;
    // ---- END PROVIDER DISPATCH — Stripe code below is unchanged ------------

    // Create Stripe Checkout Session
    const session = squareBody ? null : await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: currencyCode.toLowerCase(),
              unit_amount: Math.round(amount * 100),
              product_data: {
                name: "Excess Mileage Charge",
                // Stripe renders this on the Checkout page AND emails it on the
                // receipt, which we cannot retract later — so it must respect
                // the flag at the point the string is built.
                description: vehicle
                  ? vehicleLabel(vehicle, hidePlate)
                  : `Rental ${rentalId.substring(0, 8).toUpperCase()}`,
              },
            },
            quantity: 1,
          },
        ],
        metadata: {
          type: "excess_mileage",
          rental_id: rentalId,
          tenant_id: effectiveTenantId,
        },
        customer_email: customer.email,
        success_url: `https://${bookingDomain}/portal/rentals?payment=success`,
        cancel_url: `https://${bookingDomain}/portal/rentals?payment=cancelled`,
      },
      stripeOptions
    );

    // One link, whichever rail produced it. Everything downstream uses this.
    const paymentUrl = squareBody ? String(squareBody.url ?? "") : (session?.url ?? "");
    console.log("[EXCESS-MILEAGE-LINK] Created checkout link:", squareBody ? "square" : session?.id);

    // Create a payments record — STRIPE ONLY.
    //
    // The Square row already exists: the seam inserted it before creating the
    // link, and stamped square_order_id / square_payment_link_id on it. Running
    // this insert on that rail too would produce a second, duplicate Pending row
    // for one collection, and payment_apply_fifo_v2 would happily allocate both.
    if (!squareBody) {
      const today = new Date().toISOString().split("T")[0];
      const { error: paymentError } = await supabase.from("payments").insert({
        rental_id: rentalId,
        customer_id: rental.customer_id,
        vehicle_id: rental.vehicle_id,
        tenant_id: effectiveTenantId,
        amount,
        payment_date: today,
        apply_from_date: today,
        method: "Card",
        payment_type: "Excess Mileage",
        status: "Pending",
        stripe_checkout_session_id: session!.id,
        platform_account: platformAccount,
      });

      if (paymentError) {
        console.error("[EXCESS-MILEAGE-LINK] Failed to create payment record:", paymentError);
      }
    }

    // Last line of defence, provider-neutral. Whatever produced paymentUrl, an
    // empty one must never reach the template — the customer would get a Pay Now
    // button that goes nowhere and no way to tell it apart from a real one.
    if (!paymentUrl) {
      console.error("[EXCESS-MILEAGE-LINK] no payment URL produced; refusing to send the email");
      return errorResponse("Could not create a payment link; no email sent.", 502);
    }

    // Send email with payment link
    const branding = await getTenantBranding(effectiveTenantId, supabase);
    const vehicleName = vehicle ? `${vehicleLabel(vehicle, hidePlate)}` : "your rental vehicle";
    const formattedAmount = formatCurrency(amount, currencyCode);

    const emailContent = `
      <tr>
        <td style="padding: 30px;">
          <h2 style="margin: 0 0 20px; color: #333; font-size: 22px;">Excess Mileage Charge</h2>
          <p style="margin: 0 0 15px; color: #555; font-size: 15px; line-height: 1.6;">
            Hi ${customer.name},
          </p>
          <p style="margin: 0 0 15px; color: #555; font-size: 15px; line-height: 1.6;">
            Your rental of <strong>${vehicleName}</strong> has exceeded the included mileage allowance.
            An excess mileage charge of <strong>${formattedAmount}</strong> has been applied.
          </p>
          <p style="margin: 0 0 25px; color: #555; font-size: 15px; line-height: 1.6;">
            Please click the button below to complete your payment:
          </p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${paymentUrl}" style="display: inline-block; background: ${branding.accentColor}; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: 600;">
              Pay ${formattedAmount} Now
            </a>
          </div>
          <p style="margin: 25px 0 0; color: #888; font-size: 13px; text-align: center;">
            Booking Ref: ${rentalId.substring(0, 8).toUpperCase()}
          </p>
        </td>
      </tr>`;

    const emailHtml = wrapWithBrandedTemplate(emailContent, branding);

    const emailResult = await sendResendEmail(
      {
        to: customer.email,
        subject: `Excess Mileage Charge - ${formattedAmount}`,
        html: emailHtml,
        tenantId: effectiveTenantId,
      },
      supabase
    );

    console.log("[EXCESS-MILEAGE-LINK] Email sent:", emailResult.success);

    return jsonResponse({
      success: true,
      // `session` is null on the Square rail, so these must be optional rather
      // than dereferenced. Existing Stripe callers keep the exact same two keys.
      sessionUrl: paymentUrl,
      sessionId: session?.id ?? null,
      provider: squareBody ? "square" : "stripe",
      emailSent: emailResult.success,
    });
  } catch (error: any) {
    console.error("[EXCESS-MILEAGE-LINK] Error:", error);
    return errorResponse(error.message, 500);
  }
});
