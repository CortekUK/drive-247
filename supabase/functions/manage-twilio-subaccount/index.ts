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
  registerBrand,
  createMessagingService,
  addNumberToMessagingService,
  registerCampaign,
  getBrandStatus,
  getCampaignStatus,
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

        // Auto-configure SMS webhook URLs on the number
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        try {
          await configureNumberWebhooks(
            creds.sid,
            creds.authToken,
            purchased.sid,
            `${supabaseUrl}/functions/v1/twilio-inbound-sms`,
            `${supabaseUrl}/functions/v1/twilio-sms-status`
          );
        } catch (webhookErr: any) {
          console.warn('[Twilio] Failed to auto-configure webhooks:', webhookErr.message);
        }

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

        // Step 1: Check if the number already exists in the subaccount
        let existingSid: string | null = null;
        try {
          const url = `https://api.twilio.com/2010-04-01/Accounts/${creds.sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(normalized)}`;
          const resp = await fetch(url, {
            headers: { 'Authorization': `Basic ${btoa(`${creds.sid}:${creds.authToken}`)}` },
          });
          const data = await resp.json();
          if (data.incoming_phone_numbers?.length > 0) {
            existingSid = data.incoming_phone_numbers[0].sid;
            console.log(`[Twilio] Number ${normalized} already in subaccount: ${existingSid}`);
          }
        } catch {
          // Number not found in subaccount
        }

        // Step 2: If not in subaccount, check the parent account and transfer it
        if (!existingSid) {
          const parentSid = Deno.env.get('TWILIO_ACCOUNT_SID')!;
          const parentToken = Deno.env.get('TWILIO_AUTH_TOKEN')!;

          try {
            // Look up the number on the parent account
            const parentUrl = `https://api.twilio.com/2010-04-01/Accounts/${parentSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(normalized)}`;
            const parentResp = await fetch(parentUrl, {
              headers: { 'Authorization': `Basic ${btoa(`${parentSid}:${parentToken}`)}` },
            });
            const parentData = await parentResp.json();

            if (parentData.incoming_phone_numbers?.length > 0) {
              const numberSid = parentData.incoming_phone_numbers[0].sid;
              console.log(`[Twilio] Number ${normalized} found on parent account: ${numberSid}. Transferring to subaccount ${creds.sid}...`);

              // Transfer number from parent to subaccount by updating AccountSid
              const transferUrl = `https://api.twilio.com/2010-04-01/Accounts/${parentSid}/IncomingPhoneNumbers/${numberSid}.json`;
              const transferResp = await fetch(transferUrl, {
                method: 'POST',
                headers: {
                  'Authorization': `Basic ${btoa(`${parentSid}:${parentToken}`)}`,
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({ AccountSid: creds.sid }).toString(),
              });
              const transferData = await transferResp.json();

              if (!transferResp.ok) {
                console.error('[Twilio] Transfer failed:', transferData);
                return errorResponse(`Failed to transfer number to subaccount: ${transferData.message || 'Unknown error'}`);
              }

              existingSid = transferData.sid;
              console.log(`[Twilio] Number ${normalized} transferred to subaccount successfully`);
            } else {
              console.warn(`[Twilio] Number ${normalized} not found on parent or subaccount`);
              return errorResponse(`Number ${normalized} not found on your Twilio account. Please ensure the number is active in your Twilio account.`);
            }
          } catch (err: any) {
            console.error('[Twilio] Error checking/transferring number:', err.message);
            return errorResponse(`Failed to verify number ownership: ${err.message}`);
          }
        }

        // Configure webhooks for the number
        if (existingSid) {
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
          try {
            await configureNumberWebhooks(
              creds.sid,
              creds.authToken,
              existingSid,
              `${supabaseUrl}/functions/v1/twilio-inbound-sms`,
              `${supabaseUrl}/functions/v1/twilio-sms-status`
            );
          } catch (webhookErr: any) {
            console.warn('[Twilio] Failed to auto-configure webhooks:', webhookErr.message);
          }
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
        const { to, message } = params;
        if (!to) return errorResponse('to phone number is required');

        const creds = await getTenantTwilioCredentials(supabase, tenantId);
        if (!creds.isConfigured) {
          return errorResponse('Twilio SMS not fully configured. Complete setup first.');
        }

        const normalized = normalizePhoneNumber(to);
        const body = message?.trim() || 'This is a test SMS from your Drive247 portal. Your Twilio SMS integration is working!';
        const result = await sendTenantSMS(
          creds,
          normalized,
          body
        );

        return jsonResponse(result);
      }

      case 'get-status': {
        const creds = await getTenantTwilioCredentials(supabase, tenantId);

        // Fetch 10DLC registration status from DB
        const { data: tenantData } = await supabase
          .from('tenants')
          .select('twilio_brand_sid, twilio_brand_status, twilio_campaign_sid, twilio_campaign_status, twilio_messaging_service_sid')
          .eq('id', tenantId)
          .single();

        // Fetch number capabilities from Twilio if we have a number
        let capabilities: { sms: boolean; voice: boolean; mms: boolean; fax: boolean } | null = null;
        if (creds.phoneNumberSid && creds.sid && creds.authToken) {
          try {
            const numUrl = `https://api.twilio.com/2010-04-01/Accounts/${creds.sid}/IncomingPhoneNumbers/${creds.phoneNumberSid}.json`;
            const numResp = await fetch(numUrl, {
              headers: { 'Authorization': `Basic ${btoa(`${creds.sid}:${creds.authToken}`)}` },
            });
            const numData = await numResp.json();
            if (numData.capabilities) {
              capabilities = {
                sms: numData.capabilities.sms ?? false,
                voice: numData.capabilities.voice ?? false,
                mms: numData.capabilities.mms ?? false,
                fax: numData.capabilities.fax ?? false,
              };
            }
          } catch (err: any) {
            console.warn('[Twilio] Failed to fetch number capabilities:', err.message);
          }
        }

        return jsonResponse({
          success: true,
          hasSubaccount: !!creds.sid,
          subaccountSid: creds.sid || null,
          hasPhoneNumber: !!creds.phoneNumber,
          phoneNumber: creds.phoneNumber || null,
          phoneNumberSid: creds.phoneNumberSid || null,
          isConfigured: creds.isConfigured,
          capabilities,
          // 10DLC registration status
          brandSid: tenantData?.twilio_brand_sid || null,
          brandStatus: tenantData?.twilio_brand_status || null,
          campaignSid: tenantData?.twilio_campaign_sid || null,
          campaignStatus: tenantData?.twilio_campaign_status || null,
          messagingServiceSid: tenantData?.twilio_messaging_service_sid || null,
        });
      }

      case 'register-brand': {
        const creds = await getTenantTwilioCredentials(supabase, tenantId);
        if (!creds.sid) return errorResponse('No Twilio subaccount. Create one first.');

        const { brandName, companyType, taxId, taxIdCountry, website, vertical } = params;
        if (!brandName) return errorResponse('brandName is required');

        try {
          const result = await registerBrand(creds.sid, creds.authToken, {
            brandName,
            companyType: companyType || 'private',
            taxId: taxId || '',
            taxIdCountry: taxIdCountry || 'US',
            website: website || '',
            vertical: vertical || 'TRANSPORTATION',
          });

          // Save to DB
          await supabase
            .from('tenants')
            .update({
              twilio_brand_sid: result.brandSid,
              twilio_brand_status: result.status.toLowerCase(),
            })
            .eq('id', tenantId);

          return jsonResponse({
            success: true,
            brandSid: result.brandSid,
            status: result.status,
          });
        } catch (err: any) {
          console.error('[Twilio] Brand registration error:', err.message);
          return errorResponse(`Brand registration failed: ${err.message}`);
        }
      }

      case 'create-messaging-service': {
        const creds = await getTenantTwilioCredentials(supabase, tenantId);
        if (!creds.sid) return errorResponse('No Twilio subaccount. Create one first.');

        const { data: tenant } = await supabase
          .from('tenants')
          .select('company_name, slug')
          .eq('id', tenantId)
          .single();

        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const inboundUrl = `${supabaseUrl}/functions/v1/twilio-inbound-sms`;
        const statusUrl = `${supabaseUrl}/functions/v1/twilio-sms-status`;

        try {
          const result = await createMessagingService(
            creds.sid,
            creds.authToken,
            `Drive247 - ${tenant?.company_name || tenant?.slug || tenantId}`,
            inboundUrl,
            statusUrl
          );

          // Save to DB
          await supabase
            .from('tenants')
            .update({ twilio_messaging_service_sid: result.serviceSid })
            .eq('id', tenantId);

          // If phone number exists, add it to the messaging service
          if (creds.phoneNumberSid) {
            try {
              await addNumberToMessagingService(
                creds.sid,
                creds.authToken,
                result.serviceSid,
                creds.phoneNumberSid
              );
            } catch (addErr: any) {
              console.warn('[Twilio] Failed to add number to messaging service:', addErr.message);
            }
          }

          return jsonResponse({
            success: true,
            messagingServiceSid: result.serviceSid,
          });
        } catch (err: any) {
          console.error('[Twilio] Messaging service error:', err.message);
          return errorResponse(`Messaging service creation failed: ${err.message}`);
        }
      }

      case 'register-campaign': {
        const creds = await getTenantTwilioCredentials(supabase, tenantId);
        if (!creds.sid) return errorResponse('No Twilio subaccount. Create one first.');

        const { data: tenantData } = await supabase
          .from('tenants')
          .select('twilio_brand_sid, twilio_messaging_service_sid, company_name')
          .eq('id', tenantId)
          .single();

        if (!tenantData?.twilio_brand_sid) return errorResponse('Brand must be registered first.');
        if (!tenantData?.twilio_messaging_service_sid) return errorResponse('Messaging service must be created first.');

        const companyName = tenantData?.company_name || 'our company';

        try {
          const result = await registerCampaign(creds.sid, creds.authToken, {
            brandRegistrationSid: tenantData.twilio_brand_sid,
            messagingServiceSid: tenantData.twilio_messaging_service_sid,
            description: `Customer communication for ${companyName} car rental operations including booking confirmations, pickup reminders, payment notifications, and customer support.`,
            useCase: 'MIXED',
            sampleMessages: [
              `Hi {{name}}, your rental booking #{{ref}} has been confirmed. Pickup: {{date}} at {{location}}.`,
              `Reminder: Your rental is due for return tomorrow. Please ensure the vehicle is returned on time.`,
              `Your payment of ${{amount}} has been received. Thank you for choosing ${companyName}.`,
            ],
            hasEmbeddedLinks: true,
            hasEmbeddedPhone: true,
            messageFlow: `Customers opt-in to receive SMS when they create a booking through our website or when a rental operator needs to communicate important rental information.`,
          });

          // Save to DB
          await supabase
            .from('tenants')
            .update({
              twilio_campaign_sid: result.campaignSid,
              twilio_campaign_status: result.status.toLowerCase(),
            })
            .eq('id', tenantId);

          return jsonResponse({
            success: true,
            campaignSid: result.campaignSid,
            status: result.status,
          });
        } catch (err: any) {
          console.error('[Twilio] Campaign registration error:', err.message);
          return errorResponse(`Campaign registration failed: ${err.message}`);
        }
      }

      case 'get-registration-status': {
        const creds = await getTenantTwilioCredentials(supabase, tenantId);
        if (!creds.sid) return errorResponse('No Twilio subaccount.');

        const { data: tenantData } = await supabase
          .from('tenants')
          .select('twilio_brand_sid, twilio_brand_status, twilio_campaign_sid, twilio_campaign_status, twilio_messaging_service_sid')
          .eq('id', tenantId)
          .single();

        const result: any = {
          success: true,
          brand: { sid: tenantData?.twilio_brand_sid, status: tenantData?.twilio_brand_status },
          campaign: { sid: tenantData?.twilio_campaign_sid, status: tenantData?.twilio_campaign_status },
          messagingService: { sid: tenantData?.twilio_messaging_service_sid },
        };

        // Refresh brand status from Twilio if pending
        if (tenantData?.twilio_brand_sid && tenantData?.twilio_brand_status === 'pending') {
          try {
            const brandResult = await getBrandStatus(creds.sid, creds.authToken, tenantData.twilio_brand_sid);
            const newStatus = brandResult.status.toLowerCase();
            result.brand.status = newStatus;
            result.brand.failureReason = brandResult.failureReason;

            if (newStatus !== tenantData.twilio_brand_status) {
              await supabase.from('tenants').update({ twilio_brand_status: newStatus }).eq('id', tenantId);
            }
          } catch (err: any) {
            console.warn('[Twilio] Failed to refresh brand status:', err.message);
          }
        }

        // Refresh campaign status from Twilio if pending
        if (tenantData?.twilio_campaign_sid && tenantData?.twilio_campaign_status === 'pending' && tenantData?.twilio_messaging_service_sid) {
          try {
            const campaignResult = await getCampaignStatus(
              creds.sid,
              creds.authToken,
              tenantData.twilio_messaging_service_sid,
              tenantData.twilio_campaign_sid
            );
            const newStatus = campaignResult.status.toLowerCase();
            result.campaign.status = newStatus;
            result.campaign.failureReason = campaignResult.failureReason;

            if (newStatus !== tenantData.twilio_campaign_status) {
              await supabase.from('tenants').update({ twilio_campaign_status: newStatus }).eq('id', tenantId);
            }
          } catch (err: any) {
            console.warn('[Twilio] Failed to refresh campaign status:', err.message);
          }
        }

        return jsonResponse(result);
      }

      case 'configure-webhooks': {
        const creds = await getTenantTwilioCredentials(supabase, tenantId);
        if (!creds.sid || !creds.phoneNumberSid) {
          return errorResponse('Phone number must be configured first.');
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const smsUrl = `${supabaseUrl}/functions/v1/twilio-inbound-sms`;
        const statusUrl = `${supabaseUrl}/functions/v1/twilio-sms-status`;

        try {
          await configureNumberWebhooks(
            creds.sid,
            creds.authToken,
            creds.phoneNumberSid,
            smsUrl,
            statusUrl
          );

          return jsonResponse({ success: true });
        } catch (err: any) {
          console.error('[Twilio] Webhook config error:', err.message);
          return errorResponse(`Failed to configure webhooks: ${err.message}`);
        }
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
