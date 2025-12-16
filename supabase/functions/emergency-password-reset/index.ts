import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ResetRequest {
  email: string;
  tempPassword: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Initialize Supabase Admin Client
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    const { email, tempPassword }: ResetRequest = await req.json();

    if (!email || !tempPassword) {
      return new Response(
        JSON.stringify({ error: 'Email and temporary password are required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`Emergency password reset requested for: ${email}`);

    // Find user by email - use listUsers since getUserByEmail doesn't exist
    const { data: userList, error: getUserError } = await supabaseAdmin.auth.admin.listUsers();
    
    if (getUserError) {
      console.error('Failed to list users:', getUserError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch users' }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }
    
    const authUser = userList.users.find(user => user.email === email);
    
    if (!authUser) {
      console.error('User not found:', email);
      return new Response(
        JSON.stringify({ error: 'User not found' }),
        { 
          status: 404, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Reset user password using admin API
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      authUser.id,
      { 
        password: tempPassword,
        email_confirm: true // Skip email confirmation
      }
    );

    if (updateError) {
      console.error('Password update error:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to update password' }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Update app_users table to require password change
    const { error: appUserError } = await supabaseAdmin
      .from('app_users')
      .update({ must_change_password: true })
      .eq('auth_user_id', authUser.id);

    if (appUserError) {
      console.error('App user update error:', appUserError);
      // Don't fail the request, just log the error
    }

    console.log(`Password reset successful for: ${email}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Password reset successfully. Please log in with the temporary password.' 
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Emergency password reset error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});