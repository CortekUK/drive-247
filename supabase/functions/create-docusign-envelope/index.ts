import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { create, getNumericDate } from 'https://deno.land/x/djwt@v3.0.1/mod.ts';
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CreateEnvelopeRequest {
  rentalId: string;
}

interface CreateEnvelopeResponse {
  ok: boolean;
  envelopeId?: string;
  embeddedSigningUrl?: string;
  error?: string;
  detail?: string;
}

// Generate rental agreement document content
function generateRentalAgreementPDF(rental: any, customer: any, vehicle: any): string {
  const agreementText = `
RENTAL AGREEMENT

Agreement Created: ${new Date().toLocaleDateString('en-US')}
Agreement Reference: ${rental.id}

===============================================================================

LANDLORD:
Vexa
[Company Address]
[Company Contact Details]

CUSTOMER:
Name: ${customer.name}
Email: ${customer.email}
Phone: ${customer.phone}
Type: ${customer.customer_type || customer.type}

===============================================================================

VEHICLE DETAILS:
License Plate Number: ${vehicle.reg}
Make: ${vehicle.make}
Model: ${vehicle.model}

===============================================================================

RENTAL TERMS:
Start Date: ${new Date(rental.start_date).toLocaleDateString('en-US')}
End Date: ${rental.end_date ? new Date(rental.end_date).toLocaleDateString('en-US') : 'Ongoing'}
Monthly Rental Amount: $${rental.monthly_amount.toLocaleString('en-US')}

===============================================================================

TERMS AND CONDITIONS:

1. The Customer agrees to rent the above-described vehicle from Vexa.
2. The Customer shall pay the specified monthly rental amount on time.
3. The Customer agrees to maintain the vehicle in good condition.
4. The Customer is responsible for any damage to the vehicle during the rental period.
5. This agreement is subject to the full terms and conditions of Vexa.

===============================================================================

SIGNATURES:

By signing below, both parties acknowledge and agree to all terms of this agreement.


Customer Signature: _________________________

Customer Date: ______________


Landlord Signature: _________________________

Landlord Date: ______________


===============================================================================

Vexa - Rental Agreement
Generated: ${new Date().toISOString()}
`;

  return btoa(agreementText);
}

// Helper function to convert PKCS#1 to PKCS#8 format
function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  // PKCS#8 structure for RSA private key
  const version = new Uint8Array([0x02, 0x01, 0x00]); // Version 0

  // AlgorithmIdentifier for RSA
  const algorithmOid = new Uint8Array([
    0x06, 0x09, // OID tag and length
    0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01 // RSA OID
  ]);
  const algorithmNull = new Uint8Array([0x05, 0x00]); // NULL parameter
  const algorithmSequence = new Uint8Array([
    0x30, algorithmOid.length + algorithmNull.length, // SEQUENCE tag and length
    ...algorithmOid,
    ...algorithmNull
  ]);

  // PrivateKey as OCTET STRING
  const privateKeyOctetString = new Uint8Array([
    0x04, // OCTET STRING tag
    ...encodeLengthBytes(pkcs1.length),
    ...pkcs1
  ]);

  // Combine into PrivateKeyInfo SEQUENCE
  const inner = new Uint8Array([
    ...version,
    ...algorithmSequence,
    ...privateKeyOctetString
  ]);

  return new Uint8Array([
    0x30, // SEQUENCE tag
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

// Helper function to import RSA private key for JWT signing
async function importPrivateKey(pemKey: string): Promise<CryptoKey> {
  // Remove PEM headers/footers and newlines
  const pemContents = pemKey
    .replace(/-----BEGIN RSA PRIVATE KEY-----/g, '')
    .replace(/-----END RSA PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');

  // Base64 decode
  const pkcs1 = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

  // Convert PKCS#1 to PKCS#8
  const pkcs8 = pkcs1ToPkcs8(pkcs1);

  // Import as CryptoKey
  return await crypto.subtle.importKey(
    'pkcs8',
    pkcs8,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    true,
    ['sign']
  );
}

// Get DocuSign JWT access token
async function getDocuSignAccessToken(
  integrationKey: string,
  userId: string,
  privateKey: string,
  baseUrl: string
): Promise<{ accessToken: string; expiresIn: number } | null> {
  try {
    console.log('Generating JWT for DocuSign authentication...');
    console.log('Integration Key:', integrationKey);
    console.log('User ID:', userId);
    console.log('Base URL:', baseUrl);

    // Prepare the private key
    const cleanKey = privateKey.replace(/\\n/g, '\n');
    console.log('Private key starts with:', cleanKey.substring(0, 50));

    // Import the private key as CryptoKey
    console.log('Importing private key...');
    const cryptoKey = await importPrivateKey(cleanKey);
    console.log('Private key imported successfully');

    // Create JWT payload
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: integrationKey,
      sub: userId,
      aud: baseUrl.includes('demo') ? 'account-d.docusign.com' : 'account.docusign.com',
      iat: now,
      exp: now + 3600,
      scope: 'signature impersonation'
    };

    console.log('JWT payload:', JSON.stringify(payload, null, 2));

    // Sign the JWT using djwt with the CryptoKey
    console.log('Signing JWT...');
    const jwt = await create(
      { alg: 'RS256', typ: 'JWT' },
      payload,
      cryptoKey
    );

    console.log('JWT generated successfully, length:', jwt.length);

    // Exchange JWT for access token
    const authUrl = baseUrl.includes('demo')
      ? 'https://account-d.docusign.com/oauth/token'
      : 'https://account.docusign.com/oauth/token';

    console.log('Exchanging JWT for access token at:', authUrl);

    const response = await fetch(authUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt
      })
    });

    const responseText = await response.text();
    console.log('Auth response status:', response.status);
    console.log('Auth response body:', responseText);

    if (!response.ok) {
      console.error('DocuSign auth failed:', response.status, responseText);
      return null;
    }

    const data = JSON.parse(responseText);
    console.log('Access token obtained successfully');

    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in
    };

  } catch (error) {
    console.error('Error getting DocuSign access token:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    return null;
  }
}

