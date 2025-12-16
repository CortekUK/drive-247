import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface InsurancePolicy {
  id: string;
  customer_id: string;
  vehicle_id: string | null;
  policy_number: string;
  provider: string | null;
  expiry_date: string;
  status: string;
  customers: {
    name: string;
    email: string | null;
    phone: string | null;
    whatsapp_opt_in: boolean;
  };
  vehicles: {
    reg: string;
    make: string;
    model: string;
  } | null;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    console.log('🔄 Starting insurance reminders generation...');

    // Get all active insurance policies
    const { data: policies, error: policiesError } = await supabaseClient
      .from('insurance_policies')
      .select(`
        *,
        customers!inner(name, email, phone, whatsapp_opt_in),
        vehicles(reg, make, model)
      `)
      .eq('status', 'Active')
      .order('expiry_date', { ascending: true });

    if (policiesError) {
      console.error('❌ Error fetching policies:', policiesError);
      throw policiesError;
    }

    console.log(`📋 Found ${policies.length} active insurance policies`);

    const today = new Date();
    const currentMonth = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0');
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    let monthlyChecksCreated = 0;
    let expiryRemindersCreated = 0;

    for (const policy of policies as InsurancePolicy[]) {
      const expiryDate = new Date(policy.expiry_date);
      const daysUntilExpiry = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      // Generate monthly verification reminder
      const monthlyCheckKey = `insurance_check:${policy.id}:${currentMonth}`;
      const monthlyCheckMessage = `Monthly insurance verification for ${policy.policy_number} (${policy.customers.name})${policy.vehicles ? ` - Vehicle: ${policy.vehicles.reg}` : ''}`;

      const { error: monthlyCheckError } = await supabaseClient
        .from('reminder_events')
        .insert({
          unique_key: monthlyCheckKey,
          customer_id: policy.customer_id,
          vehicle_id: policy.vehicle_id,
          rental_id: null, // Insurance reminders don't have rental_id
          charge_id: null, // Insurance reminders don't have charge_id
          reminder_type: 'insurance_check',
          message_preview: monthlyCheckMessage,
          status: 'Delivered',
          delivered_at: new Date().toISOString(),
          delivered_to: 'in_app',
        })
        .select()
        .single();

      if (monthlyCheckError && monthlyCheckError.code !== '23505') { // Ignore duplicate key errors
        console.error('❌ Error creating monthly check reminder:', monthlyCheckError);
      } else if (!monthlyCheckError) {
        monthlyChecksCreated++;
        console.log(`✅ Created monthly check reminder for policy ${policy.policy_number}`);
      }

      // Generate expiry reminders at 30, 14, 7, and 0 days before expiry
      const expiryOffsets = [30, 14, 7, 0];
      
      for (const offset of expiryOffsets) {
        if (daysUntilExpiry === offset) {
          const expiryReminderKey = `insurance_expiry:${policy.id}:${offset}d`;
          let expiryMessage = '';

          if (offset === 0) {
            expiryMessage = `🚨 URGENT: Insurance policy ${policy.policy_number} expires TODAY! (${policy.customers.name})${policy.vehicles ? ` - Vehicle: ${policy.vehicles.reg}` : ''}`;
          } else {
            expiryMessage = `⚠️ Insurance policy ${policy.policy_number} expires in ${offset} days (${policy.customers.name})${policy.vehicles ? ` - Vehicle: ${policy.vehicles.reg}` : ''}`;
          }

          const { error: expiryReminderError } = await supabaseClient
            .from('reminder_events')
            .insert({
              unique_key: expiryReminderKey,
              customer_id: policy.customer_id,
              vehicle_id: policy.vehicle_id,
              rental_id: null,
              charge_id: null,
              reminder_type: 'insurance_expiry',
              message_preview: expiryMessage,
              status: 'Delivered',
              delivered_at: new Date().toISOString(),
              delivered_to: 'in_app',
            })
            .select()
            .single();

          if (expiryReminderError && expiryReminderError.code !== '23505') {
            console.error('❌ Error creating expiry reminder:', expiryReminderError);
          } else if (!expiryReminderError) {
            expiryRemindersCreated++;
            console.log(`✅ Created ${offset}-day expiry reminder for policy ${policy.policy_number}`);
          }
        }
      }

      // Mark policies as expired if past due date
      if (daysUntilExpiry < 0 && policy.status === 'Active') {
        const { error: updateError } = await supabaseClient
          .from('insurance_policies')
          .update({ status: 'Expired' })
          .eq('id', policy.id);

        if (updateError) {
          console.error('❌ Error updating policy status to expired:', updateError);
        } else {
          console.log(`📅 Marked policy ${policy.policy_number} as expired`);
        }
      }
    }

    const summary = {
      success: true,
      processed_policies: policies.length,
      monthly_checks_created: monthlyChecksCreated,
      expiry_reminders_created: expiryRemindersCreated,
      timestamp: new Date().toISOString()
    };

    console.log('✅ Insurance reminders generation completed:', summary);

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('❌ Error in generate-insurance-reminders:', error);
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