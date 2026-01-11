import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
    apiVersion: "2023-10-16",
    httpClient: Stripe.createFetchHttpClient(),
});

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Syncs the Stripe Payment Intent ID for a specific payment.
 * Tries multiple methods:
 * 1. Uses stripe_checkout_session_id if available
 * 2. Falls back to searching Stripe payments by customer email and amount
 */
serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    try {
        const supabase = createClient(
            Deno.env.get("SUPABASE_URL") ?? "",
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
        );

        const { paymentId, tenantId } = await req.json();

        if (!paymentId) {
            return new Response(
                JSON.stringify({ success: false, error: "paymentId is required" }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        console.log(`Sync payment intent for payment: ${paymentId}`);

        // Get the payment record with rental and customer info
        const { data: payment, error: paymentError } = await supabase
            .from("payments")
            .select(`
        id, 
        stripe_checkout_session_id, 
        stripe_payment_intent_id, 
        tenant_id,
        amount,
        rental_id,
        created_at
      `)
            .eq("id", paymentId)
            .single();

        if (paymentError || !payment) {
            console.error(`Payment not found: ${paymentError?.message}`);
            return new Response(
                JSON.stringify({ success: false, error: `Payment not found` }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // If payment intent ID already exists, return it
        if (payment.stripe_payment_intent_id) {
            console.log(`Payment already has stripe_payment_intent_id: ${payment.stripe_payment_intent_id}`);
            return new Response(
                JSON.stringify({
                    success: true,
                    paymentIntentId: payment.stripe_payment_intent_id,
                    alreadyExists: true,
                }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Get Stripe Connect account for this tenant
        const effectiveTenantId = tenantId || payment.tenant_id;
        let stripeOptions: { stripeAccount?: string } = {};
        let tenantStripeAccountId: string | null = null;

        if (effectiveTenantId) {
            const { data: tenant } = await supabase
                .from("tenants")
                .select("stripe_account_id, stripe_onboarding_complete")
                .eq("id", effectiveTenantId)
                .single();

            if (tenant?.stripe_account_id && tenant?.stripe_onboarding_complete) {
                stripeOptions = { stripeAccount: tenant.stripe_account_id };
                tenantStripeAccountId = tenant.stripe_account_id;
                console.log(`Using Stripe Connect account: ${tenant.stripe_account_id}`);
            }
        }

        let paymentIntentId: string | null = null;

        // METHOD 1: Try using checkout session ID if available
        if (payment.stripe_checkout_session_id) {
            console.log(`Trying checkout session: ${payment.stripe_checkout_session_id}`);
            try {
                const session = await stripe.checkout.sessions.retrieve(
                    payment.stripe_checkout_session_id,
                    stripeOptions
                );
                if (session.payment_intent) {
                    paymentIntentId = typeof session.payment_intent === "string"
                        ? session.payment_intent
                        : session.payment_intent.id;
                    console.log(`Found payment_intent via checkout session: ${paymentIntentId}`);
                }
            } catch (err: any) {
                console.log(`Checkout session lookup failed: ${err.message}`);
                // Try without stripeAccount
                if (stripeOptions.stripeAccount) {
                    try {
                        const session = await stripe.checkout.sessions.retrieve(payment.stripe_checkout_session_id);
                        if (session.payment_intent) {
                            paymentIntentId = typeof session.payment_intent === "string"
                                ? session.payment_intent
                                : session.payment_intent.id;
                            console.log(`Found payment_intent via checkout session (platform): ${paymentIntentId}`);
                        }
                    } catch (retryErr: any) {
                        console.log(`Checkout session lookup failed (platform): ${retryErr.message}`);
                    }
                }
            }
        }

        // METHOD 2: Search Stripe payments by amount and date
        if (!paymentIntentId && payment.amount) {
            console.log(`Trying to find payment by amount: ${payment.amount}`);

            // Convert amount to cents for Stripe
            const amountInCents = Math.round(payment.amount * 100);

            // Get payment created time and search +/- 1 day
            const paymentDate = new Date(payment.created_at);
            const startDate = Math.floor((paymentDate.getTime() - 86400000) / 1000); // -1 day in seconds
            const endDate = Math.floor((paymentDate.getTime() + 86400000) / 1000); // +1 day in seconds

            try {
                const searchParams: any = {
                    limit: 50,
                    created: { gte: startDate, lte: endDate },
                };

                const paymentIntents = await stripe.paymentIntents.list(searchParams, stripeOptions);

                // Find matching payment intent by amount
                for (const pi of paymentIntents.data) {
                    if (pi.amount === amountInCents && pi.status === "succeeded") {
                        console.log(`Found matching payment_intent by amount: ${pi.id}`);
                        paymentIntentId = pi.id;
                        break;
                    }
                }

                // If not found with stripeAccount, try platform
                if (!paymentIntentId && stripeOptions.stripeAccount) {
                    const platformPIs = await stripe.paymentIntents.list({
                        limit: 50,
                        created: { gte: startDate, lte: endDate },
                    });

                    for (const pi of platformPIs.data) {
                        if (pi.amount === amountInCents && pi.status === "succeeded") {
                            console.log(`Found matching payment_intent by amount (platform): ${pi.id}`);
                            paymentIntentId = pi.id;
                            break;
                        }
                    }
                }
            } catch (searchErr: any) {
                console.log(`Payment search failed: ${searchErr.message}`);
            }
        }

        // METHOD 3: Get customer email and search by customer
        if (!paymentIntentId && payment.rental_id) {
            console.log(`Trying to find payment via customer email`);

            const { data: rental } = await supabase
                .from("rentals")
                .select("customer:customers(email)")
                .eq("id", payment.rental_id)
                .single();

            if (rental?.customer?.email) {
                const customerEmail = rental.customer.email;
                console.log(`Searching for payments by email: ${customerEmail}`);

                try {
                    // Search for Stripe customers with this email
                    const customers = await stripe.customers.list({
                        email: customerEmail,
                        limit: 5,
                    }, stripeOptions);

                    for (const customer of customers.data) {
                        // Get payment intents for this customer
                        const paymentIntents = await stripe.paymentIntents.list({
                            customer: customer.id,
                            limit: 10,
                        }, stripeOptions);

                        const amountInCents = Math.round(payment.amount * 100);
                        for (const pi of paymentIntents.data) {
                            if (pi.amount === amountInCents && pi.status === "succeeded") {
                                console.log(`Found payment_intent via customer: ${pi.id}`);
                                paymentIntentId = pi.id;
                                break;
                            }
                        }
                        if (paymentIntentId) break;
                    }
                } catch (customerErr: any) {
                    console.log(`Customer search failed: ${customerErr.message}`);
                }
            }
        }

        if (!paymentIntentId) {
            console.log("Could not find payment intent using any method");
            return new Response(
                JSON.stringify({
                    success: false,
                    error: "Could not find matching payment in Stripe. Please enter the Payment Intent ID manually.",
                }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Update the payment record with the found payment intent ID
        const { error: updateError } = await supabase
            .from("payments")
            .update({
                stripe_payment_intent_id: paymentIntentId,
                updated_at: new Date().toISOString(),
            })
            .eq("id", paymentId);

        if (updateError) {
            console.error(`Failed to update payment: ${updateError.message}`);
            return new Response(
                JSON.stringify({
                    success: true, // Still success since we found the ID
                    paymentIntentId,
                    saved: false,
                    error: `Found ID but failed to save: ${updateError.message}`,
                }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        console.log(`Successfully synced payment ${paymentId} with payment_intent ${paymentIntentId}`);

        return new Response(
            JSON.stringify({
                success: true,
                paymentIntentId,
                saved: true,
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error: any) {
        console.error("Sync payment intent error:", error);
        return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
