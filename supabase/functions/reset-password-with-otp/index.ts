import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { email, new_password } = await req.json();

    if (!email || !new_password) {
      return errorResponse('Email and new password are required', 400);
    }

    if (new_password.length < 8) {
      return errorResponse('Password must be at least 8 characters', 400);
    }

    // Find the auth user by email
    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();

    if (listError) {
      console.error('Error listing users:', listError);
      return errorResponse('Failed to find user', 500);
    }

    const authUser = users?.find((u: any) => u.email?.toLowerCase() === email.toLowerCase());

    if (!authUser) {
      return errorResponse('No account found with this email', 404);
    }

    // Update the password using admin API
    const { error: updateError } = await supabase.auth.admin.updateUserById(authUser.id, {
      password: new_password,
    });

    if (updateError) {
      console.error('Error updating password:', updateError);
      return errorResponse('Failed to reset password', 500);
    }

    console.log('Password reset for:', email);
    return jsonResponse({ ok: true });
  } catch (error) {
    console.error('Error in reset-password-with-otp:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Internal server error',
      500
    );
  }
});
