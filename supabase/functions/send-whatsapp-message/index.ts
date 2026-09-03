import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import {
  getTenantTwilioCredentials,
  sendTwilioWhatsApp,
  getTenantWhatsAppNumber,
  normalizePhoneNumber,
} from '../_shared/twilio-sms-client.ts';

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

    // Resolve tenant
    const tenantId = appUser.tenant_id || (appUser.is_super_admin ? bodyTenantId : null);
    if (!tenantId) return errorResponse('No tenant context', 403);

    // Get Twilio credentials + WhatsApp number
    const creds = await getTenantTwilioCredentials(supabase, tenantId);
    if (!creds.isConfigured) {
      return errorResponse('Twilio not configured for this tenant.');
    }

    const whatsappFrom = await getTenantWhatsAppNumber(supabase, tenantId);
    if (!whatsappFrom) {
      return errorResponse('WhatsApp sender number not configured. Set it up in Settings → Messaging → WhatsApp.');
    }

    if (!channelId || !customerId) {
      return errorResponse('channelId and customerId are required');
    }

    // Get customer phone number
    const { data: customer } = await supabase
      .from('customers')
      .select('phone')
      .eq('id', customerId)
      .single();

    if (!customer?.phone) {
      return errorResponse('Customer has no phone number on file');
    }

    const normalizedPhone = normalizePhoneNumber(customer.phone);

    // Check if we need to send a template first (no inbound WhatsApp from this customer in last 24h)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentInbound } = await supabase
      .from('chat_channel_messages')
      .select('id')
      .eq('channel_id', channelId)
      .eq('sender_type', 'customer')
      .eq('channel', 'whatsapp')
      .gte('created_at', twentyFourHoursAgo)
      .limit(1);

    const hasRecentConversation = (recentInbound?.length || 0) > 0;

    // If no recent conversation, auto-send a generic template to open the window
    if (!hasRecentConversation) {
      // Check for a generic/conversation opener template
      const { data: tenantData } = await supabase
        .from('tenants')
        .select('twilio_whatsapp_lockbox_template_sid, company_name')
        .eq('id', tenantId)
        .single();

      // Look for an approved general template first, fall back to lockbox template
      const { data: generalTemplate } = await supabase
        .from('whatsapp_content_templates')
        .select('twilio_content_sid')
        .eq('tenant_id', tenantId)
        .eq('template_type', 'general')
        .eq('approval_status', 'approved')
        .limit(1)
        .single();

      const openerSid = generalTemplate?.twilio_content_sid || null;

      if (openerSid) {
        // Send the template opener silently (not logged in chat)
        const openerResult = await sendTwilioWhatsApp(creds, whatsappFrom, normalizedPhone, '', openerSid, {
          '1': tenantData?.company_name || 'our team',
        });
        if (!openerResult.success) {
          return errorResponse(`WhatsApp failed: No conversation window open and template send failed: ${openerResult.error}. The customer needs to message you first on WhatsApp, or create an approved message template in Settings → Messaging → WhatsApp.`);
        }
        console.log('[send-whatsapp-message] Auto-sent template opener to open 24h window');
        // Small delay to ensure Twilio processes the template before the free-form message
        await new Promise(r => setTimeout(r, 1500));
      } else {
        // No template available — try sending free-form anyway, it may fail
        console.log('[send-whatsapp-message] No template available, attempting free-form (may fail if outside 24h window)');
      }
    }

    // Send the actual message as free-form
    const waResult = await sendTwilioWhatsApp(creds, whatsappFrom, normalizedPhone, content);
    if (!waResult.success) {
      return errorResponse(`WhatsApp send failed: ${waResult.error}. If the customer hasn't messaged you in the last 24 hours, you need an approved message template. Go to Settings → Messaging → WhatsApp to create one.`);
    }

    // Insert message into chat_channel_messages
    const { data: message, error: insertError } = await supabase
      .from('chat_channel_messages')
      .insert({
        channel_id: channelId,
        sender_type: 'tenant',
        sender_id: appUser.id,
        content,
        channel: 'whatsapp',
        external_id: waResult.messageId,
        external_status: 'queued',
        metadata: {},
      })
      .select()
      .single();

    if (insertError) {
      console.error('[send-whatsapp-message] DB insert error:', insertError);
      return errorResponse('WhatsApp sent but failed to save to database');
    }

    // Update channel's last_message_at and last_channel
    await supabase
      .from('chat_channels')
      .update({
        last_message_at: message.created_at,
        last_channel: 'whatsapp',
        updated_at: new Date().toISOString(),
      })
      .eq('id', channelId);

    return jsonResponse({
      success: true,
      messageId: message.id,
      twilioSid: waResult.messageId,
    });
  } catch (err: any) {
    console.error('[send-whatsapp-message] Error:', err);
    return errorResponse(err.message || 'Internal error', 500);
  }
});
