import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CreateEnvelopeRequest {
  rentalId: string;
  customerEmail?: string;
  customerName?: string;
}

interface CreateEnvelopeResponse {
  ok: boolean;
  envelopeId?: string;
  emailSent?: boolean;
  error?: string;
  detail?: string;
}

function generateRentalAgreementPDF(rental: any, customer: any, vehicle: any): string {
  const agreementText = `
RENTAL AGREEMENT

Agreement Created: ${new Date().toLocaleDateString('en-US')}
Agreement Reference: ${rental?.id || 'N/A'}

CUSTOMER:
Name: ${customer?.name || 'Customer'}
Email: ${customer?.email || 'N/A'}

VEHICLE:
${vehicle?.make || ''} ${vehicle?.model || ''} - ${vehicle?.reg || 'N/A'}

RENTAL TERMS:
Start Date: ${rental?.start_date ? new Date(rental.start_date).toLocaleDateString('en-US') : 'N/A'}
End Date: ${rental?.end_date ? new Date(rental.end_date).toLocaleDateString('en-US') : 'Ongoing'}
Amount: $${(rental?.monthly_amount || 0).toLocaleString('en-US')}

AGREEMENT:
By signing, Customer agrees to all terms.

Customer Signature: _________________________
Date: ______________

Drive 247 - Generated: ${new Date().toISOString()}
`;
  return btoa(agreementText);
}

// Base64URL encoding
function base64url(data: string | Uint8Array): string {
  let base64: string;
  if (typeof data === 'string') {
    base64 = btoa(data);
  } else {
    base64 = btoa(String.fromCharCode(...data));
  }
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Parse PEM private key
function parsePEM(pem: string): Uint8Array {
  const lines = pem
    .replace(/\\n/g, '\n')
    .split('\n')
    .filter(line => !line.includes('-----') && line.trim() !== '');
  const base64 = lines.join('');
  const binary = atob(base64);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

// Create JWT using Web Crypto API
async function createJWT(
  integrationKey: string,
  userId: string,
  privateKeyPem: string,
  authServer: string
): Promise<string | null> {
  try {
    console.log('Creating JWT...');
    console.log('Integration Key:', integrationKey);
    console.log('User ID:', userId);
    console.log('Auth Server:', authServer);
    console.log('Private Key length:', privateKeyPem.length);

    // Header
    const header = { alg: 'RS256', typ: 'JWT' };

    // Payload
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: integrationKey,
      sub: userId,
      iat: now,
      exp: now + 3600,
      aud: authServer,
      scope: 'signature impersonation'
    };

    console.log('JWT Payload:', JSON.stringify(payload));

    // Encode header and payload
    const headerB64 = base64url(JSON.stringify(header));
    const payloadB64 = base64url(JSON.stringify(payload));
    const unsignedToken = `${headerB64}.${payloadB64}`;

    // Parse and import private key
    const keyData = parsePEM(privateKeyPem);
    console.log('Key data length:', keyData.length);

    // Try importing as PKCS#8 first, then wrap if needed
    let cryptoKey: CryptoKey;

    try {
      // First try PKCS#8 format
      cryptoKey = await crypto.subtle.importKey(
        'pkcs8',
        keyData,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign']
      );
      console.log('Key imported as PKCS#8');
    } catch {
      console.log('PKCS#8 failed, trying to wrap PKCS#1...');

      // Wrap PKCS#1 in PKCS#8
      const pkcs8 = new Uint8Array(keyData.length + 26);
      pkcs8.set([0x30, 0x82, (keyData.length + 22) >> 8, (keyData.length + 22) & 0xff]);
      pkcs8.set([0x02, 0x01, 0x00], 4);
      pkcs8.set([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00], 7);
      pkcs8.set([0x04, 0x82, keyData.length >> 8, keyData.length & 0xff], 22);
      pkcs8.set(keyData, 26);

      cryptoKey = await crypto.subtle.importKey(
        'pkcs8',
        pkcs8,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign']
      );
      console.log('Key imported with PKCS#1 wrapper');
    }

    // Sign
    const encoder = new TextEncoder();
    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      encoder.encode(unsignedToken)
    );

    const signatureB64 = base64url(new Uint8Array(signature));
    const jwt = `${unsignedToken}.${signatureB64}`;

    console.log('JWT created successfully, length:', jwt.length);
    return jwt;

  } catch (error) {
    console.error('JWT creation failed:', error);
    return null;
  }
}

