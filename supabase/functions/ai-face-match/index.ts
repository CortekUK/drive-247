// @ts-nocheck - This is a Deno Edge Function, not Node.js TypeScript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FaceMatchRequest {
  documentImageUrl: string;
  selfieImageUrl: string;
}

interface FaceMatchResponse {
  ok: boolean;
  similarity?: number;       // 0-100 percentage
  isMatch?: boolean;         // true if similarity >= 90%
  confidence?: number;       // Face detection confidence
  needsReview?: boolean;     // true if similarity 70-89%
  error?: string;
  detail?: string;
}

// Match thresholds
const MATCH_THRESHOLD = 90;      // >= 90% is a match
const REVIEW_THRESHOLD = 70;     // 70-89% needs manual review
// < 70% is no match

/**
 * Convert Uint8Array to base64 string (handles large arrays safely)
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 8192; // Process in chunks to avoid stack overflow
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

/**
 * Download image from URL and return as Uint8Array
 */
async function downloadImage(url: string, supabase?: any): Promise<Uint8Array | null> {
  try {
    // Check if it's a Supabase storage URL
    if (url.includes('supabase') && url.includes('storage')) {
      const pathMatch = url.match(/\/storage\/v1\/object\/public\/([^?]+)/);
      if (pathMatch && supabase) {
        const fullPath = pathMatch[1];
        const [bucket, ...pathParts] = fullPath.split('/');
        const filePath = pathParts.join('/');

        console.log('Downloading from Supabase storage:', bucket, filePath);

        const { data, error } = await supabase.storage
          .from(bucket)
          .download(filePath);

        if (error) {
          console.error('Supabase storage download error:', error);
          return null;
        }

        const arrayBuffer = await data.arrayBuffer();
        console.log('Successfully downloaded image, size:', arrayBuffer.byteLength);
        return new Uint8Array(arrayBuffer);
      }
    }

    // Regular URL download
    console.log('Downloading from URL:', url);
    const response = await fetch(url);
    if (!response.ok) {
      console.error('Image download failed:', response.status);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    console.log('Successfully downloaded image, size:', arrayBuffer.byteLength);
    return new Uint8Array(arrayBuffer);

  } catch (error) {
    console.error('Error downloading image:', error);
    return null;
  }
}

/**
 * Sign AWS request using Signature Version 4
 */
async function signAWSRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: string,
  region: string,
  service: string,
  accessKeyId: string,
  secretAccessKey: string
): Promise<Record<string, string>> {
  const encoder = new TextEncoder();

  // Helper to create HMAC
  async function hmac(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    return await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  }

  // Helper to hash
  async function hash(message: string): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(message));
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  const urlObj = new URL(url);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  // Create canonical request
  const canonicalUri = urlObj.pathname;
  const canonicalQuerystring = urlObj.search.slice(1);
  const payloadHash = await hash(body);

  const signedHeaders = Object.keys(headers)
    .map(k => k.toLowerCase())
    .sort()
    .join(';');

  const canonicalHeaders = Object.entries(headers)
    .map(([k, v]) => `${k.toLowerCase()}:${v.trim()}`)
    .sort()
    .join('\n') + '\n';

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuerystring,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');

  // Create string to sign
  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    await hash(canonicalRequest)
  ].join('\n');

  // Calculate signature
  const kDate = await hmac(encoder.encode('AWS4' + secretAccessKey), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, 'aws4_request');
  const signatureBuffer = await hmac(kSigning, stringToSign);
  const signature = Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // Build authorization header
  const authorization = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    ...headers,
    'x-amz-date': amzDate,
    'Authorization': authorization
  };
}

/**
 * Compare faces using AWS Rekognition
 */
async function compareFaces(
  sourceImage: Uint8Array,
  targetImage: Uint8Array
): Promise<{ similarity: number; confidence: number } | null> {
  const accessKeyId = Deno.env.get('AWS_ACCESS_KEY_ID');
  const secretAccessKey = Deno.env.get('AWS_SECRET_ACCESS_KEY');
  const region = Deno.env.get('AWS_REGION') || 'us-east-1';

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('AWS credentials not configured');
  }

  const endpoint = `https://rekognition.${region}.amazonaws.com`;
  const host = `rekognition.${region}.amazonaws.com`;

  // Prepare request body (use safe base64 encoding)
  const requestBody = JSON.stringify({
    SourceImage: {
      Bytes: uint8ArrayToBase64(sourceImage)
    },
    TargetImage: {
      Bytes: uint8ArrayToBase64(targetImage)
    },
    SimilarityThreshold: 0 // Get all results, we'll apply our own thresholds
  });

  // Prepare headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-amz-json-1.1',
    'X-Amz-Target': 'RekognitionService.CompareFaces',
    'Host': host
  };

  // Sign the request
  const signedHeaders = await signAWSRequest(
    'POST',
    endpoint,
    headers,
    requestBody,
    region,
    'rekognition',
    accessKeyId,
    secretAccessKey
  );

  // Make the request
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: signedHeaders,
    body: requestBody
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('AWS Rekognition error:', response.status, errorText);

    // Check for specific errors
    if (errorText.includes('InvalidParameterException')) {
      throw new Error('Invalid image format or no face detected in one of the images');
    }

    throw new Error(`AWS Rekognition error: ${response.status}`);
  }

  const data = await response.json();

  // Check if faces were matched
  if (data.FaceMatches && data.FaceMatches.length > 0) {
    const bestMatch = data.FaceMatches[0];
    return {
      similarity: bestMatch.Similarity || 0,
      confidence: bestMatch.Face?.Confidence || 0
    };
  }

  // No face matches found
  if (data.UnmatchedFaces && data.UnmatchedFaces.length > 0) {
    return {
      similarity: 0,
      confidence: data.UnmatchedFaces[0]?.Confidence || 0
    };
  }

  return null;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { documentImageUrl, selfieImageUrl } = await req.json() as FaceMatchRequest;

    if (!documentImageUrl || !selfieImageUrl) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Both documentImageUrl and selfieImageUrl are required'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client for storage access
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('Downloading document image for face matching...');
    const documentImage = await downloadImage(documentImageUrl, supabaseClient);

    if (!documentImage) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Failed to download document image',
          detail: 'Could not access the document image'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Downloading selfie image for face matching...');
    const selfieImage = await downloadImage(selfieImageUrl, supabaseClient);

    if (!selfieImage) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Failed to download selfie image',
          detail: 'Could not access the selfie image'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Comparing faces with AWS Rekognition...');
    const result = await compareFaces(documentImage, selfieImage);

    if (!result) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Face comparison failed',
          detail: 'No faces could be detected or compared'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { similarity, confidence } = result;

    // Determine match result
    const isMatch = similarity >= MATCH_THRESHOLD;
    const needsReview = !isMatch && similarity >= REVIEW_THRESHOLD;

    console.log('Face match result:', {
      similarity: similarity.toFixed(2),
      isMatch,
      needsReview,
      confidence: confidence.toFixed(2)
    });

    const response: FaceMatchResponse = {
      ok: true,
      similarity: Math.round(similarity * 100) / 100,
      isMatch,
      needsReview,
      confidence: Math.round(confidence * 100) / 100
    };

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Face match function error:', error);
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Face matching failed',
        detail: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
