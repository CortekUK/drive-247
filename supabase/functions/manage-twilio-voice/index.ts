import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getTenantTwilioCredentials } from '../_shared/twilio-sms-client.ts';

const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01';

// --- Twilio REST helpers ---

function twilioAuth(accountSid: string, authToken: string): string {
  return `Basic ${btoa(`${accountSid}:${authToken}`)}`;
}

async function twilioFetch(
  url: string,
  accountSid: string,
  authToken: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  body?: Record<string, string>
): Promise<any> {
  const options: RequestInit = {
    method,
    headers: {
      'Authorization': twilioAuth(accountSid, authToken),
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
  };

  if (body) {
    options.body = new URLSearchParams(body).toString();
  }

  const response = await fetch(url, options);

  if (method === 'DELETE' && response.status === 204) {
    return {};
  }

  const data = await response.json();

  if (!response.ok) {
    console.error('[manage-twilio-voice] Twilio API error:', data);
    throw new Error(data.message || `Twilio API error: ${response.status}`);
  }

  return data;
}

// --- JWT token generation for Twilio Access Token ---

function base64UrlEncode(data: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...data));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlEncodeString(str: string): string {
  return base64UrlEncode(new TextEncoder().encode(str));
}

async function createAccessToken(
  accountSid: string,
  apiKeySid: string,
  apiKeySecret: string,
  identity: string,
  twimlAppSid: string,
  ttl: number = 3600
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const header = {
    typ: 'JWT',
    alg: 'HS256',
    cty: 'twilio-fpa;v=1',
  };

  const payload = {
    jti: `${apiKeySid}-${now}`,
    iss: apiKeySid,
    sub: accountSid,
    exp: now + ttl,
    grants: {
      identity,
      voice: {
        outgoing: {
          application_sid: twimlAppSid,
        },
        incoming: {
          allow: true,
        },
      },
    },
  };

  const headerEncoded = base64UrlEncodeString(JSON.stringify(header));
  const payloadEncoded = base64UrlEncodeString(JSON.stringify(payload));
  const signingInput = `${headerEncoded}.${payloadEncoded}`;

  // HMAC-SHA256 signing
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(apiKeySecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBytes = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput))
  );

  const signature = base64UrlEncode(signatureBytes);

  return `${signingInput}.${signature}`;
}

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

    // Get user's app_user record
    const { data: appUser, error: appUserError } = await supabase
      .from('app_users')
      .select('id, tenant_id, role, is_super_admin')
      .eq('auth_user_id', user.id)
      .single();

    if (appUserError) {
      console.error('[manage-twilio-voice] app_users query error:', appUserError);
      return errorResponse(`Failed to fetch user: ${appUserError.message}`, 403);
    }

    const { action, tenantId: bodyTenantId, ...params } = await req.json();

    // Resolve tenant ID
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

    // Only head_admin, admin, and super admins can manage voice
    if (!appUser?.is_super_admin && !['head_admin', 'admin'].includes(appUser.role)) {
      return errorResponse(`Role "${appUser.role}" cannot manage voice settings. Requires head_admin or admin.`, 403);
    }

    switch (action) {
      case 'setup': {
        // Step 0: Get tenant's Twilio credentials
        const creds = await getTenantTwilioCredentials(supabase, tenantId);
        if (!creds.isConfigured || !creds.sid || !creds.authToken) {
          return errorResponse('Twilio SMS must be configured first (subaccount + phone number required)', 400);
        }

        if (!creds.phoneNumberSid) {
          return errorResponse('Phone number SID not found. Please reconfigure the phone number.', 400);
        }

        // Check if voice is already set up
        const { data: tenant } = await supabase
          .from('tenants')
          .select('twilio_voice_enabled, twilio_twiml_app_sid, twilio_api_key_sid')
          .eq('id', tenantId)
          .single();

        if (tenant?.twilio_voice_enabled && tenant?.twilio_twiml_app_sid) {
          return errorResponse('Voice is already configured. Disable it first to reconfigure.', 400);
        }

        const functionsBaseUrl = `${supabaseUrl}/functions/v1`;

        // Step 1: Create API Key under tenant's subaccount
        console.log(`[manage-twilio-voice] Creating API Key for tenant ${tenantId}`);
        const apiKeyData = await twilioFetch(
          `${TWILIO_API_BASE}/Accounts/${creds.sid}/Keys.json`,
          creds.sid,
          creds.authToken,
          'POST',
          { FriendlyName: 'Drive247Voice' }
        );

        const apiKeySid = apiKeyData.sid;
        const apiKeySecret = apiKeyData.secret;

        // Step 2: Create TwiML Application
        console.log(`[manage-twilio-voice] Creating TwiML App for tenant ${tenantId}`);
        const twimlApp = await twilioFetch(
          `${TWILIO_API_BASE}/Accounts/${creds.sid}/Applications.json`,
          creds.sid,
          creds.authToken,
          'POST',
          {
            FriendlyName: `Drive247Voice-${tenantId.substring(0, 8)}`,
            VoiceUrl: `${functionsBaseUrl}/twilio-voice-connect`,
            VoiceMethod: 'POST',
            StatusCallback: `${functionsBaseUrl}/twilio-voice-status`,
            StatusCallbackMethod: 'POST',
          }
        );

        const twimlAppSid = twimlApp.sid;

        // Step 3: Configure phone number for inbound voice
        // IMPORTANT: Set VoiceUrl directly to the inbound handler, NOT VoiceApplicationSid.
        // VoiceApplicationSid would route ALL calls (including inbound from real phones)
        // through the TwiML App's VoiceUrl (twilio-voice-connect), which is the outbound handler.
        // The TwiML App is only needed for browser-originated outbound calls via the Device SDK.
        console.log(`[manage-twilio-voice] Configuring phone number ${creds.phoneNumberSid} for inbound voice`);
        await twilioFetch(
          `${TWILIO_API_BASE}/Accounts/${creds.sid}/IncomingPhoneNumbers/${creds.phoneNumberSid}.json`,
          creds.sid,
          creds.authToken,
          'POST',
          {
            VoiceUrl: `${functionsBaseUrl}/twilio-voice-inbound`,
            VoiceMethod: 'POST',
            VoiceApplicationSid: '',
            StatusCallback: `${functionsBaseUrl}/twilio-voice-status`,
            StatusCallbackMethod: 'POST',
          }
        );

        // Step 4: Save everything to DB
        const { error: updateError } = await supabase
          .from('tenants')
          .update({
            twilio_twiml_app_sid: twimlAppSid,
            twilio_api_key_sid: apiKeySid,
            twilio_api_key_secret: apiKeySecret,
            twilio_voice_enabled: true,
            twilio_voice_webhook_configured: true,
          })
          .eq('id', tenantId);

        if (updateError) {
          console.error('[manage-twilio-voice] DB update error:', updateError);
          return errorResponse(`Failed to save voice config: ${updateError.message}`, 500);
        }

        console.log(`[manage-twilio-voice] Voice setup complete for tenant ${tenantId}`);

        return jsonResponse({
          success: true,
          twimlAppSid,
          apiKeySid,
          voiceEnabled: true,
        });
      }

      case 'get-token': {
        // Fetch tenant voice config
        const { data: tenant, error: tenantError } = await supabase
          .from('tenants')
          .select('twilio_account_sid, twilio_auth_token, twilio_twiml_app_sid, twilio_api_key_sid, twilio_api_key_secret, twilio_voice_enabled')
          .eq('id', tenantId)
          .single();

        if (tenantError || !tenant) {
          return errorResponse('Failed to fetch tenant config', 500);
        }

        if (!tenant.twilio_voice_enabled || !tenant.twilio_twiml_app_sid) {
          return errorResponse('Voice is not enabled for this tenant. Run setup first.', 400);
        }

        if (!tenant.twilio_api_key_sid || !tenant.twilio_api_key_secret) {
          return errorResponse('API Key not found. Please re-run voice setup.', 400);
        }

        const identity = `tenant_${appUser.id}`;

        const accessToken = await createAccessToken(
          tenant.twilio_account_sid,
          tenant.twilio_api_key_sid,
          tenant.twilio_api_key_secret,
          identity,
          tenant.twilio_twiml_app_sid,
          3600 // 1 hour
        );

        return jsonResponse({
          token: accessToken,
          identity,
          expiresIn: 3600,
        });
      }

      case 'get-status': {
        const { data: tenant, error: tenantError } = await supabase
          .from('tenants')
          .select('twilio_twiml_app_sid, twilio_api_key_sid, twilio_voice_enabled, twilio_voice_webhook_configured, twilio_phone_number, call_forwarding_enabled, voicemail_enabled, voicemail_greeting_url, forwarding_number')
          .eq('id', tenantId)
          .single();

        if (tenantError || !tenant) {
          return errorResponse('Failed to fetch tenant config', 500);
        }

        // Get forwarding numbers for all active users
        const { data: usersWithForwarding } = await supabase
          .from('app_users')
          .select('id, full_name, role, forwarding_number')
          .eq('tenant_id', tenantId)
          .in('role', ['head_admin', 'admin', 'manager', 'ops'])
          .eq('is_active', true);

        return jsonResponse({
          voiceEnabled: tenant.twilio_voice_enabled || false,
          twimlAppSid: tenant.twilio_twiml_app_sid || null,
          apiKeyConfigured: !!tenant.twilio_api_key_sid,
          webhookConfigured: tenant.twilio_voice_webhook_configured || false,
          phoneNumber: tenant.twilio_phone_number || null,
          callForwardingEnabled: tenant.call_forwarding_enabled || false,
          voicemailEnabled: tenant.voicemail_enabled || false,
          voicemailGreetingUrl: tenant.voicemail_greeting_url || null,
          forwardingNumber: tenant.forwarding_number || null,
          forwardingUsers: (usersWithForwarding || []).map((u: any) => ({
            id: u.id,
            name: u.full_name,
            role: u.role,
            forwardingNumber: u.forwarding_number || null,
          })),
        });
      }

      case 'disable': {
        const creds = await getTenantTwilioCredentials(supabase, tenantId);

        // Fetch current voice config
        const { data: tenant } = await supabase
          .from('tenants')
          .select('twilio_twiml_app_sid, twilio_api_key_sid')
          .eq('id', tenantId)
          .single();

        // Delete TwiML App if it exists
        if (tenant?.twilio_twiml_app_sid && creds.sid && creds.authToken) {
          try {
            await twilioFetch(
              `${TWILIO_API_BASE}/Accounts/${creds.sid}/Applications/${tenant.twilio_twiml_app_sid}.json`,
              creds.sid,
              creds.authToken,
              'DELETE'
            );
            console.log(`[manage-twilio-voice] Deleted TwiML App ${tenant.twilio_twiml_app_sid}`);
          } catch (err: any) {
            console.warn(`[manage-twilio-voice] Failed to delete TwiML App: ${err.message}`);
          }
        }

        // Delete API Key if it exists
        if (tenant?.twilio_api_key_sid && creds.sid && creds.authToken) {
          try {
            await twilioFetch(
              `${TWILIO_API_BASE}/Accounts/${creds.sid}/Keys/${tenant.twilio_api_key_sid}.json`,
              creds.sid,
              creds.authToken,
              'DELETE'
            );
            console.log(`[manage-twilio-voice] Deleted API Key ${tenant.twilio_api_key_sid}`);
          } catch (err: any) {
            console.warn(`[manage-twilio-voice] Failed to delete API Key: ${err.message}`);
          }
        }

        // Remove voice application from phone number (revert to no voice handling)
        if (creds.phoneNumberSid && creds.sid && creds.authToken) {
          try {
            await twilioFetch(
              `${TWILIO_API_BASE}/Accounts/${creds.sid}/IncomingPhoneNumbers/${creds.phoneNumberSid}.json`,
              creds.sid,
              creds.authToken,
              'POST',
              {
                VoiceApplicationSid: '',
                VoiceUrl: '',
              }
            );
            console.log(`[manage-twilio-voice] Cleared voice config from phone number`);
          } catch (err: any) {
            console.warn(`[manage-twilio-voice] Failed to clear phone number voice config: ${err.message}`);
          }
        }

        // Clear DB
        const { error: updateError } = await supabase
          .from('tenants')
          .update({
            twilio_twiml_app_sid: null,
            twilio_api_key_sid: null,
            twilio_api_key_secret: null,
            twilio_voice_enabled: false,
            twilio_voice_webhook_configured: false,
          })
          .eq('id', tenantId);

        if (updateError) {
          console.error('[manage-twilio-voice] DB update error:', updateError);
          return errorResponse(`Failed to clear voice config: ${updateError.message}`, 500);
        }

        console.log(`[manage-twilio-voice] Voice disabled for tenant ${tenantId}`);

        return jsonResponse({ success: true, voiceEnabled: false });
      }

      case 'update-forwarding': {
        // Toggle call forwarding and/or voicemail at tenant level
        const updateFields: Record<string, any> = {};

        if (typeof params.callForwardingEnabled === 'boolean') {
          updateFields.call_forwarding_enabled = params.callForwardingEnabled;
        }
        if (typeof params.voicemailEnabled === 'boolean') {
          updateFields.voicemail_enabled = params.voicemailEnabled;
        }
        if (params.voicemailGreetingUrl !== undefined) {
          updateFields.voicemail_greeting_url = params.voicemailGreetingUrl || null;
        }
        if (params.forwardingNumber !== undefined) {
          // Validate: forwarding number must not be the same as the Twilio number
          if (params.forwardingNumber) {
            const { data: tenantCheck } = await supabase
              .from('tenants')
              .select('twilio_phone_number')
              .eq('id', tenantId)
              .single();

            const fwdDigits = params.forwardingNumber.replace(/[^+\d]/g, '');
            const twilioDigits = (tenantCheck?.twilio_phone_number || '').replace(/[^+\d]/g, '');
            if (fwdDigits && twilioDigits && (fwdDigits === twilioDigits || fwdDigits.endsWith(twilioDigits.replace('+', '')) || twilioDigits.endsWith(fwdDigits.replace('+', '')))) {
              return errorResponse('Forwarding number cannot be the same as your Twilio phone number — this would create a call loop.', 400);
            }
          }
          updateFields.forwarding_number = params.forwardingNumber || null;
        }

        if (Object.keys(updateFields).length === 0) {
          return errorResponse('No fields to update', 400);
        }

        const { error: fwdError } = await supabase
          .from('tenants')
          .update(updateFields)
          .eq('id', tenantId);

        if (fwdError) {
          return errorResponse(`Failed to update forwarding settings: ${fwdError.message}`, 500);
        }

        console.log(`[manage-twilio-voice] Updated forwarding settings for tenant ${tenantId}:`, updateFields);
        return jsonResponse({ success: true, ...updateFields });
      }

      case 'set-forwarding-number': {
        // Set a forwarding number for a specific app_user
        const { userId, forwardingNumber } = params;
        if (!userId) return errorResponse('userId is required', 400);

        // Validate: forwarding number must not be the same as the Twilio number
        if (forwardingNumber) {
          const { data: tenantCheck } = await supabase
            .from('tenants')
            .select('twilio_phone_number')
            .eq('id', tenantId)
            .single();

          const fwdDigits = forwardingNumber.replace(/[^+\d]/g, '');
          const twilioDigits = (tenantCheck?.twilio_phone_number || '').replace(/[^+\d]/g, '');
          if (fwdDigits && twilioDigits && (fwdDigits === twilioDigits || fwdDigits.endsWith(twilioDigits.replace('+', '')) || twilioDigits.endsWith(fwdDigits.replace('+', '')))) {
            return errorResponse('Forwarding number cannot be the same as your Twilio phone number — this would create a call loop.', 400);
          }
        }

        // Verify the user belongs to this tenant
        const { data: targetUser, error: targetError } = await supabase
          .from('app_users')
          .select('id, tenant_id')
          .eq('id', userId)
          .single();

        if (targetError || !targetUser) {
          return errorResponse('User not found', 404);
        }

        if (targetUser.tenant_id !== tenantId && !appUser?.is_super_admin) {
          return errorResponse('Cannot set forwarding number for users in other tenants', 403);
        }

        const { error: numError } = await supabase
          .from('app_users')
          .update({ forwarding_number: forwardingNumber || null })
          .eq('id', userId);

        if (numError) {
          return errorResponse(`Failed to set forwarding number: ${numError.message}`, 500);
        }

        console.log(`[manage-twilio-voice] Set forwarding number for user ${userId}: ${forwardingNumber || '(cleared)'}`);
        return jsonResponse({ success: true, userId, forwardingNumber: forwardingNumber || null });
      }

      default:
        return errorResponse(`Unknown action: ${action}. Valid actions: setup, get-token, get-status, disable, update-forwarding, set-forwarding-number`, 400);
    }
  } catch (err: any) {
    console.error('[manage-twilio-voice] Error:', err);
    return errorResponse(err.message || 'Internal server error', 500);
  }
});
