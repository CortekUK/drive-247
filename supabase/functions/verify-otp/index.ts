import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';

const MAX_ATTEMPTS = 5;

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { email, code, tenant_id } = await req.json();

    if (!email || !code) {
      return errorResponse('Email and code are required', 400);
    }

    // Find the OTP record
    let query = supabase
      .from('verification_otps')
      .select('*')
      .eq('email', email.toLowerCase())
      .eq('code', code);

    if (tenant_id) {
      query = query.eq('tenant_id', tenant_id);
    }

    const { data: otpRecord, error: fetchError } = await query.maybeSingle();

    if (fetchError) {
      console.error('Error fetching OTP:', fetchError);
      return errorResponse('Failed to verify code', 500);
    }

    if (!otpRecord) {
      return jsonResponse({ verified: false, error: 'Invalid verification code' }, 400);
    }

    // Check expiry
    if (new Date(otpRecord.expires_at) < new Date()) {
      // Clean up expired OTP
      await supabase.from('verification_otps').delete().eq('id', otpRecord.id);
      return jsonResponse({ verified: false, error: 'Verification code has expired. Please request a new one.' }, 400);
    }

    // OTP is valid — delete it so it can't be reused
    await supabase.from('verification_otps').delete().eq('id', otpRecord.id);

    // Confirm the user's email in Supabase Auth
    // Find the auth user by email and update email_confirmed_at
    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
    if (!listError && users) {
      const authUser = users.find((u: any) => u.email?.toLowerCase() === email.toLowerCase());
      if (authUser && !authUser.email_confirmed_at) {
        await supabase.auth.admin.updateUserById(authUser.id, {
          email_confirm: true,
        });
        console.log('Email confirmed for user:', authUser.id);
      }
    }

    console.log('OTP verified for:', email);
    return jsonResponse({ verified: true });
  } catch (error) {
    console.error('Error in verify-otp:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Internal server error',
      500
    );
  }
});
