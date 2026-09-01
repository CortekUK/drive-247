// @ts-nocheck - This is a Deno Edge Function, not Node.js TypeScript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { enqueueBookingEmail } from '../_shared/email-outbox.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** Shape guard for the booking document gate — see the note at its call site. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ProcessRequest {
  sessionId: string;
  documentFrontPath: string;
  documentBackPath?: string;
  selfiePath: string;
}

interface ProcessResponse {
  ok: boolean;
  result?: 'verified' | 'rejected' | 'review_required';
  details?: {
    ocrData: any;
    faceMatchScore: number;
    faceMatchResult: string;
  };
  error?: string;
  detail?: string;
}

/**
 * Get public URL for a storage path
 */
function getStoragePublicUrl(supabase: any, bucket: string, path: string): string {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Call the ai-document-ocr function
 */
async function callOCR(
  documentFrontUrl: string,
  documentBackUrl?: string
): Promise<{ ok: boolean; extractedData?: any; error?: string }> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  const response = await fetch(`${supabaseUrl}/functions/v1/ai-document-ocr`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${serviceKey}`
    },
    body: JSON.stringify({
      documentFrontUrl,
      documentBackUrl
    })
  });

  return await response.json();
}

/**
 * Call the ai-face-match function
 */
async function callFaceMatch(
  documentImageUrl: string,
  selfieImageUrl: string
): Promise<{ ok: boolean; similarity?: number; isMatch?: boolean; needsReview?: boolean; error?: string }> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  const response = await fetch(`${supabaseUrl}/functions/v1/ai-face-match`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${serviceKey}`
    },
    body: JSON.stringify({
      documentImageUrl,
      selfieImageUrl
    })
  });

  return await response.json();
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { sessionId, documentFrontPath, documentBackPath, selfiePath } = await req.json() as ProcessRequest;

    if (!sessionId || !documentFrontPath || !selfiePath) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'sessionId, documentFrontPath, and selfiePath are required'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Verify the session exists and is pending (query by session_id, not id).
    // external_user_id is fetched too so we can detect additional-driver sessions
    // — they have customer_id=NULL and external_user_id="additional_driver_<uuid>".
    const { data: verification, error: verificationError } = await supabaseClient
      .from('identity_verifications')
      .select('id, customer_id, tenant_id, status, external_user_id')
      .eq('session_id', sessionId)
      .single();

    // Store the record ID for subsequent updates
    const recordId = verification?.id;

    if (verificationError || !verification) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Verification session not found'
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update status to processing
    await supabaseClient
      .from('identity_verifications')
      .update({
        status: 'processing',
        updated_at: new Date().toISOString()
      })
      .eq('id', recordId);

    // Get public URLs for the images
    const bucket = 'customer-documents';
    const documentFrontUrl = getStoragePublicUrl(supabaseClient, bucket, documentFrontPath);
    const documentBackUrl = documentBackPath
      ? getStoragePublicUrl(supabaseClient, bucket, documentBackPath)
      : undefined;
    const selfieUrl = getStoragePublicUrl(supabaseClient, bucket, selfiePath);

    console.log('Processing AI verification for session:', sessionId);
    console.log('Document front URL:', documentFrontUrl);
    console.log('Selfie URL:', selfieUrl);

    // Step 1: OCR extraction
    console.log('Step 1: Running OCR extraction...');
    const ocrResult = await callOCR(documentFrontUrl, documentBackUrl);

    if (!ocrResult.ok) {
      console.error('OCR failed:', ocrResult.error);

      await supabaseClient
        .from('identity_verifications')
        .update({
          status: 'completed',
          review_status: 'completed',
          review_result: 'RED',
          rejection_reason: `OCR extraction failed: ${ocrResult.error}`,
          ai_face_match_result: 'error',
          updated_at: new Date().toISOString()
        })
        .eq('id', recordId);

      return new Response(
        JSON.stringify({
          ok: false,
          result: 'rejected',
          error: 'Document processing failed',
          detail: ocrResult.error
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const ocrData = ocrResult.extractedData;
    console.log('OCR extraction complete:', {
      firstName: ocrData?.firstName,
      lastName: ocrData?.lastName,
      documentType: ocrData?.documentType
    });

    // Step 2: Face matching
    console.log('Step 2: Running face matching...');
    const faceResult = await callFaceMatch(documentFrontUrl, selfieUrl);

    if (!faceResult.ok) {
      const faceErrorDetail = faceResult.detail || faceResult.error || 'Unknown error';
      console.error('Face match failed:', faceResult.error, faceErrorDetail);

      await supabaseClient
        .from('identity_verifications')
        .update({
          status: 'completed',
          review_status: 'completed',
          review_result: 'RED',
          rejection_reason: `Face matching failed: ${faceErrorDetail}`,
          ai_ocr_data: ocrData,
          ai_face_match_result: 'error',
          document_front_url: documentFrontUrl,
          document_back_url: documentBackUrl || null,
          selfie_image_url: selfieUrl,
          updated_at: new Date().toISOString()
        })
        .eq('id', recordId);

      return new Response(
        JSON.stringify({
          ok: false,
          result: 'rejected',
          error: 'Face verification failed',
          detail: faceErrorDetail
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Face match result:', {
      similarity: faceResult.similarity,
      isMatch: faceResult.isMatch,
      needsReview: faceResult.needsReview
    });

    // Determine final result
    let finalResult: 'verified' | 'rejected' | 'review_required';
    let reviewResult: 'GREEN' | 'RED' | 'RETRY';
    let faceMatchResultStr: 'match' | 'no_match' | 'pending';

    if (faceResult.isMatch) {
      finalResult = 'verified';
      reviewResult = 'GREEN';
      faceMatchResultStr = 'match';
    } else if (faceResult.needsReview) {
      finalResult = 'review_required';
      reviewResult = 'RETRY';
      faceMatchResultStr = 'pending';
    } else {
      finalResult = 'rejected';
      reviewResult = 'RED';
      faceMatchResultStr = 'no_match';
    }

    // Update verification record with all results
    const updateData: any = {
      status: 'completed',
      review_status: 'completed',
      review_result: reviewResult,
      verification_completed_at: new Date().toISOString(),
      // OCR data
      ai_ocr_data: ocrData,
      first_name: ocrData?.firstName || null,
      last_name: ocrData?.lastName || null,
      date_of_birth: ocrData?.dateOfBirth || null,
      document_type: ocrData?.documentType || null,
      document_number: ocrData?.documentNumber || null,
      document_country: ocrData?.documentCountry || null,
      document_expiry_date: ocrData?.documentExpiry || null,
      // Face match data
      ai_face_match_score: faceResult.similarity ? faceResult.similarity / 100 : null,
      ai_face_match_result: faceMatchResultStr,
      // Image URLs
      document_front_url: documentFrontUrl,
      document_back_url: documentBackUrl || null,
      selfie_image_url: selfieUrl,
      // Invalidate QR token
      qr_session_token: null,
      updated_at: new Date().toISOString()
    };

    if (finalResult === 'rejected') {
      updateData.rejection_reason = 'Face does not match document photo';
    }

    await supabaseClient
      .from('identity_verifications')
      .update(updateData)
      .eq('id', recordId);

    // Additional-driver routing: when the verification was opened by
    // send-additional-driver-invite the external_user_id is
    // "additional_driver_<uuid>" and customer_id is NULL. Update the
    // rental_additional_drivers row instead of the customers table so the
    // portal badge flips to Verified/Rejected in realtime.
    const externalId = (verification as any).external_user_id || '';
    if (!verification.customer_id && typeof externalId === 'string' && externalId.startsWith('additional_driver_')) {
      const driverId = externalId.replace(/^additional_driver_/, '');
      let driverStatus: 'pending' | 'verified' | 'rejected' = 'pending';
      if (finalResult === 'verified') driverStatus = 'verified';
      else if (finalResult === 'rejected') driverStatus = 'rejected';
      const driverUpdate: Record<string, unknown> = {
        verification_status: driverStatus,
        license_number: ocrData?.documentNumber || null,
      };
      const { error: drvErr } = await supabaseClient
        .from('rental_additional_drivers')
        .update(driverUpdate)
        .eq('id', driverId);
      if (drvErr) {
        console.error('[ProcessAI] additional driver row update failed:', drvErr);
      } else {
        console.log('[ProcessAI] additional driver routed:', driverId, driverStatus);
      }
    }

    // Update customer status if customer_id exists
    if (verification.customer_id) {
      let customerStatus = 'pending';
      if (finalResult === 'verified') {
        customerStatus = 'verified';
      } else if (finalResult === 'rejected') {
        customerStatus = 'rejected';
      }

      const customerUpdate: Record<string, unknown> = {
        identity_verification_status: customerStatus,
        license_number: ocrData?.documentNumber || null,
      };
      // Also copy DOB from verification if not already set on customer
      if (ocrData?.dateOfBirth) {
        customerUpdate.date_of_birth = ocrData.dateOfBirth;
      }
      await supabaseClient
        .from('customers')
        .update(customerUpdate)
        .eq('id', verification.customer_id);
    }

    // Check for blocked identities
    if (ocrData?.documentNumber && verification.tenant_id) {
      const { data: blockedCheck } = await supabaseClient
        .from('blocked_identities')
        .select('reason')
        .eq('identity_number', ocrData.documentNumber)
        .eq('tenant_id', verification.tenant_id)
        .eq('is_active', true)
        .maybeSingle();

      if (blockedCheck) {
        console.log('BLOCKED IDENTITY DETECTED:', ocrData.documentNumber);

        // Update to rejected
        await supabaseClient
          .from('identity_verifications')
          .update({
            review_result: 'RED',
            rejection_reason: `Blocked identity: ${blockedCheck.reason}`
          })
          .eq('id', recordId);

        if (verification.customer_id) {
          await supabaseClient
            .from('customers')
            .update({
              identity_verification_status: 'rejected',
              is_blocked: true,
              blocked_at: new Date().toISOString(),
              blocked_reason: `Blocked identity: ${blockedCheck.reason}`
            })
            .eq('id', verification.customer_id);
        } else if (typeof externalId === 'string' && externalId.startsWith('additional_driver_')) {
          // Additional drivers don't have a `customers` row to block, but we
          // still need to flip their per-rental verification_status to rejected.
          const driverId = externalId.replace(/^additional_driver_/, '');
          await supabaseClient
            .from('rental_additional_drivers')
            .update({ verification_status: 'rejected' })
            .eq('id', driverId);
        }

        finalResult = 'rejected';
      }
    }

    // ---- Booking document gate ---------------------------------------------
    // Scoped by rentals.identity_verification_session_id, which only
    // booking-documents-link ever writes. It therefore matches ZERO rows for the
    // portal, QR and additional-driver flows that also land in this function —
    // they are unaffected by construction, not by a flag.
    //
    // PLACED AFTER THE blocked_identities CHECK, DELIBERATELY. That check runs
    // last and can flip a GREEN verdict to rejected (:379). Writing the gate
    // earlier, next to the customers mirror, would stamp documents_status
    // 'verified' and email "documents received" to a customer the operator has
    // explicitly blocked. Reading `finalResult` here is what makes the block
    // land on the booking too.
    //
    // GREEN *AND* RETRY BOTH COUNT AS VERIFIED. v1's own desktop component
    // admits RETRY and lets the customer proceed
    // (apps/booking/src/components/AIVerificationQR.tsx:142-147). More
    // importantly, this function turns an OCR or Rekognition OUTAGE into
    // review_result 'RED' (:159-183 and :196-225), so a GREEN-only gate would
    // convert an infrastructure failure into "your identity was rejected, your
    // booking is void". 'rejected' is retryable on the v2 page, not terminal.
    // (Those two outage branches return early and never reach here, so they
    // leave documents_status at 'pending' — still retryable, which is right.)
    //
    // The UUID guard is not cosmetic: rentals.identity_verification_session_id
    // is a `uuid` column while identity_verifications.session_id is `text`, so
    // PostgREST answers a hard 400 ("invalid input syntax for type uuid") rather
    // than "no rows" if a non-UUID session id is ever filtered on. Every writer
    // today uses crypto.randomUUID() (create-ai-verification-session/index.ts:136
    // and :222), so this only ever skips a flow that could not have matched.
    const docsStatus =
      finalResult === 'verified' || finalResult === 'review_required' ? 'verified' : 'rejected';

    let gated: { id: string; tenant_id: string }[] | null = null;
    let gateError: unknown = null;
    if (UUID_RE.test(String(sessionId))) {
      const gateResult = await supabaseClient
        .from('rentals')
        .update({
          documents_status: docsStatus,
          documents_completed_at: docsStatus === 'verified' ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('identity_verification_session_id', sessionId)
        .select('id, tenant_id');
      gated = gateResult.data;
      gateError = gateResult.error;
    }

    if (gateError) {
      console.error('[ProcessAI] booking document gate update failed:', gateError);
    } else if (gated && gated.length > 0) {
      console.log('[ProcessAI] booking document gate ->', docsStatus, 'rentals:', gated.length);
      if (docsStatus === 'verified') {
        for (const row of gated) {
          // "Documents received", NOT "booking confirmed". The confirmation
          // email is a separate, later event fired by the operator's approval
          // (notify-booking-approved). Saying confirmed here would tell a
          // customer they are booked while an operator can still reject them.
          await enqueueBookingEmail(supabaseClient, {
            tenantId: row.tenant_id,
            rentalId: row.id,
            emailKey: 'booking_documents_received',
          });
        }
        // Best-effort inline drain — the outbox row is the guarantee, this is
        // only latency. Bounded so a slow mailer cannot hold the customer's
        // upload request open.
        try {
          await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/sweep-booking-emails`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            },
            body: JSON.stringify({ rentalId: gated[0].id }),
            signal: AbortSignal.timeout(8000),
          });
        } catch (e) {
          console.warn('[ProcessAI] inline sweep skipped:', e);
        }

        // Retire the durable link. The row is kept, not deleted: a pending
        // booking_email_dispatch row still references this rental, and the
        // record of when the customer finished is worth having.
        await supabaseClient
          .from('booking_document_links')
          .update({ consumed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('rental_id', gated[0].id);
      }
    }

    console.log('AI verification complete:', finalResult);

    const response: ProcessResponse = {
      ok: true,
      result: finalResult,
      details: {
        ocrData,
        faceMatchScore: faceResult.similarity || 0,
        faceMatchResult: faceMatchResultStr
      }
    };

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Process verification error:', error);
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Verification processing failed',
        detail: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
