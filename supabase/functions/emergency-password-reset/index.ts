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

    // AUTHORIZATION — this function sets an arbitrary user's password.
    //
    // It previously had NO authorization of any kind: the body carried only an
    // email and a new password, and the gateway accepts the public anon key as a
    // valid JWT. Anyone who knew a staff member's email address could take over
    // their account. The portal's "Forgot password?" flow called it directly,
    // which is why it looked legitimate.
    //
    // Password RECOVERY for a signed-out user must go through an email-verified
    // flow (supabase.auth.resetPasswordForEmail), not this. What remains here is
    // the admin tool: an authenticated super admin resetting someone's password.
    const authHeader = req.headers.get('Authorization') ?? '';
    const callerToken = authHeader.replace('Bearer ', '').trim();
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    if (!callerToken || callerToken === anonKey) {
      return new Response(
        JSON.stringify({ error: 'Not authorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: { user: caller }, error: callerErr } = await supabaseAdmin.auth.getUser(callerToken);
    if (callerErr || !caller) {
      return new Response(
        JSON.stringify({ error: 'Not authorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: callerRows } = await supabaseAdmin
      .from('app_users')
      .select('is_super_admin, is_active')
      .eq('auth_user_id', caller.id);

    const isSuperAdmin = Array.isArray(callerRows)
      && callerRows.some((r: any) => r.is_super_admin === true && r.is_active !== false);

    if (!isSuperAdmin) {
      console.warn(`[emergency-password-reset] DENIED for caller ${caller.id} targeting ${email}`);
      return new Response(
        JSON.stringify({ error: 'Not authorized' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Emergency password reset requested by super admin ${caller.id} for: ${email}`);

    // Find user by email. listUsers() is paginated and defaults to 50 per page —
    // an unpaginated call silently stopped finding anyone past the first 50 users,
    // and the comparison was case-sensitive against a store that lowercases every
    // address, so any mixed-case input reported "User not found".
    const wanted = email.trim().toLowerCase();
    let authUser: { id: string; email?: string } | undefined;
    let getUserError: unknown = null;

    for (let page = 1; page <= 20 && !authUser; page++) {
      const { data: userList, error } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage: 200,
      });
      if (error) { getUserError = error; break; }
      const users = userList?.users ?? [];
      authUser = users.find((u: any) => (u.email ?? '').toLowerCase() === wanted);
      if (users.length < 200) break; // last page
    }

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