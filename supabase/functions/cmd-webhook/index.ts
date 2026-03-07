import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyWebhookSignature, getVerificationResults } from "../_shared/modives-client.ts";

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method === 'GET') {
    return jsonResponse({
      ok: true,
      message: 'CMD webhook endpoint is active',
    });
  }

  try {
    const payloadText = await req.text();

    if (!payloadText || payloadText.trim() === '') {
      return errorResponse('Empty payload', 400);
    }

    // Parse and verify signature from modives-signature header
    // Format: t=<timestamp>|s=<base64-encoded hash>
    const signatureHeader = req.headers.get('modives-signature');

    if (signatureHeader) {
      const parts = signatureHeader.split('|');
      let timestamp = '';
      let signature = '';

      for (const part of parts) {
        const [key, ...valueParts] = part.split('=');
        const value = valueParts.join('=');
        if (key.trim() === 't') timestamp = value;
        if (key.trim() === 's') signature = value;
      }

      if (timestamp && signature) {
        const isValid = verifyWebhookSignature(timestamp, payloadText, signature);
        if (!isValid) {
          console.error('[CMD Webhook] Invalid signature');
          return errorResponse('Invalid signature', 401);
        }
        console.log('[CMD Webhook] Signature verified');
      }
    }

    const payload = JSON.parse(payloadText);
    const header = payload?.Payload?.Header;
    const body = payload?.Payload?.Body;

    if (!header || !body) {
      console.error('[CMD Webhook] Invalid payload structure');
      return errorResponse('Invalid payload structure', 400);
    }

    const objectType = header.object_type;
    const eventName = header.event_name;
    const uuid = body.uuid;

    console.log(`[CMD Webhook] Received: ${objectType}/${eventName} uuid=${uuid}`);

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    // Look up verification record by applicant_verification_req_guid_id or applicant_verification_id
    const { data: verification, error: lookupError } = await supabaseClient
      .from('cmd_verifications')
      .select('*')
      .or(`applicant_verification_req_guid_id.eq.${uuid},applicant_verification_id.eq.${uuid}`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lookupError) {
      console.error('[CMD Webhook] Lookup error:', lookupError);
      return errorResponse('Database lookup error', 500);
    }

    if (!verification) {
      console.log('[CMD Webhook] No matching verification found for uuid:', uuid);
      // Acknowledge anyway to prevent Modives from retrying
      return jsonResponse({ ok: true, message: 'No matching verification found' });
    }

    console.log('[CMD Webhook] Found verification:', verification.id);

    // Map event to status
    let newStatus = verification.status;
    const updateData: Record<string, unknown> = {
      webhook_payload: payload,
      webhook_received_at: new Date().toISOString(),
      applicant_verification_id: uuid,
    };

    if (objectType === 'Verification') {
      switch (eventName) {
        case 'LinkSent':
          newStatus = 'link_sent';
          break;
        case 'Verifying':
          newStatus = 'verifying';
          break;
        case 'Verified':
          newStatus = 'verified';
          break;
        case 'Unverified':
          newStatus = 'unverified';
          break;
      }

      // Store insurance-specific fields
      if (body.carrier) updateData.carrier = body.carrier;
      if (body.policystatus) updateData.policy_status = body.policystatus;
      if (body.activestatus) updateData.active_status = body.activestatus;
      if (body.isMonitoring !== undefined) updateData.is_monitoring = body.isMonitoring;
    } else if (objectType === 'License') {
      switch (eventName) {
        case 'Valid':
          newStatus = 'valid';
          break;
        case 'Invalid':
          newStatus = 'invalid';
          break;
        case 'Expired':
          newStatus = 'expired';
          break;
      }

      updateData.license_status = eventName;
    }

    updateData.status = newStatus;

    // Update the verification record
    const { error: updateError } = await supabaseClient
      .from('cmd_verifications')
      .update(updateData)
      .eq('id', verification.id);

    if (updateError) {
      console.error('[CMD Webhook] Update error:', updateError);
      return errorResponse('Failed to update verification', 500);
    }

    // Downstream updates
    if (objectType === 'Verification' && eventName === 'Verified') {
      // Update rental insurance status
      const { error: rentalError } = await supabaseClient
        .from('rentals')
        .update({ insurance_status: 'cmd_verified' })
        .eq('id', verification.rental_id);

      if (rentalError) {
        console.error('[CMD Webhook] Failed to update rental insurance status:', rentalError);
      } else {
        console.log('[CMD Webhook] Updated rental insurance_status to cmd_verified');
      }
    }

    // Fetch full results for completed verifications
    if (['verified', 'unverified', 'valid', 'invalid', 'expired'].includes(newStatus)) {
      try {
        const results = await getVerificationResults(uuid);
        await supabaseClient
          .from('cmd_verifications')
          .update({ verification_results: results })
          .eq('id', verification.id);
        console.log('[CMD Webhook] Stored full verification results');
      } catch (resultsError) {
        console.error('[CMD Webhook] Failed to fetch full results:', resultsError);
      }
    }

    console.log(`[CMD Webhook] Processed ${objectType}/${eventName} → status: ${newStatus}`);
    return jsonResponse({ ok: true });

  } catch (error) {
    console.error('[CMD Webhook] Error:', error);
    return errorResponse('Internal server error', 500);
  }
});
