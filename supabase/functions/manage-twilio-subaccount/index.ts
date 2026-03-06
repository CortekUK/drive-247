import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import {
  isParentTwilioConfigured,
  createTwilioSubaccount,
  searchAvailableNumbers,
  purchasePhoneNumber,
  releasePhoneNumber,
  suspendSubaccount,
  getTenantTwilioCredentials,
  sendTenantSMS,
  normalizePhoneNumber,
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

    // Verify JWT — extract token and use service client's auth.getUser()
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return errorResponse('Unauthorized', 401);

    // Get user's tenant — try app_users first, handle super admins
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

    // Resolve tenant: from app_users for regular users, from request body for super admins
    let tenantId = appUser?.tenant_id;

    if (!tenantId) {
      if (appUser?.is_super_admin && bodyTenantId) {
        // Super admin accessing portal — use tenantId from request body
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

    if (!isParentTwilioConfigured()) {
      return errorResponse('Twilio parent account not configured on the platform', 500);
    }

    switch (action) {
      case 'create-subaccount': {
        // Check if already has a subaccount
        const existing = await getTenantTwilioCredentials(supabase, tenantId);
        if (existing.sid) {
          return errorResponse('Subaccount already exists for this tenant');
        }

        // Fetch tenant name for friendly name
        const { data: tenant } = await supabase
          .from('tenants')
          .select('company_name, slug')
          .eq('id', tenantId)
          .single();

        const friendlyName = `Drive247 - ${tenant?.company_name || tenant?.slug || tenantId}`;

        let accountSid: string;
        let accountAuthToken: string;
        let accountFriendlyName: string;
        let usedParentFallback = false;

        try {
          const subaccount = await createTwilioSubaccount(friendlyName);
          accountSid = subaccount.sid;
          accountAuthToken = subaccount.authToken;
          accountFriendlyName = subaccount.friendlyName;
        } catch (subErr: any) {
          // Fallback: use parent account directly if subaccount creation fails
          // (e.g., Twilio subaccount limit not yet increased)
          console.warn('[Twilio] Subaccount creation failed, falling back to parent account:', subErr.message);
          const parentSid = Deno.env.get('TWILIO_ACCOUNT_SID')!;
          const parentToken = Deno.env.get('TWILIO_AUTH_TOKEN')!;
          accountSid = parentSid;
          accountAuthToken = parentToken;
          accountFriendlyName = friendlyName;
          usedParentFallback = true;
        }

        // Save to DB
        const { error: updateError } = await supabase
          .from('tenants')
          .update({
            twilio_subaccount_sid: accountSid,
            twilio_subaccount_auth_token: accountAuthToken,
          })
          .eq('id', tenantId);

        if (updateError) throw updateError;

        return jsonResponse({
          success: true,
          subaccountSid: accountSid,
          friendlyName: accountFriendlyName,
          usedParentFallback,
        });
      }

      case 'search-numbers': {
        const { countryCode, contains, areaCode } = params;
        if (!countryCode) return errorResponse('countryCode is required');

        const creds = await getTenantTwilioCredentials(supabase, tenantId);
        if (!creds.sid) return errorResponse('No Twilio subaccount. Create one first.');

        const numbers = await searchAvailableNumbers(
          countryCode.toUpperCase(),
          creds.sid,
          creds.authToken,
          { contains, areaCode, limit: 20 }
        );

        return jsonResponse({ success: true, numbers });
      }

      case 'purchase-number': {
        const { phoneNumber } = params;
        if (!phoneNumber) return errorResponse('phoneNumber is required');

        const creds = await getTenantTwilioCredentials(supabase, tenantId);
        if (!creds.sid) return errorResponse('No Twilio subaccount. Create one first.');

        const purchased = await purchasePhoneNumber(creds.sid, creds.authToken, phoneNumber);

        // Save to DB and mark as configured
        const { error: updateError } = await supabase
          .from('tenants')
          .update({
            twilio_phone_number: purchased.phoneNumber,
            twilio_phone_number_sid: purchased.sid,
            integration_twilio_sms: true,
          })
          .eq('id', tenantId);

        if (updateError) throw updateError;

        return jsonResponse({
          success: true,
          phoneNumber: purchased.phoneNumber,
          phoneNumberSid: purchased.sid,
        });
      }

      case 'assign-own-number': {
        const { phoneNumber } = params;
        if (!phoneNumber) return errorResponse('phoneNumber is required');

        const creds = await getTenantTwilioCredentials(supabase, tenantId);
        if (!creds.sid) return errorResponse('No Twilio subaccount. Create one first.');

        const normalized = normalizePhoneNumber(phoneNumber);

        // Verify the number exists in the subaccount by listing incoming numbers
        let existingSid: string | null = null;
        try {
          const url = `https://api.twilio.com/2010-04-01/Accounts/${creds.sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(normalized)}`;
          const resp = await fetch(url, {
            headers: { 'Authorization': `Basic ${btoa(`${creds.sid}:${creds.authToken}`)}` },
          });
          const data = await resp.json();
          if (data.incoming_phone_numbers?.length > 0) {
            existingSid = data.incoming_phone_numbers[0].sid;
          }
        } catch {
          // Number not found in subaccount — that's ok, they may be adding it
        }

        // Save to DB
        const { error: updateError } = await supabase
          .from('tenants')
          .update({
            twilio_phone_number: normalized,
            twilio_phone_number_sid: existingSid,
            integration_twilio_sms: true,
          })
          .eq('id', tenantId);

        if (updateError) throw updateError;

        return jsonResponse({
          success: true,
          phoneNumber: normalized,
          phoneNumberSid: existingSid,
        });
      }

      case 'send-test-sms': {
        const { to } = params;
        if (!to) return errorResponse('to phone number is required');

        const creds = await getTenantTwilioCredentials(supabase, tenantId);
        if (!creds.isConfigured) {
          return errorResponse('Twilio SMS not fully configured. Complete setup first.');
        }

        const normalized = normalizePhoneNumber(to);
        const result = await sendTenantSMS(
          creds,
          normalized,
          'This is a test SMS from your Drive247 portal. Your Twilio SMS integration is working!'
        );

        return jsonResponse(result);
      }

      case 'get-status': {
        const creds = await getTenantTwilioCredentials(supabase, tenantId);
        return jsonResponse({
          success: true,
          hasSubaccount: !!creds.sid,
          subaccountSid: creds.sid || null,
          hasPhoneNumber: !!creds.phoneNumber,
          phoneNumber: creds.phoneNumber || null,
          isConfigured: creds.isConfigured,
        });
      }

      case 'disconnect': {
        const creds = await getTenantTwilioCredentials(supabase, tenantId);

        // Release phone number if we have the SID
        if (creds.phoneNumberSid && creds.sid && creds.authToken) {
          try {
            await releasePhoneNumber(creds.sid, creds.authToken, creds.phoneNumberSid);
          } catch (err: any) {
            console.warn('[Twilio] Failed to release phone number:', err.message);
          }
        }

        // Suspend the subaccount
        if (creds.sid) {
          try {
            await suspendSubaccount(creds.sid);
          } catch (err: any) {
            console.warn('[Twilio] Failed to suspend subaccount:', err.message);
          }
        }

        // Clear DB fields
        const { error: updateError } = await supabase
          .from('tenants')
          .update({
            twilio_subaccount_sid: null,
            twilio_subaccount_auth_token: null,
            twilio_phone_number: null,
            twilio_phone_number_sid: null,
            integration_twilio_sms: false,
          })
          .eq('id', tenantId);

        if (updateError) throw updateError;

        return jsonResponse({ success: true });
      }

      default:
        return errorResponse(`Unknown action: ${action}`);
    }
  } catch (err: any) {
    console.error('[manage-twilio-subaccount] Error:', err);
    return errorResponse(err.message || 'Internal error', 500);
  }
});
