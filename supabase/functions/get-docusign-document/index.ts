import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { create } from 'https://deno.land/x/djwt@v3.0.1/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper function to convert PKCS#1 to PKCS#8 format
function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  const version = new Uint8Array([0x02, 0x01, 0x00]);
  const algorithmOid = new Uint8Array([
    0x06, 0x09,
    0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01
  ]);
  const algorithmNull = new Uint8Array([0x05, 0x00]);
  const algorithmSequence = new Uint8Array([
    0x30, algorithmOid.length + algorithmNull.length,
    ...algorithmOid,
    ...algorithmNull
  ]);
  const privateKeyOctetString = new Uint8Array([
    0x04,
    ...encodeLengthBytes(pkcs1.length),
    ...pkcs1
  ]);
  const inner = new Uint8Array([
    ...version,
    ...algorithmSequence,
    ...privateKeyOctetString
  ]);
  return new Uint8Array([
    0x30,
    ...encodeLengthBytes(inner.length),
    ...inner
  ]);
}

function encodeLengthBytes(length: number): Uint8Array {
  if (length < 128) {
    return new Uint8Array([length]);
  }
  const bytes: number[] = [];
  let temp = length;
  while (temp > 0) {
    bytes.unshift(temp & 0xff);
    temp >>= 8;
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

// Get DocuSign JWT access token
async function getDocuSignAccessToken(
  integrationKey: string,
  userId: string,
  privateKey: string,
  baseUrl: string
): Promise<string | null> {
  try {
    const pemKey = privateKey
      .replace(/\\n/g, '\n')
      .replace(/-----BEGIN RSA PRIVATE KEY-----/, '')
      .replace(/-----END RSA PRIVATE KEY-----/, '')
      .trim();

    const pkcs1 = Uint8Array.from(atob(pemKey), c => c.charCodeAt(0));
    const pkcs8 = pkcs1ToPkcs8(pkcs1);

    const cryptoKey = await crypto.subtle.importKey(
      'pkcs8',
      pkcs8,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: integrationKey,
      sub: userId,
      aud: baseUrl.includes('demo') ? 'account-d.docusign.com' : 'account.docusign.com',
      iat: now,
      exp: now + 3600,
      scope: 'signature impersonation'
    };

    const jwt = await create(
      { alg: 'RS256', typ: 'JWT' },
      payload,
      cryptoKey
    );

    const authUrl = baseUrl.includes('demo')
      ? 'https://account-d.docusign.com/oauth/token'
      : 'https://account.docusign.com/oauth/token';

    const response = await fetch(authUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt
      })
    });

    if (!response.ok) {
      console.error('DocuSign auth error:', response.status);
      return null;
    }

    const data = await response.json();
    return data.access_token;

  } catch (error) {
    console.error('Error getting DocuSign access token:', error);
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { envelopeId, rentalId } = await req.json();

    if (!envelopeId && !rentalId) {
      return new Response(
        JSON.stringify({ ok: false, error: 'envelopeId or rentalId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    let actualEnvelopeId = envelopeId;

    // If rentalId provided, get envelope ID from rental
    if (rentalId && !envelopeId) {
      const { data: rental, error: rentalError } = await supabase
        .from('rentals')
        .select('docusign_envelope_id, document_status, signed_document_id')
        .eq('id', rentalId)
        .single();

      if (rentalError || !rental) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Rental not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // If signed document exists, return its URL
      if (rental.signed_document_id) {
        const { data: doc } = await supabase
          .from('customer_documents')
          .select('file_url')
          .eq('id', rental.signed_document_id)
          .single();

        if (doc?.file_url) {
          // Check if it's already a full URL
          if (doc.file_url.startsWith('http')) {
            return new Response(
              JSON.stringify({
                ok: true,
                documentUrl: doc.file_url,
                status: 'completed',
                source: 'stored'
              }),
              { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          // Get public URL from storage
          const { data: urlData } = supabase.storage
            .from('customer-documents')
            .getPublicUrl(doc.file_url);

          return new Response(
            JSON.stringify({
              ok: true,
              documentUrl: urlData.publicUrl,
              status: 'completed',
              source: 'stored'
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      if (!rental.docusign_envelope_id) {
        return new Response(
          JSON.stringify({ ok: false, error: 'No DocuSign envelope for this rental' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      actualEnvelopeId = rental.docusign_envelope_id;
    }

    // Get DocuSign credentials
    const DOCUSIGN_INTEGRATION_KEY = Deno.env.get('DOCUSIGN_INTEGRATION_KEY');
    const DOCUSIGN_USER_ID = Deno.env.get('DOCUSIGN_USER_ID');
    const DOCUSIGN_ACCOUNT_ID = Deno.env.get('DOCUSIGN_ACCOUNT_ID');
    const DOCUSIGN_PRIVATE_KEY = Deno.env.get('DOCUSIGN_PRIVATE_KEY');
    const DOCUSIGN_BASE_URL = Deno.env.get('DOCUSIGN_BASE_URL') || 'https://demo.docusign.net/restapi';

    if (!DOCUSIGN_INTEGRATION_KEY || !DOCUSIGN_USER_ID || !DOCUSIGN_PRIVATE_KEY || !DOCUSIGN_ACCOUNT_ID) {
      return new Response(
        JSON.stringify({ ok: false, error: 'DocuSign not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get access token
    const accessToken = await getDocuSignAccessToken(
      DOCUSIGN_INTEGRATION_KEY,
      DOCUSIGN_USER_ID,
      DOCUSIGN_PRIVATE_KEY,
      DOCUSIGN_BASE_URL
    );

    if (!accessToken) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Failed to authenticate with DocuSign' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get envelope status first
    const statusUrl = `${DOCUSIGN_BASE_URL}/v2.1/accounts/${DOCUSIGN_ACCOUNT_ID}/envelopes/${actualEnvelopeId}`;
    const statusResponse = await fetch(statusUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!statusResponse.ok) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Failed to get envelope status' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const envelopeData = await statusResponse.json();
    const envelopeStatus = envelopeData.status;

    // Download the combined document PDF
    const docUrl = `${DOCUSIGN_BASE_URL}/v2.1/accounts/${DOCUSIGN_ACCOUNT_ID}/envelopes/${actualEnvelopeId}/documents/combined`;
    const docResponse = await fetch(docUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!docResponse.ok) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Failed to get document from DocuSign' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get the PDF as base64
    const pdfBuffer = await docResponse.arrayBuffer();
    const pdfBase64 = btoa(String.fromCharCode(...new Uint8Array(pdfBuffer)));

    return new Response(
      JSON.stringify({
        ok: true,
        documentBase64: pdfBase64,
        contentType: 'application/pdf',
        status: envelopeStatus,
        source: 'docusign'
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ ok: false, error: 'Internal error', detail: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
