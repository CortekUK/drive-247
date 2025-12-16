import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AuthorityPaymentRequest {
  fineId: string;
  amount: number;
  paymentDate: string;
  paymentMethod?: string;
  notes?: string;
}

interface AuthorityPaymentResult {
  success: boolean;
  authorityPaymentId?: string;
  pnlEntryId?: string;
  error?: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const requestData: AuthorityPaymentRequest = await req.json();
    const { fineId, amount, paymentDate, paymentMethod, notes } = requestData;

    if (!fineId || !amount || !paymentDate) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Fine ID, amount, and payment date are required' 
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`Recording authority payment for fine ${fineId}: £${amount} on ${paymentDate}`);

    // Validate fine exists
    const { data: fine, error: fineError } = await supabase
      .from('fines')
      .select('id, vehicle_id, customer_id, amount')
      .eq('id', fineId)
      .single();

    if (fineError || !fine) {
      console.error('Fine not found:', fineError);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Fine not found' 
        }),
        { 
          status: 404, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Insert authority payment record
    const { data: authorityPayment, error: paymentError } = await supabase
      .from('authority_payments')
      .insert({
        fine_id: fineId,
        amount: amount,
        payment_date: paymentDate,
        payment_method: paymentMethod,
        notes: notes
      })
      .select()
      .single();

    if (paymentError) {
      console.error('Error creating authority payment:', paymentError);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Failed to record authority payment',
          detail: paymentError.message
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`Authority payment recorded with ID: ${authorityPayment.id}`);

    // Create P&L Cost entry using unique reference for idempotency
    const reference = `authority:${authorityPayment.id}`;
    
    const { data: pnlEntry, error: pnlError } = await supabase
      .from('pnl_entries')
      .insert({
        vehicle_id: fine.vehicle_id,
        entry_date: paymentDate,
        side: 'Cost',
        category: 'Fines',
        amount: amount,
        reference: reference,
        customer_id: fine.customer_id,
        source_ref: fineId // Link back to original fine
      })
      .select()
      .single();

    if (pnlError) {
      // If P&L entry fails, we should still return success for the authority payment
      // but log the error for investigation
      console.error('Error creating P&L cost entry:', pnlError);
      
      // Check if it's a duplicate key error (idempotency)
      if (pnlError.message.includes('duplicate key')) {
        console.log('P&L entry already exists for this authority payment');
      } else {
        // Log non-duplicate errors but don't fail the entire request
        console.error('P&L entry creation failed:', pnlError.message);
      }
    } else {
      console.log(`P&L cost entry created with ID: ${pnlEntry.id}`);
    }

    console.log(`Authority payment successfully recorded for fine ${fineId}`);

    return new Response(
      JSON.stringify({
        success: true,
        authorityPaymentId: authorityPayment.id,
        pnlEntryId: pnlEntry?.id,
        message: `Authority payment of £${amount} recorded for fine ${fineId}`
      }),
      { 
        status: 201, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error processing authority payment:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || 'Internal server error' 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});