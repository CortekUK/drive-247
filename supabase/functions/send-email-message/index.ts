import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return errorResponse('Missing authorization', 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify JWT
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return errorResponse('Unauthorized', 401);

    // Get app user
    const { data: appUser } = await supabase
      .from('app_users')
      .select('id, tenant_id, role, is_super_admin')
      .eq('auth_user_id', user.id)
      .single();

    if (!appUser) return errorResponse('User not found', 403);

    const { channelId, customerId, content, tenantId: bodyTenantId } = await req.json();

    if (!content) return errorResponse('content is required');
    if (!channelId || !customerId) return errorResponse('channelId and customerId are required');

    // Resolve tenant
    const tenantId = appUser.tenant_id || (appUser.is_super_admin ? bodyTenantId : null);
    if (!tenantId) return errorResponse('No tenant context', 403);

    // Get customer email
    const { data: customer } = await supabase
      .from('customers')
      .select('email, name')
      .eq('id', customerId)
      .single();

    if (!customer?.email) {
      return errorResponse('Customer has no email address on file');
    }

    // Get tenant info for sender details
    const { data: tenant } = await supabase
      .from('tenants')
      .select('company_name, email_from')
      .eq('id', tenantId)
      .single();

    const fromEmail = tenant?.email_from || 'noreply@drive-247.com';
    const fromName = tenant?.company_name || 'Drive 247';

    // Send email via Resend
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    if (!RESEND_API_KEY) {
      return errorResponse('Email service (Resend) not configured on platform', 500);
    }

    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${fromName} <${fromEmail}>`,
        to: [customer.email],
        subject: `Message from ${fromName}`,
        html: `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <p style="font-size: 15px; line-height: 1.6; color: #333;">${content.replace(/\n/g, '<br/>')}</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
          <p style="font-size: 12px; color: #999;">This message was sent from ${fromName}. Please do not reply directly to this email.</p>
        </div>`,
        text: content,
      }),
    });

    const emailData = await emailResponse.json();

    if (!emailResponse.ok) {
      console.error('[send-email-message] Resend error:', emailData);
      return errorResponse(`Email send failed: ${emailData.message || 'Unknown error'}`);
    }

    // Insert message into chat_channel_messages
    const { data: message, error: insertError } = await supabase
      .from('chat_channel_messages')
      .insert({
        channel_id: channelId,
        sender_type: 'tenant',
        sender_id: appUser.id,
        content,
        channel: 'email',
        external_id: emailData.id || null,
        external_status: 'sent',
        metadata: { email_to: customer.email },
      })
      .select()
      .single();

    if (insertError) {
      console.error('[send-email-message] DB insert error:', insertError);
      return errorResponse('Email sent but failed to save to database');
    }

    // Update channel's last_message_at and last_channel
    await supabase
      .from('chat_channels')
      .update({
        last_message_at: message.created_at,
        last_channel: 'email',
        updated_at: new Date().toISOString(),
      })
      .eq('id', channelId);

    return jsonResponse({
      success: true,
      messageId: message.id,
      resendId: emailData.id,
    });
  } catch (err: any) {
    console.error('[send-email-message] Error:', err);
    return errorResponse(err.message || 'Internal error', 500);
  }
});
