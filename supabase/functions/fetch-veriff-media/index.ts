import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { createHmac } from "https://deno.land/std@0.177.0/node/crypto.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
    console.error('Veriff API credentials not configured');
    return null;
  }

  try {
    console.log(`Downloading ${imageType} from:`, imageUrl);

    // Extract media ID from URL for signature
    const urlParts = imageUrl.split('/');
    const mediaId = urlParts[urlParts.length - 1];
    if (!mediaId) {
      console.error(`Failed to extract media ID from URL: ${imageUrl}`);
      return null;
    }

    // Generate signature for the media ID
    const signature = generateVeriffSignature(mediaId, VERIFF_API_SECRET);

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
    console.log(`Downloaded ${imageType}: ${imageBlob.size} bytes`);

    const extension = contentType.includes('png') ? 'png' : 'jpg';
    const fileName = `veriff/${sessionId}/${imageType}.${extension}`;

    // Upload to Supabase Storage
    const { error } = await supabaseClient.storage
      .from('customer-documents')
      .upload(fileName, imageBlob, {
        contentType: contentType,
        upsert: true,
      });

    if (error) {
      console.error(`Failed to upload ${imageType}:`, error);
      return null;
    }

    // Get public URL
    const { data: urlData } = supabaseClient.storage
      .from('customer-documents')
      .getPublicUrl(fileName);

    console.log(`Stored ${imageType}:`, urlData.publicUrl);
    return urlData.publicUrl;

  } catch (error) {
    console.error(`Error processing ${imageType}:`, error);
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { verificationId, sessionId } = await req.json();

    if (!verificationId && !sessionId) {
      return new Response(
        JSON.stringify({ ok: false, error: 'verificationId or sessionId required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const VERIFF_API_KEY = Deno.env.get('VERIFF_API_KEY');
    const VERIFF_API_SECRET = Deno.env.get('VERIFF_API_SECRET');
    const VERIFF_BASE_URL = Deno.env.get('VERIFF_BASE_URL') || 'https://stationapi.veriff.com';

    if (!VERIFF_API_KEY || !VERIFF_API_SECRET) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Veriff API credentials not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    // Get the verification record
    let verification;
    if (verificationId) {
      const { data, error } = await supabaseClient
        .from('identity_verifications')
        .select('*')
        .eq('id', verificationId)
        .single();
      if (error) throw new Error(`Verification not found: ${error.message}`);
      verification = data;
    } else {
      const { data, error } = await supabaseClient
        .from('identity_verifications')
        .select('*')
        .eq('session_id', sessionId)
        .single();
      if (error) throw new Error(`Verification not found: ${error.message}`);
      verification = data;
    }

    const verifSessionId = verification.session_id;
    console.log('Fetching media for session:', verifSessionId);

    // Fetch media list from Veriff
    const mediaUrl = `${VERIFF_BASE_URL}/v1/sessions/${verifSessionId}/media`;
    const signature = generateVeriffSignature(verifSessionId, VERIFF_API_SECRET);

    const response = await fetch(mediaUrl, {
      method: 'GET',
      headers: {
        'X-AUTH-CLIENT': VERIFF_API_KEY,
        'X-HMAC-SIGNATURE': signature,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to fetch media list:', response.status, errorText);
      return new Response(
        JSON.stringify({ ok: false, error: `Failed to fetch media: ${response.status}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const mediaData = await response.json();
    console.log('Found', mediaData.images?.length || 0, 'images');

    const result: Record<string, string> = {};

    // Download and store each image
    if (mediaData.images && Array.isArray(mediaData.images)) {
      for (const image of mediaData.images) {
        if (image.context === 'document-front' && image.url) {
          const url = await downloadAndStoreImage(supabaseClient, image.url, verifSessionId, 'document-front');
          if (url) result.document_front_url = url;
        } else if (image.context === 'document-back' && image.url) {
          const url = await downloadAndStoreImage(supabaseClient, image.url, verifSessionId, 'document-back');
          if (url) result.document_back_url = url;
        } else if (image.context === 'face' && image.url) {
          const url = await downloadAndStoreImage(supabaseClient, image.url, verifSessionId, 'face');
          if (url) result.face_image_url = url;
        }
      }
    }

    // Update the verification record with new URLs
    if (Object.keys(result).length > 0) {
      const updateData = {
        ...result,
        media_fetched_at: new Date().toISOString(),
      };

      const { error: updateError } = await supabaseClient
        .from('identity_verifications')
        .update(updateData)
        .eq('id', verification.id);

      if (updateError) {
        console.error('Failed to update verification:', updateError);
      } else {
        console.log('Updated verification with media URLs');
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        message: `Fetched ${Object.keys(result).length} images`,
        urls: result,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
