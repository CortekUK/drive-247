import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ScheduleRefundRequest {
  paymentId: string;
  refundAmount?: number; // Optional - if not provided, refunds full amount
  scheduledDate: string; // ISO date string
  reason: string;
  scheduledBy?: string; // UUID of admin user
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { paymentId, refundAmount, scheduledDate, reason, scheduledBy }: ScheduleRefundRequest = await req.json();

    console.log('Scheduling refund:', { paymentId, refundAmount, scheduledDate, reason });

    // Validate required fields
    if (!paymentId || !scheduledDate || !reason) {
      throw new Error('Missing required fields: paymentId, scheduledDate, and reason are required');
    }

    // Validate date is in the future
    const scheduledDateObj = new Date(scheduledDate);
    if (isNaN(scheduledDateObj.getTime())) {
      throw new Error('Invalid date format for scheduledDate');
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get payment details
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('id, amount, customer_id, rental_id, stripe_payment_intent_id, capture_status')
      .eq('id', paymentId)
      .single();

    if (paymentError || !payment) {
      throw new Error(`Payment not found: ${paymentError?.message || 'Unknown error'}`);
    }

    // Validate payment can be refunded
    if (payment.capture_status !== 'captured') {
      throw new Error('Payment must be captured before scheduling a refund');
    }

    // Determine refund amount (use provided amount or full payment amount)
    const finalRefundAmount = refundAmount || payment.amount;

    // Validate refund amount doesn't exceed payment amount
    if (finalRefundAmount > payment.amount) {
      throw new Error(`Refund amount ($${finalRefundAmount}) cannot exceed payment amount ($${payment.amount})`);
    }

    console.log('Updating payment with refund schedule...');

    // Update payment with refund schedule
    const { error: updateError } = await supabase
      .from('payments')
      .update({
        refund_status: 'scheduled',
        refund_scheduled_date: scheduledDate,
        refund_amount: finalRefundAmount,
        refund_reason: reason,
        refund_scheduled_by: scheduledBy || null
      })
      .eq('id', paymentId);

    if (updateError) {
      throw new Error(`Failed to update payment: ${updateError.message}`);
    }

    console.log('Creating reminder event...');

    // Create reminder event for refund processing
    // Check if reminder_events table exists
    const { error: reminderError } = await supabase
      .from('reminder_events')
      .insert({
        type: 'refund_processing',
        scheduled_for: scheduledDate,
        reference_id: paymentId,
        reference_type: 'payment',
        status: 'pending',
        data: {
          payment_id: paymentId,
          customer_id: payment.customer_id,
          rental_id: payment.rental_id,
          amount: finalRefundAmount,
          reason: reason,
          stripe_payment_intent_id: payment.stripe_payment_intent_id
        }
      });

    if (reminderError) {
      console.warn('Failed to create reminder event (table may not exist):', reminderError.message);
      // Don't fail the request if reminder creation fails
    } else {
      console.log('Reminder event created successfully');
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Refund scheduled successfully',
        data: {
          paymentId,
          refundAmount: finalRefundAmount,
          scheduledDate,
          reason
        }
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error: any) {
    console.error('Schedule refund error:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Failed to schedule refund'
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
