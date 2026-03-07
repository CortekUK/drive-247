import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getVerificationDetail, getVerificationResults } from "../_shared/modives-client.ts";

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { cmdVerificationId } = await req.json();

    if (!cmdVerificationId) {
      return errorResponse('Missing cmdVerificationId', 400);
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    // Look up the verification record
    const { data: verification, error: lookupError } = await supabaseClient
      .from('cmd_verifications')
      .select('*')
      .eq('id', cmdVerificationId)
      .single();

    if (lookupError || !verification) {
      return errorResponse('Verification not found', 404);
    }

    // If we don't have the applicant_verification_req_guid_id, try to get it
    let applicantVerificationReqGUIDId = verification.applicant_verification_req_guid_id;

    if (!applicantVerificationReqGUIDId && verification.cmd_verification_id) {
      try {
        const detail = await getVerificationDetail(verification.cmd_verification_id);
        applicantVerificationReqGUIDId = detail.applicantVerificationReqGUIDId;

        if (applicantVerificationReqGUIDId) {
          await supabaseClient
            .from('cmd_verifications')
            .update({ applicant_verification_req_guid_id: applicantVerificationReqGUIDId })
            .eq('id', cmdVerificationId);
        }
      } catch (detailError) {
        console.error('[CMD Results] Failed to get detail:', detailError);
      }
    }

    // Try to get results using applicant_verification_id (from webhook) or applicant_verification_req_guid_id
    const lookupId = verification.applicant_verification_id || applicantVerificationReqGUIDId;

    if (!lookupId) {
      return jsonResponse({
        ok: true,
        verification,
        message: 'Verification is still pending — no results available yet',
      });
    }

    try {
      const results = await getVerificationResults(lookupId);

      // Determine status and type-specific fields from results
      const updateData: Record<string, unknown> = {
        verification_results: results,
      };

      // Parse results based on verification type
      if (verification.verification_type === 'insurance') {
        if (results.status) updateData.status = String(results.status).toLowerCase();
        if (results.carrier) updateData.carrier = results.carrier;
        if (results.policyStatus || results.policystatus) {
          updateData.policy_status = results.policyStatus || results.policystatus;
        }
        if (results.activeStatus || results.activestatus) {
          updateData.active_status = results.activeStatus || results.activestatus;
        }
        if (results.isMonitoring !== undefined) {
          updateData.is_monitoring = results.isMonitoring;
        }

        // Map API status to our status values
        const statusStr = String(results.status || '').toLowerCase();
        if (statusStr === 'verified' || statusStr === 'adequate') {
          updateData.status = 'verified';
        } else if (statusStr === 'unverified' || statusStr === 'inadequate') {
          updateData.status = 'unverified';
        } else if (statusStr === 'verifying') {
          updateData.status = 'verifying';
        }
      } else if (verification.verification_type === 'license') {
        if (results.licenseStatus) {
          updateData.license_status = results.licenseStatus;

          const licenseStatusLower = String(results.licenseStatus).toLowerCase();
          if (licenseStatusLower === 'valid') {
            updateData.status = 'valid';
          } else if (licenseStatusLower === 'invalid') {
            updateData.status = 'invalid';
          } else if (licenseStatusLower === 'expired') {
            updateData.status = 'expired';
          }
        }
      }

      // Update the record
      const { error: updateError } = await supabaseClient
        .from('cmd_verifications')
        .update(updateData)
        .eq('id', cmdVerificationId);

      if (updateError) {
        console.error('[CMD Results] Update error:', updateError);
      }

      // Downstream: update rental if insurance verified
      if (updateData.status === 'verified' && verification.verification_type === 'insurance') {
        await supabaseClient
          .from('rentals')
          .update({ insurance_status: 'cmd_verified' })
          .eq('id', verification.rental_id);
        console.log('[CMD Results] Updated rental insurance_status to cmd_verified');
      }

      // Fetch updated verification row
      const { data: updated } = await supabaseClient
        .from('cmd_verifications')
        .select('*')
        .eq('id', cmdVerificationId)
        .single();

      return jsonResponse({
        ok: true,
        verification: updated || verification,
        results,
      });

    } catch (resultsError) {
      console.log('[CMD Results] Results not available yet:', resultsError instanceof Error ? resultsError.message : resultsError);
      return jsonResponse({
        ok: true,
        verification,
        message: 'Results not yet available — verification may still be in progress',
      });
    }

  } catch (error) {
    console.error('[CMD Results] Error:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Internal server error',
      500
    );
  }
});