// Get access token from DocuSign
async function getAccessToken(
  integrationKey: string,
  userId: string,
  privateKey: string,
  baseUrl: string
): Promise<string | null> {
  try {
    const isDemo = baseUrl.includes('demo');
    const authServer = isDemo ? 'account-d.docusign.com' : 'account.docusign.com';

    const jwt = await createJWT(integrationKey, userId, privateKey, authServer);
    if (!jwt) {
      console.error('Failed to create JWT');
      return null;
    }

    console.log('Exchanging JWT for access token...');
    const response = await fetch(`https://${authServer}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });

    const responseText = await response.text();
    console.log('Token response status:', response.status);
    console.log('Token response:', responseText.substring(0, 200));

    if (!response.ok) {
      console.error('Token exchange failed');
      return null;
    }

    const data = JSON.parse(responseText);
    console.log('Access token obtained!');
    return data.access_token;

  } catch (error) {
    console.error('getAccessToken error:', error);
    return null;
  }
}

// Send envelope via email
async function sendEnvelope(
  accessToken: string,
  accountId: string,
  baseUrl: string,
  documentBase64: string,
  customerEmail: string,
  customerName: string,
  rentalId: string
): Promise<{ envelopeId: string } | null> {
  try {
    console.log('Creating DocuSign envelope...');
    console.log('Account ID:', accountId);
    console.log('Customer:', customerName, customerEmail);

    const envelope = {
      emailSubject: `Rental Agreement - Ref: ${rentalId.substring(0, 8)}`,
      documents: [{
        documentBase64,
        name: 'Rental Agreement.txt',
        fileExtension: 'txt',
        documentId: '1'
      }],
      recipients: {
        signers: [{
          email: customerEmail,
          name: customerName,
          recipientId: '1',
          routingOrder: '1',
          tabs: {
            signHereTabs: [{
              anchorString: 'Customer Signature:',
              anchorUnits: 'pixels',
              anchorXOffset: '200',
              anchorYOffset: '-10'
            }]
          }
        }]
      },
      status: 'sent'
    };

    const response = await fetch(
      `${baseUrl}/v2.1/accounts/${accountId}/envelopes`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(envelope)
      }
    );

    const responseText = await response.text();
    console.log('Envelope response status:', response.status);
    console.log('Envelope response:', responseText.substring(0, 300));

    if (!response.ok) {
      console.error('Envelope creation failed');
      return null;
    }

    const result = JSON.parse(responseText);
    console.log('Envelope created! ID:', result.envelopeId);
    return { envelopeId: result.envelopeId };

  } catch (error) {
    console.error('sendEnvelope error:', error);
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { rentalId, customerEmail, customerName } = await req.json();

    console.log('='.repeat(60));
    console.log('CREATE DOCUSIGN ENVELOPE');
    console.log('='.repeat(60));
    console.log('Rental ID:', rentalId);
    console.log('Customer Email:', customerEmail);
    console.log('Customer Name:', customerName);

    if (!rentalId) {
      return new Response(
        JSON.stringify({ ok: false, error: 'rentalId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get credentials
    const INTEGRATION_KEY = Deno.env.get('DOCUSIGN_INTEGRATION_KEY');
    const USER_ID = Deno.env.get('DOCUSIGN_USER_ID');
    const ACCOUNT_ID = Deno.env.get('DOCUSIGN_ACCOUNT_ID');
    const PRIVATE_KEY = Deno.env.get('DOCUSIGN_PRIVATE_KEY');
    const BASE_URL = Deno.env.get('DOCUSIGN_BASE_URL') || 'https://demo.docusign.net/restapi';

    console.log('Integration Key:', INTEGRATION_KEY ? '✓' : '✗');
    console.log('User ID:', USER_ID ? '✓' : '✗');
    console.log('Account ID:', ACCOUNT_ID ? '✓' : '✗');
    console.log('Private Key:', PRIVATE_KEY ? `✓ (${PRIVATE_KEY.length} chars)` : '✗');
    console.log('Base URL:', BASE_URL);

    if (!INTEGRATION_KEY || !USER_ID || !ACCOUNT_ID || !PRIVATE_KEY) {
      return new Response(
        JSON.stringify({ ok: false, error: 'DocuSign configuration missing' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use provided customer data or defaults
    const email = customerEmail || 'test@example.com';
    const name = customerName || 'Customer';

    // Generate document
    const doc = generateRentalAgreementPDF(
      { id: rentalId, start_date: new Date(), monthly_amount: 0 },
      { name, email },
      { make: 'Vehicle', model: '', reg: 'N/A' }
    );

    // Get access token
    const accessToken = await getAccessToken(INTEGRATION_KEY, USER_ID, PRIVATE_KEY, BASE_URL);

    if (!accessToken) {
      const consentUrl = `https://account-d.docusign.com/oauth/auth?response_type=code&scope=signature%20impersonation&client_id=${INTEGRATION_KEY}&redirect_uri=https://developers.docusign.com/platform/auth/consent`;
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'DocuSign authentication failed',
          detail: `JWT consent may not be granted. Visit: ${consentUrl}`
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Send envelope
    const result = await sendEnvelope(accessToken, ACCOUNT_ID, BASE_URL, doc, email, name, rentalId);

    if (!result) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Failed to create envelope' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('='.repeat(60));
    console.log('SUCCESS! Envelope ID:', result.envelopeId);
    console.log('='.repeat(60));

    return new Response(
      JSON.stringify({ ok: true, envelopeId: result.envelopeId, emailSent: true }),
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
