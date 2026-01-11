// @ts-nocheck - This is a Deno Edge Function, not Node.js TypeScript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    // Verify the session exists and is pending (query by session_id, not id)
    const { data: verification, error: verificationError } = await supabaseClient
      .from('identity_verifications')
      .select('id, customer_id, tenant_id, status')
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
      console.error('Face match failed:', faceResult.error);

      await supabaseClient
        .from('identity_verifications')
        .update({
          status: 'completed',
          review_status: 'completed',
          review_result: 'RED',
          rejection_reason: `Face matching failed: ${faceResult.error}`,
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
          detail: faceResult.error
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

    // Update customer status if customer_id exists
    if (verification.customer_id) {
      let customerStatus = 'pending';
      if (finalResult === 'verified') {
        customerStatus = 'verified';
      } else if (finalResult === 'rejected') {
        customerStatus = 'rejected';
      }

      await supabaseClient
        .from('customers')
        .update({
          identity_verification_status: customerStatus,
          license_number: ocrData?.documentNumber || null
        })
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
        }

        finalResult = 'rejected';
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
