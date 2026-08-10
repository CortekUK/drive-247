// @ts-nocheck - Deno Edge Function shared module, not Node.js TypeScript
//
// AWS Rekognition client for Deno edge functions.
//
// The SigV4 signing below is copied verbatim (structure and ordering) from
// `supabase/functions/ai-face-match/index.ts`, which has been signing
// RekognitionService.CompareFaces against production for a long time. Do not
// "improve" it — the canonical-request byte layout is what the signature is
// computed over, so a cosmetic change (header casing, sort order, trailing
// newline) silently produces InvalidSignatureException.
//
// Credentials come from Supabase secrets that already exist:
//   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION

/** A single WORD-level text detection with its bounding box. */
export interface DetectedWord {
  text: string;
  /** Rekognition confidence, 0-100. */
  confidence: number;
  /**
   * Ratios of the image dimensions (0-1), NOT pixels. Left/Top are the
   * top-left corner. This is Rekognition's native shape; callers that want
   * x/y/w/h should map it themselves so the raw AWS shape stays greppable.
   */
  box: { Left: number; Top: number; Width: number; Height: number };
}

export interface DetectTextResult {
  ok: boolean;
  words: DetectedWord[];
  error?: string;
}

/**
 * Rekognition's hard limit for an inline (non-S3) image is 5 MB of raw bytes.
 * Exported so callers can reject oversized images *before* base64-encoding
 * them and paying for a request that AWS will refuse anyway.
 */
export const REKOGNITION_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Convert Uint8Array to base64. Chunked because
 * `String.fromCharCode(...bytes)` blows the call stack on multi-MB images.
 * Same helper as ai-face-match; re-exported here so callers of detectText
 * don't have to reimplement it.
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

/**
 * Sign an AWS request using Signature Version 4.
 * Lifted from ai-face-match/index.ts — see the module header before editing.
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

  async function hash(message: string): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(message));
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
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
    .map((k) => k.toLowerCase())
    .sort()
    .join(';');

  const canonicalHeaders =
    Object.entries(headers)
      .map(([k, v]) => `${k.toLowerCase()}:${v.trim()}`)
      .sort()
      .join('\n') + '\n';

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuerystring,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  // Create string to sign
  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [algorithm, amzDate, credentialScope, await hash(canonicalRequest)].join('\n');

  // Calculate signature
  const kDate = await hmac(encoder.encode('AWS4' + secretAccessKey), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, 'aws4_request');
  const signatureBuffer = await hmac(kSigning, stringToSign);
  const signature = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const authorization =
    `${algorithm} Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    ...headers,
    'x-amz-date': amzDate,
    Authorization: authorization,
  };
}

/**
 * Run Rekognition DetectText over a base64-encoded JPEG or PNG.
 *
 * Returns WORD-level detections only. Rekognition also emits Type === 'LINE'
 * rows covering whole lines of text, but a LINE box is a union of its words
 * and is therefore far too greedy for a redaction mask — masking a LINE box
 * would black out everything on the same horizontal band as the plate.
 *
 * This never throws. Every failure path (missing creds, AWS 4xx/5xx, malformed
 * response) resolves to `{ ok: false, words: [], error }` so the caller can
 * degrade to "nothing found" instead of 500-ing a user-facing screen.
 */
export async function detectText(imageBase64: string): Promise<DetectTextResult> {
  const accessKeyId = Deno.env.get('AWS_ACCESS_KEY_ID');
  const secretAccessKey = Deno.env.get('AWS_SECRET_ACCESS_KEY');
  const region = Deno.env.get('AWS_REGION') || 'us-east-1';

  if (!accessKeyId || !secretAccessKey) {
    return {
      ok: false,
      words: [],
      error:
        'AWS credentials not configured — set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in Supabase secrets',
    };
  }

  if (!imageBase64) {
    return { ok: false, words: [], error: 'No image data supplied' };
  }

  const endpoint = `https://rekognition.${region}.amazonaws.com`;
  const host = `rekognition.${region}.amazonaws.com`;

  const requestBody = JSON.stringify({
    Image: { Bytes: imageBase64 },
    // No Filters block. WordFilter.MinConfidence would drop detections inside
    // AWS, but we want every word back so the caller can show `allWords` for
    // debugging ("why did it not find the plate?") and apply its own, stricter
    // thresholds per match type.
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-amz-json-1.1',
    'X-Amz-Target': 'RekognitionService.DetectText',
    Host: host,
  };

  try {
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

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: signedHeaders,
      body: requestBody,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AWS Rekognition DetectText error:', response.status, errorText);

      // Translate the AWS error codes an operator can actually act on.
      if (
        errorText.includes('InvalidClientTokenId') ||
        errorText.includes('InvalidSignatureException') ||
        errorText.includes('UnrecognizedClientException') ||
        errorText.includes('ExpiredTokenException')
      ) {
        return {
          ok: false,
          words: [],
          error:
            'AWS credentials are invalid or expired — update AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY in Supabase secrets',
        };
      }
      if (errorText.includes('AccessDeniedException')) {
        return {
          ok: false,
          words: [],
          error: 'AWS IAM user lacks rekognition:DetectText permission',
        };
      }
      if (errorText.includes('ImageTooLargeException')) {
        return { ok: false, words: [], error: 'Image is too large for Rekognition (5MB limit)' };
      }
      if (errorText.includes('InvalidImageFormatException')) {
        return { ok: false, words: [], error: 'Image format not supported — Rekognition accepts JPEG and PNG only' };
      }
      if (errorText.includes('ProvisionedThroughputExceededException') || response.status === 429) {
        return { ok: false, words: [], error: 'Rekognition rate limit hit — try again shortly' };
      }

      return {
        ok: false,
        words: [],
        error: `AWS Rekognition error ${response.status}: ${errorText.slice(0, 200)}`,
      };
    }

    const data = await response.json();
    const detections: any[] = Array.isArray(data?.TextDetections) ? data.TextDetections : [];

    const words: DetectedWord[] = detections
      .filter((d) => d?.Type === 'WORD' && d?.Geometry?.BoundingBox)
      .map((d) => {
        const bb = d.Geometry.BoundingBox;
        return {
          text: String(d.DetectedText ?? ''),
          confidence: typeof d.Confidence === 'number' ? d.Confidence : 0,
          box: {
            Left: Number(bb.Left ?? 0),
            Top: Number(bb.Top ?? 0),
            Width: Number(bb.Width ?? 0),
            Height: Number(bb.Height ?? 0),
          },
        };
      })
      // A word with no text is useless to both the matcher and the UI.
      .filter((w) => w.text.length > 0);

    return { ok: true, words };
  } catch (error) {
    console.error('AWS Rekognition DetectText threw:', error);
    return {
      ok: false,
      words: [],
      error: error instanceof Error ? error.message : 'Unknown Rekognition error',
    };
  }
}
