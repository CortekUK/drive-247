import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Processing scheduled refunds...');

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
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
