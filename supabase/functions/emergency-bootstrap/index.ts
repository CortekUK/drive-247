import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Emergency bootstrap function called');
    
    // Safety check: only allow GET method for this emergency function
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = 'https://hviqoaokxvlancmftwuo.supabase.co';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!serviceRoleKey) {
      console.error('Service role key not found');
      return new Response(JSON.stringify({ error: 'Service configuration missing' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create admin client with service role
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    const adminUserId = '1b2abd63-86da-4f46-8d5d-27305f727a3e';
    const tempPassword = 'TempAdmin123!';

    console.log('Resetting password for admin user:', adminUserId);

    // Reset the password using admin client
    const { data, error: authError } = await supabaseAdmin.auth.admin.updateUserById(
      adminUserId,
      { password: tempPassword }
    );

    if (authError) {
      console.error('Error resetting password:', authError);
      return new Response(JSON.stringify({ error: 'Failed to reset password', details: authError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Password reset successful, updating app_users table');

    // Set must_change_password to true
    const { error: dbError } = await supabaseAdmin
      .from('app_users')
      .update({ must_change_password: true })
      .eq('auth_user_id', adminUserId);

    if (dbError) {
      console.error('Error updating app_users:', dbError);
      return new Response(JSON.stringify({ error: 'Password reset but failed to update user flags', details: dbError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Emergency bootstrap completed successfully');

    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Admin password reset successfully',
      email: 'admin@company.com',
      temporaryPassword: tempPassword,
      mustChangePassword: true
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Unexpected error in emergency bootstrap:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});