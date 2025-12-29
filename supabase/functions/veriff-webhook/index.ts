import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { createHmac } from "https://deno.land/std@0.177.0/node/crypto.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-hmac-signature, x-signature',
};

// Generate HMAC-SHA256 signature for Veriff API
function generateVeriffSignature(payload: string, secret: string): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(payload);
  return hmac.digest('hex');
}

// Download image from Veriff and upload to Supabase Storage
async function downloadAndStoreImage(
  supabaseClient: any,
  imageUrl: string,
  sessionId: string,
  imageType: string
): Promise<string | null> {
  const VERIFF_API_KEY = Deno.env.get('VERIFF_API_KEY');
  const VERIFF_API_SECRET = Deno.env.get('VERIFF_API_SECRET');

  if (!VERIFF_API_KEY || !VERIFF_API_SECRET) {
    console.error('Veriff API credentials not configured for media download');
    return null;
  }

  try {
    console.log(`Downloading ${imageType} from:`, imageUrl);

    // Extract media ID from URL for signature (last segment of URL path)
    const urlParts = imageUrl.split('/');
    const mediaId = urlParts[urlParts.length - 1];
    if (!mediaId) {
      console.error(`Failed to extract media ID from URL: ${imageUrl}`);
      return null;
    }

    // Generate signature for the media ID (lowercase hex HMAC-SHA256)
    const signature = generateVeriffSignature(mediaId, VERIFF_API_SECRET);
    console.log(`Generated signature for mediaId ${mediaId}`);

    // Download image from Veriff
    const response = await fetch(imageUrl, {
      method: 'GET',
      headers: {
        'X-AUTH-CLIENT': VERIFF_API_KEY,
        'X-HMAC-SIGNATURE': signature,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to download ${imageType}: ${response.status} - ${errorText}`);
      return null;
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const imageBlob = await response.blob();
    console.log(`Downloaded ${imageType}: ${imageBlob.size} bytes, type: ${contentType}`);

    // Determine file extension from content type
    const extension = contentType.includes('png') ? 'png' : 'jpg';
    const fileName = `veriff/${sessionId}/${imageType}.${extension}`;

    // Upload to Supabase Storage
    const { data, error } = await supabaseClient.storage
      .from('customer-documents')
      .upload(fileName, imageBlob, {
        contentType: contentType,
        upsert: true,
      });

    if (error) {
      console.error(`Failed to upload ${imageType} to storage:`, error);
      return null;
    }

    // Get public URL
    const { data: urlData } = supabaseClient.storage
      .from('customer-documents')
      .getPublicUrl(fileName);

    console.log(`Successfully stored ${imageType}:`, urlData.publicUrl);
    return urlData.publicUrl;

  } catch (error) {
    console.error(`Error processing ${imageType}:`, error);
    return null;
  }
}

// Fetch media (document images, face photo) from Veriff API and store in Supabase
async function fetchVeriffMedia(sessionId: string, supabaseClient: any): Promise<{
  documentFrontUrl?: string;
  documentBackUrl?: string;
  faceImageUrl?: string;
} | null> {
  const VERIFF_API_KEY = Deno.env.get('VERIFF_API_KEY');
  const VERIFF_API_SECRET = Deno.env.get('VERIFF_API_SECRET');
  const VERIFF_BASE_URL = Deno.env.get('VERIFF_BASE_URL') || 'https://stationapi.veriff.com';

  if (!VERIFF_API_KEY || !VERIFF_API_SECRET) {
    console.log('Veriff API credentials not configured - skipping media fetch');
    return null;
  }

  try {
    console.log('Fetching media for session:', sessionId);

    // Veriff Media API endpoint
    const mediaUrl = `${VERIFF_BASE_URL}/v1/sessions/${sessionId}/media`;

    // Generate HMAC signature - Veriff expects signature of the session ID
    const signature = generateVeriffSignature(sessionId, VERIFF_API_SECRET);

    const response = await fetch(mediaUrl, {
      method: 'GET',
      headers: {
        'X-AUTH-CLIENT': VERIFF_API_KEY,
        'X-HMAC-SIGNATURE': signature,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error('Failed to fetch Veriff media:', response.status, await response.text());
      return null;
    }

    const data = await response.json();
    console.log('Veriff media response - found', data.images?.length || 0, 'images');

    const result: {
      documentFrontUrl?: string;
      documentBackUrl?: string;
      faceImageUrl?: string;
    } = {};

    // Extract media URLs and download/store images
    if (data.images && Array.isArray(data.images)) {
      for (const image of data.images) {
        if (image.context === 'document-front' && image.url) {
          const storedUrl = await downloadAndStoreImage(supabaseClient, image.url, sessionId, 'document-front');
          if (storedUrl) result.documentFrontUrl = storedUrl;
        } else if (image.context === 'document-back' && image.url) {
          const storedUrl = await downloadAndStoreImage(supabaseClient, image.url, sessionId, 'document-back');
          if (storedUrl) result.documentBackUrl = storedUrl;
        } else if (image.context === 'face' && image.url) {
          const storedUrl = await downloadAndStoreImage(supabaseClient, image.url, sessionId, 'face');
          if (storedUrl) result.faceImageUrl = storedUrl;
        }
      }
    }

    console.log('Stored media URLs:', result);
    return result;

  } catch (error) {
    console.error('Error fetching Veriff media:', error);
    return null;
  }
}

interface VeriffWebhookPayload {
  id: string;
  feature: string;
  code: number;
  action: string;
  vendorData: string;
  verification: {
    id: string;
    code: number;
    person?: {
      firstName?: string;
      lastName?: string;
      dateOfBirth?: string;
      idNumber?: string;
    };
    document?: {
      number?: string;
      type?: string;
      country?: string;
      validFrom?: string;
      validUntil?: string;
    };
    status: string;
    reason?: string;
    reasonCode?: number;
    decisionTime?: string;
  };
}

// Verify webhook signature (optional but recommended)
function verifySignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  try {
    const hmac = createHmac('sha256', secret);
    hmac.update(payload);
    const expectedSignature = hmac.digest('hex');
    return signature.toLowerCase() === expectedSignature.toLowerCase();
  } catch (error) {
    console.error('Error verifying signature:', error);
    return false;
  }
}

async function handleVeriffWebhook(
  supabaseClient: any,
  payload: VeriffWebhookPayload
): Promise<{ ok: boolean; error?: string }> {
  try {
    console.log('Processing Veriff webhook:', payload.action);
    console.log('Full payload:', JSON.stringify(payload));

    // Determine session ID based on event type
    // For "submitted" events, the session ID is in payload.id
    // For "decision" events, the session ID is in payload.verification.id
    let sessionId: string;

    // Handle different event types
    if (payload.action === 'started') {
      // Started event - verification session has begun
      sessionId = payload.id;
      console.log('Started event - Session ID:', sessionId);
      // Just acknowledge - no processing needed
      return { ok: true };
    }

    if (payload.action === 'submitted') {
      // Submitted event - session ID is in root
      sessionId = payload.id;
      console.log('Submitted event - Session ID:', sessionId);

      // For submitted events, just acknowledge receipt - don't process results yet
      const { error: updateError } = await supabaseClient
        .from('identity_verifications')
        .update({
          status: 'pending',
          review_status: 'pending',
          updated_at: new Date().toISOString()
        })
        .eq('session_id', sessionId);

      if (updateError) {
        console.error('Error updating verification:', updateError);
        // Don't fail on error - might be booking flow without record yet
        console.log('Continuing anyway - might be booking flow');
      } else {
        console.log('Successfully marked verification as submitted');
      }

      return { ok: true };
    }

    // Decision event - extract from verification object
    if (!payload.verification || !payload.verification.id) {
      console.error('Invalid decision payload structure - missing verification.id');
      console.log('Payload action:', payload.action);
      console.log('Acknowledging unknown event type');
      return { ok: true }; // Acknowledge but don't process
    }

    sessionId = payload.verification.id;
    console.log('Decision event - Session ID:', sessionId);
    console.log('Customer ID (vendorData):', payload.vendorData);

    // Find the verification record by session_id
    const { data: verification, error: verificationError } = await supabaseClient
      .from('identity_verifications')
      .select('*, customers:customer_id(*)')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (verificationError || !verification) {
      // Verification record not found - this is expected for booking flow
      // where verification is started before customer is created
      console.log('Verification record not found for session:', sessionId);
      console.log('This may be a booking flow verification - creating pending record');

      // Create a temporary verification record without customer_id
      // This will be linked to customer later when booking is completed
      const tempVerificationData: any = {
        provider: 'veriff',
        session_id: sessionId,
        external_user_id: payload.vendorData,
        status: 'pending',
        review_status: 'pending',
        updated_at: new Date().toISOString(),
      };

      // Map Veriff status codes
      if (payload.verification.code === 9001) {
        tempVerificationData.review_result = 'GREEN';
        tempVerificationData.status = 'completed';
        tempVerificationData.review_status = 'completed';
        tempVerificationData.verification_completed_at = new Date().toISOString();
      } else if (payload.verification.code === 9102) {
        tempVerificationData.review_result = 'RED';
        tempVerificationData.status = 'completed';
        tempVerificationData.review_status = 'completed';
        tempVerificationData.rejection_reason = payload.verification.reason || 'Verification declined';
      } else if (payload.verification.code === 9103) {
        tempVerificationData.review_result = 'RETRY';
      }

      // Extract document information if available
      if (payload.verification.document) {
        tempVerificationData.document_type = payload.verification.document.type || null;
        tempVerificationData.document_number = payload.verification.document.number || null;
        tempVerificationData.document_country = payload.verification.document.country || null;
        if (payload.verification.document.validUntil) {
          tempVerificationData.document_expiry_date = payload.verification.document.validUntil;
        }
      }

      // Extract personal information if available
      if (payload.verification.person) {
        tempVerificationData.first_name = payload.verification.person.firstName || null;
        tempVerificationData.last_name = payload.verification.person.lastName || null;
        if (payload.verification.person.dateOfBirth) {
          tempVerificationData.date_of_birth = payload.verification.person.dateOfBirth;
        }
      }

      // Fetch media for completed verifications
      if (payload.verification.code === 9001 || payload.verification.code === 9102) {
        console.log('Fetching media for temp verification record...');
        const media = await fetchVeriffMedia(sessionId, supabaseClient);
        if (media) {
          if (media.documentFrontUrl) {
            tempVerificationData.document_front_url = media.documentFrontUrl;
          }
          if (media.documentBackUrl) {
            tempVerificationData.document_back_url = media.documentBackUrl;
          }
          if (media.faceImageUrl) {
            tempVerificationData.face_image_url = media.faceImageUrl;
          }
          tempVerificationData.media_fetched_at = new Date().toISOString();
        }
      }

      // Try to create the record
      const { error: createError } = await supabaseClient
        .from('identity_verifications')
        .insert(tempVerificationData);

      if (createError) {
        console.error('Error creating temporary verification record:', createError);
      } else {
        console.log('Created temporary verification record for session:', sessionId);
      }

      return { ok: true };
    }

    console.log('Found verification for customer:', verification.customer_id);

    // Prepare update data
    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    // Map Veriff status codes to our status
    // Veriff codes: 9001 = approved, 9102 = declined, 9103 = resubmission requested
    if (payload.verification.code === 9001) {
      updateData.review_result = 'GREEN';
      updateData.status = 'completed';
      updateData.review_status = 'completed';
      updateData.verification_completed_at = new Date().toISOString();
    } else if (payload.verification.code === 9102) {
      updateData.review_result = 'RED';
      updateData.status = 'completed';
      updateData.review_status = 'completed';
      updateData.rejection_reason = payload.verification.reason || 'Verification declined';
    } else if (payload.verification.code === 9103) {
      updateData.review_result = 'RETRY';
      updateData.status = 'pending';
      updateData.review_status = 'pending';
    } else {
      // In progress or other status
      updateData.status = 'pending';
      updateData.review_status = 'pending';
    }

    // Extract document information if available
    if (payload.verification.document) {
      updateData.document_type = payload.verification.document.type || null;
      updateData.document_number = payload.verification.document.number || null;
      updateData.document_country = payload.verification.document.country || null;
      if (payload.verification.document.validUntil) {
        updateData.document_expiry_date = payload.verification.document.validUntil;
      }
    }

    // Extract personal information if available
    if (payload.verification.person) {
      updateData.first_name = payload.verification.person.firstName || null;
      updateData.last_name = payload.verification.person.lastName || null;
      if (payload.verification.person.dateOfBirth) {
        updateData.date_of_birth = payload.verification.person.dateOfBirth;
      }
    }

    // Fetch media (document images, face photo) for completed verifications
    if (payload.verification.code === 9001 || payload.verification.code === 9102) {
      console.log('Fetching media for completed verification...');
      const media = await fetchVeriffMedia(sessionId, supabaseClient);
      if (media) {
        if (media.documentFrontUrl) {
          updateData.document_front_url = media.documentFrontUrl;
        }
        if (media.documentBackUrl) {
          updateData.document_back_url = media.documentBackUrl;
        }
        if (media.faceImageUrl) {
          updateData.face_image_url = media.faceImageUrl;
        }
        updateData.media_fetched_at = new Date().toISOString();
        console.log('Media URLs added to update data');
      }
    }

    // Update verification record
    const { error: updateError } = await supabaseClient
      .from('identity_verifications')
      .update(updateData)
      .eq('id', verification.id);

    if (updateError) {
      console.error('Error updating verification:', updateError);
      return { ok: false, error: updateError.message };
    }

    // Check if the document number is in the blocked list (tenant-scoped)
    let isBlockedIdentity = false;
    let blockReason = '';

    // Get tenant_id from verification or customer for tenant-scoped blocking check
    const tenantId = verification.tenant_id || verification.customers?.tenant_id;

    if (updateData.document_number && tenantId) {
      // Use tenant-scoped check - only check blocked identities for this tenant
      const { data: blockedCheck } = await supabaseClient
        .from('blocked_identities')
        .select('reason, identity_type')
        .eq('identity_number', updateData.document_number)
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .maybeSingle();

      if (blockedCheck) {
        isBlockedIdentity = true;
        blockReason = blockedCheck.reason;
        console.log('BLOCKED IDENTITY DETECTED:', updateData.document_number, 'Tenant:', tenantId, 'Reason:', blockReason);
      }
    } else if (updateData.document_number && !tenantId) {
      console.log('WARNING: No tenant_id found for verification - skipping blocked identity check');
    }

    // Update customer status
    let customerStatus = 'pending';
    let customerIsBlocked = false;

    if (isBlockedIdentity) {
      // Override to rejected if identity is blocked
      customerStatus = 'rejected';
      customerIsBlocked = true;
      console.log('Setting customer as blocked due to blocked identity');
    } else if (payload.verification.code === 9001) {
      customerStatus = 'verified';
    } else if (payload.verification.code === 9102) {
      customerStatus = 'rejected';
    }

    // Update customer with verification status and potentially block them
    const customerUpdatePayload: any = {
      identity_verification_status: customerStatus,
      // Also store the license/ID number on the customer record
      license_number: updateData.document_number || null
    };

    if (customerIsBlocked) {
      customerUpdatePayload.is_blocked = true;
      customerUpdatePayload.blocked_at = new Date().toISOString();
      customerUpdatePayload.blocked_reason = `Blocked identity: ${blockReason}`;
    }

    const { error: customerUpdateError } = await supabaseClient
      .from('customers')
      .update(customerUpdatePayload)
      .eq('id', verification.customer_id);

    if (customerUpdateError) {
      console.error('Error updating customer status:', customerUpdateError);
    }

    // If blocked, create a notification for admins
    if (isBlockedIdentity) {
      // tenantId already defined above for blocked identity check

      // Query admins for the same tenant (or all admins if no tenant)
      let adminQuery = supabaseClient
        .from('app_users')
        .select('id')
        .in('role', ['admin', 'head_admin']);

      if (tenantId) {
        adminQuery = adminQuery.eq('tenant_id', tenantId);
      }

      const { data: adminUsers } = await adminQuery;

      for (const admin of adminUsers || []) {
        const notificationData: any = {
          user_id: admin.id,
          title: 'Blocked Identity Detected',
          message: `A blocked identity was detected during verification. Document: ${updateData.document_number}. Reason: ${blockReason}`,
          type: 'reminder_critical',
          link: `/customers/${verification.customer_id}`,
          metadata: {
            customer_id: verification.customer_id,
            document_number: updateData.document_number,
            block_reason: blockReason
          }
        };

        // Add tenant_id if available
        if (tenantId) {
          notificationData.tenant_id = tenantId;
        }

        await supabaseClient.from('notifications').insert(notificationData);
      }
    }

    console.log('Successfully processed webhook for verification:', verification.id);
    return { ok: true };

  } catch (error) {
    console.error('Error handling Veriff webhook:', error);
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Handle GET requests (for testing/health check)
  if (req.method === 'GET') {
    return new Response(
      JSON.stringify({
        ok: true,
        message: 'Veriff webhook endpoint is active',
        info: 'This endpoint receives POST requests from Veriff with verification data'
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    // Get payload
    const payloadText = await req.text();

    // Check if payload is empty
    if (!payloadText || payloadText.trim() === '') {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Empty payload',
          message: 'Webhook expects POST request with JSON data from Veriff'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const payload: VeriffWebhookPayload = JSON.parse(payloadText);

    // Optional: Verify signature if VERIFF_WEBHOOK_SECRET is set
    const VERIFF_WEBHOOK_SECRET = Deno.env.get('VERIFF_WEBHOOK_SECRET');
    const signature = req.headers.get('X-HMAC-SIGNATURE') || req.headers.get('X-Signature');

    if (VERIFF_WEBHOOK_SECRET && signature) {
      const isValid = verifySignature(payloadText, signature, VERIFF_WEBHOOK_SECRET);
      if (!isValid) {
        console.error('Invalid webhook signature');
        return new Response(
          JSON.stringify({ ok: false, error: 'Invalid signature' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      console.log('Webhook signature verified successfully');
    }

    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      }
    );

    // Handle webhook
    const result = await handleVeriffWebhook(supabaseClient, payload);

    return new Response(
      JSON.stringify(result),
      {
        status: result.ok ? 200 : 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Webhook function error:', error);
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Internal server error',
        detail: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
