/**
 * AWS Configuration for SES and SNS
 * Shared utilities for email and SMS services
 */

// CORS headers for edge function responses
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// AWS Configuration
export const AWS_CONFIG = {
  region: Deno.env.get('AWS_REGION') || 'us-east-1',
  accessKeyId: Deno.env.get('AWS_ACCESS_KEY_ID') || '',
  secretAccessKey: Deno.env.get('AWS_SECRET_ACCESS_KEY') || '',
};

// Email Configuration
// Note: In sandbox mode, we can only send FROM verified identities
// The domain drive-247.com is verified in account 464115713515
export const EMAIL_CONFIG = {
  fromEmail: Deno.env.get('SES_FROM_EMAIL') || 'noreply@drive-247.com',
  adminEmail: Deno.env.get('ADMIN_EMAIL') || 'corteksystemsltd@gmail.com',
  adminPhone: Deno.env.get('ADMIN_PHONE') || '',
  // Support email for customer replies
  supportEmail: 'support@drive-247.com',
};

/**
 * Create AWS4 Signature for API requests
 * This is required for signing AWS API requests
 */
async function hmacSha256(key: Uint8Array, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    new TextEncoder().encode(message)
  );
  return new Uint8Array(signature);
}

async function sha256(message: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getSignatureKey(
  key: string,
  dateStamp: string,
  regionName: string,
  serviceName: string
): Promise<Uint8Array> {
  const kDate = await hmacSha256(new TextEncoder().encode('AWS4' + key), dateStamp);
  const kRegion = await hmacSha256(kDate, regionName);
  const kService = await hmacSha256(kRegion, serviceName);
  const kSigning = await hmacSha256(kService, 'aws4_request');
  return kSigning;
}

export interface AWSRequestParams {
  service: 'ses' | 'sns';
  method: 'POST' | 'GET';
  body: string;
  headers?: Record<string, string>;
}

/**
 * Sign and send AWS API request
 */
export async function signedAWSRequest(params: AWSRequestParams): Promise<Response> {
  const { service, method, body, headers: extraHeaders = {} } = params;

  // Use email endpoint for SES (better DNS resolution in edge functions)
  const host = service === 'ses'
    ? `email.${AWS_CONFIG.region}.amazonaws.com`
    : `sns.${AWS_CONFIG.region}.amazonaws.com`;
  const endpoint = `https://${host}/`;

  // Service name for signing (SES uses 'ses' not 'email')
  const signingService = service === 'ses' ? 'ses' : 'sns';

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const canonicalUri = '/';
  const canonicalQueryString = '';

  const payloadHash = await sha256(body);

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Host': host,
    'X-Amz-Date': amzDate,
    ...extraHeaders
  };

  // Create canonical headers
  const signedHeadersList = Object.keys(headers)
    .map(k => k.toLowerCase())
    .sort();
  const signedHeaders = signedHeadersList.join(';');

  const canonicalHeaders = signedHeadersList
    .map(k => `${k}:${headers[Object.keys(headers).find(h => h.toLowerCase() === k) || k].trim()}`)
    .join('\n') + '\n';

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');

  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${AWS_CONFIG.region}/${signingService}/aws4_request`;
  const canonicalRequestHash = await sha256(canonicalRequest);

  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    canonicalRequestHash
  ].join('\n');

  const signingKey = await getSignatureKey(
    AWS_CONFIG.secretAccessKey,
    dateStamp,
    AWS_CONFIG.region,
    signingService
  );

  const signature = toHex(await hmacSha256(signingKey, stringToSign));

  const authorizationHeader = `${algorithm} Credential=${AWS_CONFIG.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(endpoint, {
    method,
    headers: {
      ...headers,
      'Authorization': authorizationHeader,
    },
    body,
  });

  return response;
}

/**
 * Parse AWS XML response
 */
export function parseXMLValue(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}>([^<]*)</${tag}>`);
  const match = xml.match(regex);
  return match ? match[1] : null;
}

/**
 * Check if AWS is configured
 */
export function isAWSConfigured(): boolean {
  return !!(AWS_CONFIG.accessKeyId && AWS_CONFIG.secretAccessKey);
}
