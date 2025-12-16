import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LedgerEntry {
  id: string;
  customer_id: string;
  rental_id: string | null;
  vehicle_id: string;
  due_date: string;
  remaining_amount: number;
  category: string;
  customers: { name: string; whatsapp_opt_in?: boolean };
  vehicles: { reg: string };
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    console.log('Starting daily reminder generation at:', new Date().toISOString());

    const currentDate = new Date();
    const today = currentDate.toISOString().split('T')[0];
    const twoDaysFromNow = new Date(currentDate.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const yesterday = new Date(currentDate.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Get all unpaid charges
    const { data: charges, error: chargesError } = await supabaseClient
      .from('ledger_entries')
      .select(`
        id,
        customer_id,
        rental_id,
        vehicle_id,
        due_date,
        remaining_amount,
        category,
        customers!inner(name, whatsapp_opt_in),
        vehicles!inner(reg)
      `)
      .eq('type', 'Charge')
      .gt('remaining_amount', 0)
      .not('due_date', 'is', null);

    if (chargesError) {
      console.error('Error fetching charges:', chargesError);
      throw chargesError;
    }

    console.log(`Found ${charges?.length || 0} unpaid charges to process`);

    let remindersGenerated = 0;

    for (const charge of charges || []) {
      const typedCharge = charge as LedgerEntry;
      const chargeDate = new Date(typedCharge.due_date);
      const daysDiff = Math.floor((chargeDate.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24));

      let reminderType = null;
      let message = '';

      // Determine reminder type based on days difference
      if (daysDiff === 2) {
        reminderType = 'Upcoming';
        message = `Payment due in 2 days: £${typedCharge.remaining_amount} for ${typedCharge.vehicles.reg} (${typedCharge.category})`;
      } else if (daysDiff === 0) {
        reminderType = 'Due';
        message = `Payment due today: £${typedCharge.remaining_amount} for ${typedCharge.vehicles.reg} (${typedCharge.category})`;
      } else if (daysDiff === -1) {
        reminderType = 'Overdue1';
        message = `Payment overdue by 1 day: £${typedCharge.remaining_amount} for ${typedCharge.vehicles.reg} (${typedCharge.category})`;
      } else if (daysDiff <= -7 && daysDiff >= -28 && daysDiff % 7 === 0) {
        reminderType = 'OverdueN';
        const weeksOverdue = Math.abs(daysDiff) / 7;
        message = `Payment overdue by ${weeksOverdue} week${weeksOverdue > 1 ? 's' : ''}: £${typedCharge.remaining_amount} for ${typedCharge.vehicles.reg} (${typedCharge.category})`;
      }

      if (!reminderType) {
        continue; // Skip if no reminder needed for this charge
      }

      // Check if customer has sufficient credit to cover this charge
      const { data: customerCredits } = await supabaseClient
        .from('ledger_entries')
        .select('remaining_amount')
        .eq('customer_id', typedCharge.customer_id)
        .eq('type', 'Credit')
        .gt('remaining_amount', 0);

      const totalCredits = customerCredits?.reduce((sum, credit) => sum + Number(credit.remaining_amount), 0) || 0;
      
      // Suppress reminder if customer has enough credit to cover the charge
      if (totalCredits >= typedCharge.remaining_amount) {
        console.log(`Suppressing reminder for charge ${typedCharge.id} - customer has sufficient credit`);
        continue;
      }

      // Check if reminder already exists for this charge and type today
      const { data: existingReminder } = await supabaseClient
        .from('reminder_events')
        .select('id')
        .eq('charge_id', typedCharge.id)
        .eq('reminder_type', reminderType)
        .gte('created_at', `${today}T00:00:00.000Z`)
        .lt('created_at', `${today}T23:59:59.999Z`)
        .single();

      if (existingReminder) {
        console.log(`Reminder already exists for charge ${typedCharge.id}, type ${reminderType}`);
        continue;
      }

      // Create the reminder
      const { error: insertError } = await supabaseClient
        .from('reminder_events')
        .insert({
          charge_id: typedCharge.id,
          customer_id: typedCharge.customer_id,
          rental_id: typedCharge.rental_id,
          vehicle_id: typedCharge.vehicle_id,
          reminder_type: reminderType,
          status: 'Delivered',
          message_preview: message,
          delivered_at: new Date().toISOString(),
          delivered_to: 'in_app'
        });

      if (insertError) {
        console.error(`Error creating reminder for charge ${typedCharge.id}:`, insertError);
      } else {
        remindersGenerated++;
        console.log(`Created ${reminderType} reminder for charge ${typedCharge.id}: ${message}`);
      }
    }

    console.log(`Daily reminder generation completed. Generated ${remindersGenerated} reminders`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Generated ${remindersGenerated} reminders`,
        timestamp: new Date().toISOString(),
        processedCharges: charges?.length || 0
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('Error in daily reminders function:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message,
        timestamp: new Date().toISOString()
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});