// Manages a tenant's BYO Twilio connection.
// Four actions: `connect`, `test`, `disconnect`, `get-status`.
//
// Renamed from manage-twilio-subaccount during the BYO migration. The old function
// is still deployed as a 410-Gone stub for safety; nothing should call it anymore.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import {
  getTenantTwilioCredentials,
  sendTenantSMS,
  normalizePhoneNumber,
  validateTenantConnection,
  findTenantPhoneNumber,
  configureNumberWebhooks,
} from '../_shared/twilio-sms-client.ts';

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

    // Fetch app_user for tenant + role
    const { data: appUser, error: appUserError } = await supabase
      .from('app_users')
      .select('tenant_id, role, is_super_admin')
      .eq('auth_user_id', user.id)
      .single();

    if (appUserError) {
      console.error('[manage-twilio] app_users query error:', appUserError);
      return errorResponse(`Failed to fetch user: ${appUserError.message}`, 403);
    }

    const { action, tenantId: bodyTenantId, ...params } = await req.json();

    // Resolve tenant — regular users get their own, super admins can target any
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

    // Only head_admin, admin, and super admins can manage Twilio
    if (!appUser?.is_super_admin && !['head_admin', 'admin'].includes(appUser.role)) {
      return errorResponse(`Role "${appUser.role}" cannot manage SMS settings. Requires head_admin or admin.`, 403);
    }

    switch (action) {
      // ---------- CONNECT ----------
      // Validates the tenant's BYO Twilio creds + phone number, then saves them
      // and configures inbound/status webhooks on the number.
      case 'connect': {
        const { accountSid, authToken, phoneNumber } = params;

        if (!accountSid || !authToken || !phoneNumber) {
          return errorResponse('accountSid, authToken, and phoneNumber are all required');
        }

        // Step 1: Validate the creds work
        const validation = await validateTenantConnection(accountSid, authToken);
        if (!validation.valid) {
          return errorResponse(`Invalid Twilio credentials: ${validation.error}`);
        }
        if (validation.status !== 'active') {
          return errorResponse(`Twilio account status is "${validation.status}" — must be active`);
        }

        // Step 2: Verify the phone number exists on their account
        const number = await findTenantPhoneNumber(accountSid, authToken, phoneNumber);
        if (!number) {
          return errorResponse(
            `Phone number ${phoneNumber} was not found on this Twilio account. Check the number and try again.`
          );
        }
        if (!number.capabilities.sms) {
          return errorResponse(`Phone number ${number.phoneNumber} does not support SMS`);
        }

        // Step 3: Auto-configure inbound SMS + status callback webhooks
        const smsUrl = `${supabaseUrl}/functions/v1/twilio-inbound-sms`;
        const statusUrl = `${supabaseUrl}/functions/v1/twilio-sms-status`;
        try {
          await configureNumberWebhooks(accountSid, authToken, number.sid, smsUrl, statusUrl);
        } catch (webhookErr: any) {
          // Don't fail the whole connection — tenant can retry webhook config later
          console.warn('[Twilio] Failed to auto-configure webhooks:', webhookErr.message);
        }

        // Step 4: Save to DB
        const { error: updateError } = await supabase
          .from('tenants')
          .update({
            twilio_account_sid: accountSid,
            twilio_auth_token: authToken,
            twilio_phone_number: number.phoneNumber,
            twilio_phone_number_sid: number.sid,
            integration_twilio_sms: true,
            twilio_connection_verified_at: new Date().toISOString(),
          } as any)
          .eq('id', tenantId);

        if (updateError) throw updateError;

        return jsonResponse({
          success: true,
          friendlyName: validation.friendlyName,
          phoneNumber: number.phoneNumber,
          capabilities: number.capabilities,
        });
      }

      // ---------- TEST ----------
      // Sends a test SMS using the currently-saved creds.
      case 'test': {
        const { to, message } = params;
        if (!to) return errorResponse('to phone number is required');

        const creds = await getTenantTwilioCredentials(supabase, tenantId);
        if (!creds.isConfigured) {
          return errorResponse('Twilio is not connected. Complete the Connect step first.');
        }

        const normalized = normalizePhoneNumber(to);
        const body = message?.trim() || 'This is a test SMS from your Drive247 portal. Your Twilio connection is working!';
        const result = await sendTenantSMS(creds, normalized, body);

        return jsonResponse(result);
      }

      // ---------- GET-STATUS ----------
      // Read-only snapshot used by the Settings UI to render connected state.
      case 'get-status': {
        const { data: tenantData, error: tErr } = await supabase
          .from('tenants')
          .select('twilio_account_sid, twilio_phone_number, twilio_phone_number_sid, integration_twilio_sms, twilio_connection_verified_at' as any)
          .eq('id', tenantId)
          .single();

        if (tErr) throw tErr;
        const t = tenantData as any;

        // Fetch number capabilities from Twilio if we have creds
        let capabilities: { sms: boolean; voice: boolean; mms: boolean } | null = null;
        if (t?.twilio_account_sid && t?.twilio_phone_number_sid) {
          const creds = await getTenantTwilioCredentials(supabase, tenantId);
          const number = await findTenantPhoneNumber(creds.sid, creds.authToken, t.twilio_phone_number);
          if (number) capabilities = number.capabilities;
        }

        // Return masked account SID — never leak auth token to the client
        const maskedSid = t?.twilio_account_sid
          ? `${t.twilio_account_sid.substring(0, 6)}…${t.twilio_account_sid.slice(-4)}`
          : null;

        return jsonResponse({
          success: true,
          isConnected: !!t?.twilio_account_sid,
          isConfigured: !!t?.integration_twilio_sms,
          accountSidMasked: maskedSid,
          phoneNumber: t?.twilio_phone_number || null,
          connectedAt: t?.twilio_connection_verified_at || null,
          capabilities,
          // Legacy fields kept for frontend compatibility during migration
          hasSubaccount: !!t?.twilio_account_sid,
          hasPhoneNumber: !!t?.twilio_phone_number,
        });
      }

      // ---------- DISCONNECT ----------
      // Clears the tenant's Twilio creds from our DB. Does NOT touch the tenant's
      // Twilio account — they own it, we just forget it.
      case 'disconnect': {
        const { error: updateError } = await supabase
          .from('tenants')
          .update({
            twilio_account_sid: null,
            twilio_auth_token: null,
            twilio_phone_number: null,
            twilio_phone_number_sid: null,
            integration_twilio_sms: false,
            twilio_connection_verified_at: null,
          } as any)
          .eq('id', tenantId);

        if (updateError) throw updateError;
        return jsonResponse({ success: true });
      }

      default:
        return errorResponse(`Unknown action: ${action}. Supported: connect, test, disconnect, get-status`);
    }
  } catch (err: any) {
    console.error('[manage-twilio] Error:', err);
    return errorResponse(err.message || 'Internal error', 500);
  }
});
