import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { sendResendEmail, getTenantBranding, wrapWithBrandedTemplate } from '../_shared/resend-service.ts';

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { email, tenant_id } = await req.json();

    if (!email) {
      return errorResponse('Email is required', 400);
    }

    // Generate 6-digit OTP
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutes

    // Delete any existing OTPs for this email+tenant
    await supabase
      .from('verification_otps')
      .delete()
      .eq('email', email.toLowerCase())
      .eq('tenant_id', tenant_id || '');

    // Also clean up expired OTPs
    await supabase
      .from('verification_otps')
      .delete()
      .lt('expires_at', new Date().toISOString());

    // Insert new OTP
    const { error: insertError } = await supabase
      .from('verification_otps')
      .insert({
        email: email.toLowerCase(),
        code,
        tenant_id: tenant_id || null,
        expires_at: expiresAt,
      });

    if (insertError) {
      console.error('Error inserting OTP:', insertError);
      return errorResponse('Failed to generate verification code', 500);
    }

    // Get tenant branding for email
    const branding = tenant_id
      ? await getTenantBranding(tenant_id, supabase)
      : {
          companyName: 'Drive 247',
          logoUrl: null,
          primaryColor: '#1a1a1a',
          accentColor: '#C5A572',
          contactEmail: 'support@drive-247.com',
          contactPhone: null,
          slug: 'drive247',
        };

    // Build branded OTP email
    const emailContent = `
      <tr>
        <td style="padding: 40px 35px;">
          <h1 style="color: #1a1a1a; margin: 0 0 20px; font-size: 24px;">Verify Your Email</h1>

          <p style="color: #444; line-height: 1.7; font-size: 15px;">
            Enter the following code to verify your email address and complete your registration with <strong>${branding.companyName}</strong>.
          </p>

          <div style="text-align: center; margin: 32px 0;">
            <div style="display: inline-block; background: #f8f9fa; border: 2px dashed ${branding.accentColor || '#C5A572'}; border-radius: 12px; padding: 20px 40px;">
              <span style="font-size: 36px; font-weight: 700; letter-spacing: 12px; color: #1a1a1a; font-family: monospace;">${code}</span>
            </div>
          </div>

          <p style="color: #666; font-size: 13px; line-height: 1.6; text-align: center;">
            This code expires in <strong>15 minutes</strong>.
          </p>

          <p style="color: #999; font-size: 12px; line-height: 1.5; margin-top: 24px; border-top: 1px solid #eee; padding-top: 16px;">
            If you didn't create an account with ${branding.companyName}, you can safely ignore this email.
          </p>
        </td>
      </tr>`;

    const html = wrapWithBrandedTemplate(emailContent, branding);

    const result = await sendResendEmail(
      {
        to: email,
        subject: `Your verification code: ${code} | ${branding.companyName}`,
        html,
        tenantId: tenant_id,
      },
      supabase
    );

    if (!result.success) {
      console.error('Failed to send OTP email:', result.error);
      return errorResponse(result.error || 'Failed to send verification email', 500);
    }

    console.log('OTP sent to:', email, 'messageId:', result.messageId);
    return jsonResponse({ ok: true });
  } catch (error) {
    console.error('Error in send-verification-otp:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Internal server error',
      500
    );
  }
});
