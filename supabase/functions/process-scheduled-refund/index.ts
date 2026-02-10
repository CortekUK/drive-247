import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { getStripeClient, getConnectAccountId, type StripeMode } from '../_shared/stripe-client.ts';
import { formatCurrency } from '../_shared/format-utils.ts';

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

      // Get tenant's Stripe mode and Connect account
      const tenantId = requestBody.tenantId || payment.tenant_id || payment.rentals?.tenant_id;
      let stripeMode: StripeMode = 'test'; // Default to test
      let stripeAccountId: string | null = null;
      let currencyCode = 'GBP';

      if (tenantId) {
        const { data: tenant } = await supabase
          .from('tenants')
          .select('stripe_mode, stripe_account_id, stripe_onboarding_complete, currency_code')
          .eq('id', tenantId)
          .single();

        if (tenant) {
          stripeMode = (tenant.stripe_mode as StripeMode) || 'test';
          stripeAccountId = getConnectAccountId(tenant);
          if (tenant.currency_code) {
            currencyCode = tenant.currency_code;
          }
          console.log('Tenant mode:', stripeMode, 'Connect account:', stripeAccountId);
        }
      }

      // Get Stripe client for the tenant's mode
      const stripe = getStripeClient(stripeMode);
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

      // For direct charges: create refund on connected account
      console.log('Processing Stripe refund', stripeAccountId ? `on connected account: ${stripeAccountId}` : 'on platform');
      const stripeRefund = await stripe.refunds.create(refundParams, stripeOptions);

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

      // Create ledger entries for the refund to track it properly
      // Get rental details for customer_id and vehicle_id
      const { data: rental } = await supabase
        .from('rentals')
        .select('customer_id, vehicle_id')
        .eq('id', payment.rental_id)
        .single();

      if (rental) {
        // Get the invoice to understand the breakdown of the original payment
        const { data: invoice } = await supabase
          .from('invoices')
          .select('rental_fee, tax_amount, service_fee, security_deposit')
          .eq('rental_id', payment.rental_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        // Create refund ledger entries proportionally based on what was charged
        // For rejection refunds, we refund everything that was paid
        const categories = [
          { name: 'Rental', amount: invoice?.rental_fee || 0 },
          { name: 'Tax', amount: invoice?.tax_amount || 0 },
          { name: 'Service Fee', amount: invoice?.service_fee || 0 },
          { name: 'Security Deposit', amount: invoice?.security_deposit || 0 },
        ].filter(c => c.amount > 0);

        const totalInvoice = categories.reduce((sum, c) => sum + c.amount, 0);

        for (const category of categories) {
          // Calculate proportional refund for this category
          const categoryRefund = totalInvoice > 0
            ? (category.amount / totalInvoice) * refundAmount
            : 0;

          if (categoryRefund > 0) {
            const ledgerEntry = {
              rental_id: payment.rental_id,
              customer_id: rental.customer_id,
              vehicle_id: rental.vehicle_id,
              tenant_id: tenantId,
              entry_date: new Date().toISOString().split('T')[0],
              due_date: new Date().toISOString().split('T')[0],
              type: 'Refund',
              category: category.name,
              amount: -Math.abs(categoryRefund), // Negative amount for refund
              remaining_amount: 0,
              reference: `Refund: ${requestBody.reason || 'Booking rejected'} (Stripe: ${stripeRefund.id})`,
            };

            await supabase.from('ledger_entries').insert(ledgerEntry);
            console.log(`Created ledger entry for ${category.name} refund: ${formatCurrency(categoryRefund, currencyCode)}`);
          }
        }
      }

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

        // Get tenant's Stripe mode and Connect account for this refund
        const { data: paymentRecord } = await supabase
          .from('payments')
          .select('tenant_id')
          .eq('id', refund.payment_id)
          .single();

        let batchStripeMode: StripeMode = 'test';
        let batchStripeAccountId: string | null = null;
        if (paymentRecord?.tenant_id) {
          const { data: tenant } = await supabase
            .from('tenants')
            .select('stripe_mode, stripe_account_id, stripe_onboarding_complete')
            .eq('id', paymentRecord.tenant_id)
            .single();

          if (tenant) {
            batchStripeMode = (tenant.stripe_mode as StripeMode) || 'test';
            batchStripeAccountId = getConnectAccountId(tenant);
          }
        }

        // Get Stripe client for this tenant's mode
        const batchStripe = getStripeClient(batchStripeMode);
        const batchStripeOptions = batchStripeAccountId ? { stripeAccount: batchStripeAccountId } : undefined;

        // Process refund via Stripe (on connected account for direct charges)
        console.log(`Creating refund (${batchStripeMode} mode)`, batchStripeAccountId ? `on connected account: ${batchStripeAccountId}` : 'on platform');
        const stripeRefund = await batchStripe.refunds.create({
          payment_intent: refund.stripe_payment_intent_id,
          amount: Math.round(refund.refund_amount * 100), // Convert to cents
          reason: 'requested_by_customer',
          metadata: {
            payment_id: refund.payment_id,
            customer_id: refund.customer_id,
            rental_id: refund.rental_id,
            reason: refund.refund_reason
          }
        }, batchStripeOptions);

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

        // Create ledger entries for the batch refund
        const { data: batchRental } = await supabase
          .from('rentals')
          .select('customer_id, vehicle_id')
          .eq('id', refund.rental_id)
          .single();

        if (batchRental) {
          const { data: batchInvoice } = await supabase
            .from('invoices')
            .select('rental_fee, tax_amount, service_fee, security_deposit')
            .eq('rental_id', refund.rental_id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

          const batchCategories = [
            { name: 'Rental', amount: batchInvoice?.rental_fee || 0 },
            { name: 'Tax', amount: batchInvoice?.tax_amount || 0 },
            { name: 'Service Fee', amount: batchInvoice?.service_fee || 0 },
            { name: 'Security Deposit', amount: batchInvoice?.security_deposit || 0 },
          ].filter(c => c.amount > 0);

          const batchTotalInvoice = batchCategories.reduce((sum, c) => sum + c.amount, 0);

          for (const category of batchCategories) {
            const categoryRefund = batchTotalInvoice > 0
              ? (category.amount / batchTotalInvoice) * refund.refund_amount
              : 0;

            if (categoryRefund > 0) {
              await supabase.from('ledger_entries').insert({
                rental_id: refund.rental_id,
                customer_id: batchRental.customer_id,
                vehicle_id: batchRental.vehicle_id,
                tenant_id: paymentRecord?.tenant_id,
                entry_date: new Date().toISOString().split('T')[0],
                due_date: new Date().toISOString().split('T')[0],
                type: 'Refund',
                category: category.name,
                amount: -Math.abs(categoryRefund),
                remaining_amount: 0,
                reference: `Scheduled Refund: ${refund.refund_reason || 'Refund processed'} (Stripe: ${stripeRefund.id})`,
              });
            }
          }
        }

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