// Create and send DocuSign envelope
async function createAndSendEnvelope(
  accessToken: string,
  accountId: string,
  baseUrl: string,
  documentBase64: string,
  customer: any,
  rental: any,
  vehicle: any
): Promise<{ envelopeId: string } | null> {
  try {
    console.log('Creating DocuSign envelope...');

    const envelopeDefinition = {
      emailSubject: `Rental Agreement - ${vehicle.reg} - Please Sign`,
      documents: [
        {
          documentBase64: documentBase64,
          name: `Rental_Agreement_${vehicle.reg}_${rental.id.substring(0, 8)}.txt`,
          fileExtension: 'txt',
          documentId: '1'
        }
      ],
      recipients: {
        signers: [
          {
            email: customer.email,
            name: customer.name,
            recipientId: '1',
            routingOrder: '1',
            tabs: {
              signHereTabs: [
                {
                  anchorString: 'Customer Signature:',
                  anchorUnits: 'pixels',
                  anchorXOffset: '150',
                  anchorYOffset: '-5'
                }
              ],
              dateSignedTabs: [
                {
                  anchorString: 'Customer Date:',
                  anchorUnits: 'pixels',
                  anchorXOffset: '120',
                  anchorYOffset: '-5'
                }
              ]
            }
          }
        ]
      },
      status: 'sent'
    };

    const apiUrl = `${baseUrl}/v2.1/accounts/${accountId}/envelopes`;
    console.log('Sending envelope to DocuSign API:', apiUrl);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(envelopeDefinition)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('DocuSign envelope creation error:', response.status, errorText);
      return null;
    }

    const data = await response.json();
    console.log('Envelope created successfully:', data.envelopeId);

    return { envelopeId: data.envelopeId };

  } catch (error) {
    console.error('Error creating DocuSign envelope:', error);
    return null;
  }
}

