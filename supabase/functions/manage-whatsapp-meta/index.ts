import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import {
  isWhatsAppPlatformConfigured,
  getPlatformWhatsAppConfig,
  exchangeCodeForToken,
  getPhoneNumberDetails,
  subscribeWabaToApp,
  getTenantWhatsAppCredentials,
  sendWhatsAppText,
  normalizeWhatsAppPhone,
} from '../_shared/whatsapp-client.ts';

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    // Auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return errorResponse('Missing authorization', 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify JWT
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return errorResponse('Unauthorized', 401);

    // Get user's tenant
    const { data: appUser, error: appUserError } = await supabase
      .from('app_users')
      .select('tenant_id, role, is_super_admin')
      .eq('auth_user_id', user.id)
      .single();

    if (appUserError) {
      console.error('[manage-whatsapp-meta] app_users query error:', appUserError);
      return errorResponse(`Failed to fetch user: ${appUserError.message}`, 403);
    }

    const { action, tenantId: bodyTenantId, ...params } = await req.json();

    // Resolve tenant
    let tenantId = appUser?.tenant_id;
    if (!tenantId) {
      if (appUser?.is_super_admin && bodyTenantId) {
        tenantId = bodyTenantId;
      } else if (appUser?.is_super_admin) {
        return errorResponse('Super admins must specify a tenantId', 403);
      } else {
        return errorResponse('User not associated with a tenant', 403);
      }
    }

    // Only head_admin, admin, and super admins can manage WhatsApp
    if (!appUser?.is_super_admin && !['head_admin', 'admin'].includes(appUser.role)) {
      return errorResponse(`Role "${appUser.role}" cannot manage WhatsApp settings. Requires head_admin or admin.`, 403);
    }

    switch (action) {
      case 'get-config': {
        if (!isWhatsAppPlatformConfigured()) {
          return errorResponse('WhatsApp platform not configured', 500);
        }
        const config = getPlatformWhatsAppConfig();
        // Only return non-secret values for the portal to init FB SDK
        return jsonResponse({
          success: true,
          appId: config.appId,
          configId: config.configId,
        });
      }

      case 'complete-signup': {
        const { code, wabaId, phoneNumberId } = params;
        if (!code || !wabaId || !phoneNumberId) {
          return errorResponse('code, wabaId, and phoneNumberId are required', 400);
        }

        if (!isWhatsAppPlatformConfigured()) {
          return errorResponse('WhatsApp platform not configured', 500);
        }

        // Check if already connected
        const existing = await getTenantWhatsAppCredentials(supabase, tenantId);
        if (existing.isConfigured) {
          return errorResponse('WhatsApp is already connected for this tenant. Disconnect first.');
        }

        // 1. Exchange code for access token
        console.log('[WhatsApp] Exchanging code for access token...');
        const accessToken = await exchangeCodeForToken(code);

        // 2. Get phone number details
        console.log('[WhatsApp] Fetching phone number details...');
        const phoneDetails = await getPhoneNumberDetails(phoneNumberId, accessToken);

        // 3. Subscribe WABA to our app
        console.log('[WhatsApp] Subscribing WABA to app...');
        try {
          await subscribeWabaToApp(wabaId, accessToken);
        } catch (err: any) {
          console.warn('[WhatsApp] WABA subscription warning:', err.message);
          // Non-fatal — continue even if subscription fails
        }

        // 4. Store in DB
        const { error: updateError } = await supabase
          .from('tenants')
          .update({
            meta_whatsapp_waba_id: wabaId,
            meta_whatsapp_phone_number_id: phoneNumberId,
            meta_whatsapp_access_token: accessToken,
            meta_whatsapp_phone_number: phoneDetails.displayPhoneNumber,
            integration_whatsapp: true,
          })
          .eq('id', tenantId);

        if (updateError) throw updateError;

        console.log(`[WhatsApp] Tenant ${tenantId} connected: ${phoneDetails.displayPhoneNumber}`);

        return jsonResponse({
          success: true,
          phoneNumber: phoneDetails.displayPhoneNumber,
          verifiedName: phoneDetails.verifiedName,
        });
      }

      case 'get-status': {
        const creds = await getTenantWhatsAppCredentials(supabase, tenantId);
        return jsonResponse({
          success: true,
          isConfigured: creds.isConfigured,
          phoneNumber: creds.phoneNumber || null,
          wabaId: creds.wabaId || null,
        });
      }

      case 'send-test': {
        const { to } = params;
        if (!to) return errorResponse('to phone number is required', 400);

        const creds = await getTenantWhatsAppCredentials(supabase, tenantId);
        if (!creds.isConfigured) {
          return errorResponse('WhatsApp not configured. Complete setup first.');
        }

        const normalized = normalizeWhatsAppPhone(to);
        const result = await sendWhatsAppText(
          creds,
          normalized,
          'This is a test WhatsApp message from your Drive247 portal. Your WhatsApp integration is working!'
        );

        return jsonResponse(result);
      }

      case 'disconnect': {
        const { error: updateError } = await supabase
          .from('tenants')
          .update({
            meta_whatsapp_waba_id: null,
            meta_whatsapp_phone_number_id: null,
            meta_whatsapp_access_token: null,
            meta_whatsapp_phone_number: null,
            integration_whatsapp: false,
          })
          .eq('id', tenantId);

        if (updateError) throw updateError;

        console.log(`[WhatsApp] Tenant ${tenantId} disconnected`);
        return jsonResponse({ success: true });
      }

      default:
        return errorResponse(`Unknown action: ${action}`);
    }
  } catch (err: any) {
    console.error('[manage-whatsapp-meta] Error:', err);
    return errorResponse(err.message || 'Internal error', 500);
  }
});
