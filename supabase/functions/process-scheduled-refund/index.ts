import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ImmediateRefundRequest {
  paymentId: string;
  paymentIntentId?: string; // Can be provided directly if not in payment record
  amount?: number;
  reason?: string;
  tenantId?: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Initialize Stripe
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeSecretKey) {
      throw new Error('STRIPE_SECRET_KEY not configured');
    }
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2023-10-16',
    });

    // Check if this is an immediate refund request (has paymentId in body)
    let requestBody: ImmediateRefundRequest | null = null;
    try {
      requestBody = await req.json();
    } catch {
      // No body or invalid JSON - this is a scheduled refund batch request
      requestBody = null;
    }

    // IMMEDIATE REFUND: Process a single refund right now
    if (requestBody?.paymentId) {
      console.log('Processing immediate refund for payment:', requestBody.paymentId);

      // Get payment details
      const { data: payment, error: paymentError } = await supabase
        .from('payments')
        .select('*, rentals(tenant_id, customer_id)')
        .eq('id', requestBody.paymentId)
        .single();

      if (paymentError || !payment) {
        throw new Error(`Payment not found: ${paymentError?.message || 'Unknown error'}`);
      }

      // Use provided paymentIntentId or fall back to the one in payment record
      const paymentIntentId = requestBody.paymentIntentId || payment.stripe_payment_intent_id;

      if (!paymentIntentId) {
        throw new Error('Payment has no Stripe payment intent. Please provide one from Stripe Dashboard.');
      }

      // Get tenant's Stripe Connect account
      const tenantId = requestBody.tenantId || payment.tenant_id || payment.rentals?.tenant_id;
      let stripeAccountId: string | null = null;

      if (tenantId) {
        const { data: tenant } = await supabase
          .from('tenants')
          .select('stripe_account_id, stripe_onboarding_complete')
          .eq('id', tenantId)
          .single();

        if (tenant?.stripe_account_id && tenant?.stripe_onboarding_complete) {
          stripeAccountId = tenant.stripe_account_id;
          console.log('Using Stripe Connect account:', stripeAccountId);
        }
      }

      const stripeOptions = stripeAccountId ? { stripeAccount: stripeAccountId } : undefined;
      const refundAmount = requestBody.amount || payment.amount;

      // Process refund via Stripe
      const refundParams: Stripe.RefundCreateParams = {
        payment_intent: paymentIntentId,
        amount: Math.round(refundAmount * 100), // Convert to cents
        reason: 'requested_by_customer',
        metadata: {
          payment_id: payment.id,
          reason: requestBody.reason || 'Refund requested'
        }
      };

      // For Stripe Connect with destination charges (platform creates charge):
      // - Create refund on platform WITHOUT stripeAccount option
      // - Set reverse_transfer: true to pull money back from connected account
      // For direct charges (connected account creates charge):
      // - Create refund on connected account WITH stripeAccount option
      // - Do NOT set reverse_transfer

      let stripeRefund;
      let platformError: Error | null = null;
      let connectedError: Error | null = null;

      // Try platform account FIRST (destination charges create PaymentIntents on platform)
      try {
        console.log('Trying Stripe refund on platform account');
        stripeRefund = await stripe.refunds.create(refundParams);
        console.log('Stripe refund created on platform:', stripeRefund.id);
      } catch (platformErr: any) {
        console.log('Refund on platform account failed:', platformErr.message);
        platformError = platformErr;
      }

      // If platform failed and we have a connected account, try that
      if (!stripeRefund && stripeAccountId) {
        try {
          console.log('Trying Stripe refund on connected account:', stripeAccountId);
          stripeRefund = await stripe.refunds.create(refundParams, { stripeAccount: stripeAccountId });
          console.log('Stripe refund created on connected account:', stripeRefund.id);
        } catch (connectedErr: any) {
          console.log('Refund on connected account failed:', connectedErr.message);
          connectedError = connectedErr;
        }
      }

      if (!stripeRefund) {
        if (platformError && connectedError) {
          throw new Error(`Refund failed on both platform (${platformError.message}) and connected account (${connectedError.message})`);
        }
        throw platformError || connectedError || new Error('Failed to create refund');
      }

      // Update payment record
      await supabase
        .from('payments')
        .update({
          refund_status: 'completed',
          refund_processed_at: new Date().toISOString(),
          stripe_refund_id: stripeRefund.id,
          status: refundAmount >= payment.amount ? 'Refunded' : 'Partial Refund',
          refund_amount: refundAmount,
          refund_reason: requestBody.reason || 'Refund requested'
        })
        .eq('id', payment.id);

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Refund processed successfully',
          refundId: stripeRefund.id,
          amount: stripeRefund.amount / 100,
          status: stripeRefund.status
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // SCHEDULED REFUNDS: Batch process refunds due today
    console.log('Processing scheduled refunds...');

    // Get refunds due today
    const { data: refundsDue, error: queryError } = await supabase
      .rpc('get_refunds_due_today');

    if (queryError) {
      throw new Error(`Failed to query refunds: ${queryError.message}`);
    }

    if (!refundsDue || refundsDue.length === 0) {
      console.log('No refunds due today');
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No refunds due today',
          processedCount: 0
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log(`Found ${refundsDue.length} refunds to process`);

    const results = [];

    // Process each refund
    for (const refund of refundsDue) {
      try {
        console.log(`Processing refund for payment ${refund.payment_id}...`);

        // Update status to processing
        await supabase
          .from('payments')
          .update({ refund_status: 'processing' })
          .eq('id', refund.payment_id);

        // Process refund via Stripe
        const stripeRefund = await stripe.refunds.create({
          payment_intent: refund.stripe_payment_intent_id,
          amount: Math.round(refund.refund_amount * 100), // Convert to cents
          reason: 'requested_by_customer',
          // For Stripe Connect: reverse the transfer to pull money from tenant
          reverse_transfer: true,
          metadata: {
            payment_id: refund.payment_id,
            customer_id: refund.customer_id,
            rental_id: refund.rental_id,
            reason: refund.refund_reason
          }
        });

        console.log(`Stripe refund created: ${stripeRefund.id}`);

        // Update payment with completed refund
        await supabase
          .from('payments')
          .update({
            refund_status: 'completed',
            refund_processed_at: new Date().toISOString(),
            stripe_refund_id: stripeRefund.id,
            status: refund.refund_amount >= refund.payment_amount ? 'Refunded' : 'Partial Refund'
          })
          .eq('id', refund.payment_id);

        // Send notification email
        await supabase.functions.invoke('notify-refund-processed', {
          body: {
            customerEmail: refund.customer_email,
            customerName: refund.customer_name,
            refundAmount: refund.refund_amount,
            reason: refund.refund_reason
          }
        }).catch(err => {
          console.warn('Failed to send refund notification email:', err);
        });

        results.push({
          paymentId: refund.payment_id,
          success: true,
          refundId: stripeRefund.id,
          amount: refund.refund_amount
        });

        console.log(`✓ Refund processed successfully for payment ${refund.payment_id}`);

      } catch (error: any) {
        console.error(`✗ Failed to process refund for payment ${refund.payment_id}:`, error);

        // Update status to failed
        await supabase
          .from('payments')
          .update({
            refund_status: 'failed',
            refund_reason: `${refund.refund_reason}\n\nError: ${error.message}`
          })
          .eq('id', refund.payment_id);

        results.push({
          paymentId: refund.payment_id,
          success: false,
          error: error.message
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    console.log(`Refund processing complete: ${successCount} succeeded, ${failCount} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Processed ${results.length} refunds`,
        processedCount: successCount,
        failedCount: failCount,
        results
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error: any) {
    console.error('Process scheduled refunds error:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Failed to process scheduled refunds'
      }),
      {
        status: 200, // Return 200 to avoid FunctionsHttpError, success: false indicates failure
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