async function createDocuSignEnvelope(supabase: any, rentalId: string): Promise<CreateEnvelopeResponse> {
  try {
    console.log('Creating DocuSign envelope for rental:', rentalId);

    // Get rental details with customer and vehicle info
    const { data: rental, error: rentalError } = await supabase
      .from('rentals')
      .select(`
        *,
        customers:customer_id (id, name, email, phone, customer_type, type),
        vehicles:vehicle_id (id, reg, make, model)
      `)
      .eq('id', rentalId)
      .single();

    if (rentalError || !rental) {
      return {
        ok: false,
        error: 'Rental not found',
        detail: rentalError?.message || 'Rental does not exist'
      };
    }

    const customer = rental.customers;
    const vehicle = rental.vehicles;

    if (!customer.email) {
      return {
        ok: false,
        error: 'Customer email required',
        detail: 'Customer must have an email address to receive DocuSign envelope'
      };
    }

    // Get DocuSign credentials from environment
    const DOCUSIGN_INTEGRATION_KEY = Deno.env.get('DOCUSIGN_INTEGRATION_KEY');
    const DOCUSIGN_USER_ID = Deno.env.get('DOCUSIGN_USER_ID');
    const DOCUSIGN_ACCOUNT_ID = Deno.env.get('DOCUSIGN_ACCOUNT_ID');
    const DOCUSIGN_PRIVATE_KEY = Deno.env.get('DOCUSIGN_PRIVATE_KEY');
    const DOCUSIGN_BASE_URL = Deno.env.get('DOCUSIGN_BASE_URL') || 'https://demo.docusign.net/restapi';

    console.log('Environment variables check:');
    console.log('DOCUSIGN_INTEGRATION_KEY:', DOCUSIGN_INTEGRATION_KEY ? 'SET ✓' : 'MISSING ✗', DOCUSIGN_INTEGRATION_KEY || 'EMPTY');
    console.log('DOCUSIGN_USER_ID:', DOCUSIGN_USER_ID ? 'SET ✓' : 'MISSING ✗', DOCUSIGN_USER_ID || 'EMPTY');
    console.log('DOCUSIGN_ACCOUNT_ID:', DOCUSIGN_ACCOUNT_ID ? 'SET ✓' : 'MISSING ✗', DOCUSIGN_ACCOUNT_ID || 'EMPTY');
    console.log('DOCUSIGN_PRIVATE_KEY:', DOCUSIGN_PRIVATE_KEY ? `SET ✓ (length: ${DOCUSIGN_PRIVATE_KEY.length})` : 'MISSING ✗');
    if (DOCUSIGN_PRIVATE_KEY) {
      console.log('DOCUSIGN_PRIVATE_KEY first 100 chars:', DOCUSIGN_PRIVATE_KEY.substring(0, 100));
    } else {
      console.log('DOCUSIGN_PRIVATE_KEY is:', typeof DOCUSIGN_PRIVATE_KEY, DOCUSIGN_PRIVATE_KEY);
    }
    console.log('DOCUSIGN_BASE_URL:', DOCUSIGN_BASE_URL);

    console.log('All Deno env keys:', Object.keys(Deno.env.toObject()).filter(k => k.startsWith('DOCUSIGN')));

    if (!DOCUSIGN_INTEGRATION_KEY || !DOCUSIGN_USER_ID || !DOCUSIGN_ACCOUNT_ID || !DOCUSIGN_PRIVATE_KEY) {
      const missingVars = [];
      if (!DOCUSIGN_INTEGRATION_KEY) missingVars.push('DOCUSIGN_INTEGRATION_KEY');
      if (!DOCUSIGN_USER_ID) missingVars.push('DOCUSIGN_USER_ID');
      if (!DOCUSIGN_ACCOUNT_ID) missingVars.push('DOCUSIGN_ACCOUNT_ID');
      if (!DOCUSIGN_PRIVATE_KEY) missingVars.push('DOCUSIGN_PRIVATE_KEY');

      return {
        ok: false,
        error: 'DocuSign configuration missing',
        detail: `Missing environment variables: ${missingVars.join(', ')}`
      };
    }

    // Generate the rental agreement document
    const documentBase64 = generateRentalAgreementPDF(rental, customer, vehicle);

    // Get JWT access token
    const authResult = await getDocuSignAccessToken(
      DOCUSIGN_INTEGRATION_KEY,
      DOCUSIGN_USER_ID,
      DOCUSIGN_PRIVATE_KEY,
      DOCUSIGN_BASE_URL
    );

    if (!authResult) {
      return {
        ok: false,
        error: 'Authentication failed',
        detail: 'Failed to obtain DocuSign access token. Please check credentials and ensure JWT consent is granted.'
      };
    }

    // Create and send envelope
    const envelopeResult = await createAndSendEnvelope(
      authResult.accessToken,
      DOCUSIGN_ACCOUNT_ID,
      DOCUSIGN_BASE_URL,
      documentBase64,
      customer,
      rental,
      vehicle
    );

    if (!envelopeResult) {
      return {
        ok: false,
        error: 'Envelope creation failed',
        detail: 'Failed to create DocuSign envelope. Check logs for details.'
      };
    }

    // Update rental record with envelope info
    const { error: updateError } = await supabase
      .from('rentals')
      .update({
        docusign_envelope_id: envelopeResult.envelopeId,
        document_status: 'sent',
        envelope_created_at: new Date().toISOString(),
        envelope_sent_at: new Date().toISOString()
      })
      .eq('id', rentalId);

    if (updateError) {
      console.error('Error updating rental with envelope ID:', updateError);
      return {
        ok: false,
        error: 'Failed to update rental',
        detail: updateError.message
      };
    }

    console.log('Envelope created and sent successfully:', envelopeResult.envelopeId);

    return {
      ok: true,
      envelopeId: envelopeResult.envelopeId
    };

  } catch (error) {
    console.error('Error creating DocuSign envelope:', error);
    return {
      ok: false,
      error: 'Envelope creation failed',
      detail: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { rentalId } = await req.json() as CreateEnvelopeRequest;

    if (!rentalId) {
      return new Response(
        JSON.stringify({ ok: false, error: 'rentalId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const result = await createDocuSignEnvelope(supabaseClient, rentalId);

    return new Response(
      JSON.stringify(result),
      {
        status: result.ok ? 200 : 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Function error:', error);
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
