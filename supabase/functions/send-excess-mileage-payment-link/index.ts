// Create a Stripe Checkout Session for excess mileage payment and email the customer a pay link

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getStripeClient, getTenantStripeMode, getConnectAccountId, getStripeOptions } from "../_shared/stripe-client.ts";
import { sendResendEmail, getTenantBranding, wrapWithBrandedTemplate } from "../_shared/resend-service.ts";
import { formatCurrency } from "../_shared/format-utils.ts";

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

    // Fetch tenant details for Stripe and branding
    const { data: tenantData, error: tenantError } = await supabase
      .from("tenants")
      .select("slug, stripe_mode, stripe_account_id, stripe_onboarding_complete, currency_code")
      .eq("id", effectiveTenantId)
      .single();

    if (tenantError || !tenantData) {
      return errorResponse("Tenant not found", 404);
    }

    const currencyCode = tenantData.currency_code || "GBP";
    const stripeMode = (tenantData.stripe_mode || "test") as "test" | "live";
    const stripe = getStripeClient(stripeMode);
    const connectAccountId = getConnectAccountId(tenantData);
    const stripeOptions = getStripeOptions(connectAccountId);

    const customer = rental.customer as { id: string; name: string; email: string; phone: string } | null;
    const vehicle = rental.vehicle as { id: string; make: string; model: string; reg: string } | null;

    if (!customer?.email) {
      return errorResponse("Customer email not found");
    }

    const bookingDomain = `${tenantData.slug}.drive-247.com`;

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: currencyCode.toLowerCase(),
              unit_amount: Math.round(amount * 100),
              product_data: {
                name: "Excess Mileage Charge",
                description: vehicle
                  ? `${vehicle.make} ${vehicle.model} (${vehicle.reg})`
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

    console.log("[EXCESS-MILEAGE-LINK] Created checkout session:", session.id);

    // Create a payments record
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
      stripe_checkout_session_id: session.id,
    });

    if (paymentError) {
      console.error("[EXCESS-MILEAGE-LINK] Failed to create payment record:", paymentError);
    }

    // Send email with payment link
    const branding = await getTenantBranding(effectiveTenantId, supabase);
    const vehicleName = vehicle ? `${vehicle.make} ${vehicle.model} (${vehicle.reg})` : "your rental vehicle";
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
            <a href="${session.url}" style="display: inline-block; background: ${branding.accentColor}; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: 600;">
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
      sessionUrl: session.url,
      sessionId: session.id,
      emailSent: emailResult.success,
    });
  } catch (error: any) {
    console.error("[EXCESS-MILEAGE-LINK] Error:", error);
    return errorResponse(error.message, 500);
  }
});
