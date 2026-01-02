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

// Generate rental agreement document content (fallback/default)
function generateRentalAgreementPDF(rental: any, customer: any, vehicle: any, tenant?: any): string {
  const companyName = tenant?.company_name || 'Vexa';
  const companyEmail = tenant?.contact_email || '[Company Email]';
  const companyPhone = tenant?.contact_phone || '[Company Phone]';

  const agreementText = `
RENTAL AGREEMENT

Agreement Created: ${new Date().toLocaleDateString('en-US')}
Agreement Reference: ${rental.id}

===============================================================================

LANDLORD:
${companyName}
Email: ${companyEmail}
Phone: ${companyPhone}

CUSTOMER:
Name: ${customer.name}
Email: ${customer.email}
Phone: ${customer.phone}
Type: ${customer.customer_type || 'Individual'}

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

1. The Customer agrees to rent the above-described vehicle from ${companyName}.
2. The Customer shall pay the specified monthly rental amount on time.
3. The Customer agrees to maintain the vehicle in good condition.
4. The Customer is responsible for any damage to the vehicle during the rental period.
5. This agreement is subject to the full terms and conditions of ${companyName}.

===============================================================================

SIGNATURES:

By signing below, both parties acknowledge and agree to all terms of this agreement.


Customer Signature: _________________________

Customer Date: ______________


Landlord Signature: _________________________

Landlord Date: ______________


===============================================================================

${companyName} - Rental Agreement
Generated: ${new Date().toISOString()}
`;

  return btoa(agreementText);
}

// Fetch active agreement template for a tenant
async function getActiveAgreementTemplate(supabase: any, tenantId: string): Promise<string | null> {
  try {
    console.log('Fetching active agreement template for tenant:', tenantId);

    const { data, error } = await supabase
      .from('agreement_templates')
      .select('template_content')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .single();

    if (error) {
      // No active template found is not an error
      if (error.code === 'PGRST116') {
        console.log('No active template found for tenant, will use default');
        return null;
      }
      console.error('Error fetching agreement template:', error);
      return null;
    }

    console.log('Found active template for tenant');
    return data?.template_content || null;
  } catch (error) {
    console.error('Error in getActiveAgreementTemplate:', error);
    return null;
  }
}

// Format date for template
function formatDateForTemplate(date: string | Date | null): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// Format currency for template
function formatCurrencyForTemplate(amount: number | null): string {
  if (amount === null || amount === undefined) return '';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

// Process template by replacing variables with actual data
function processTemplate(
  template: string,
  rental: any,
  customer: any,
  vehicle: any,
  tenant: any
): string {
  const variables: Record<string, string> = {
    // Customer
    customer_name: customer.name || '',
    customer_email: customer.email || '',
    customer_phone: customer.phone || '',
    customer_address: customer.address || '',
    customer_type: customer.customer_type || customer.type || 'Individual',

    // Vehicle
    vehicle_make: vehicle.make || '',
    vehicle_model: vehicle.model || '',
    vehicle_year: vehicle.year?.toString() || '',
    vehicle_reg: vehicle.reg || '',
    vehicle_color: vehicle.color || '',
    vehicle_vin: vehicle.vin || '',

    // Rental
    rental_number: rental.rental_number || rental.id.substring(0, 8).toUpperCase(),
    rental_start_date: formatDateForTemplate(rental.start_date),
    rental_end_date: rental.end_date ? formatDateForTemplate(rental.end_date) : 'Ongoing',
    monthly_amount: formatCurrencyForTemplate(rental.monthly_amount),
    rental_period_type: rental.rental_period_type || 'Monthly',

    // Company
    company_name: tenant?.company_name || '',
    company_email: tenant?.contact_email || '',
    company_phone: tenant?.contact_phone || '',

    // Agreement
    agreement_date: formatDateForTemplate(new Date()),
  };

  let result = template;

  // Replace all variables
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`;
    result = result.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
  }

  return result;
}

// Convert HTML to plain text for DocuSign
function htmlToPlainText(html: string): string {
  return html
    // Replace <br> and <br/> with newlines
    .replace(/<br\s*\/?>/gi, '\n')
    // Replace closing block tags with newlines
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    // Replace <hr> with separator
    .replace(/<hr\s*\/?>/gi, '\n===============================================================================\n')
    // Handle table cells
    .replace(/<\/td>/gi, ' | ')
    .replace(/<\/th>/gi, ' | ')
    .replace(/<tr>/gi, '')
    // Handle list items
    .replace(/<li>/gi, '- ')
    // Remove remaining HTML tags
    .replace(/<[^>]+>/g, '')
    // Decode HTML entities
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&middot;/gi, '·')
    // Clean up extra whitespace
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// Generate document from template or use default
async function generateDocument(
  supabase: any,
  rental: any,
  customer: any,
  vehicle: any,
  tenantId: string
): Promise<string> {
  // Try to get tenant-specific template
  const template = await getActiveAgreementTemplate(supabase, tenantId);

  if (template) {
    // Get tenant info for company variables
    const { data: tenant } = await supabase
      .from('tenants')
      .select('company_name, contact_email, contact_phone')
      .eq('id', tenantId)
      .single();

    console.log('Using custom template for tenant');
    const processedContent = processTemplate(template, rental, customer, vehicle, tenant);
    const plainText = htmlToPlainText(processedContent);
    return btoa(plainText);
  }

  // Fallback to default template
  console.log('Using default template');

  // Get tenant info for default template too
  const { data: tenant } = await supabase
    .from('tenants')
    .select('company_name, contact_email, contact_phone')
    .eq('id', tenantId)
    .single();

  return generateRentalAgreementPDF(rental, customer, vehicle, tenant);
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
  // Handle both PKCS#1 and PKCS#8 format keys
  const isPkcs8 = pemKey.includes('-----BEGIN PRIVATE KEY-----');
  const isPkcs1 = pemKey.includes('-----BEGIN RSA PRIVATE KEY-----');

  if (!isPkcs1 && !isPkcs8) {
    throw new Error('Invalid private key format. Expected PEM format with BEGIN PRIVATE KEY or BEGIN RSA PRIVATE KEY header');
  }

  // Remove PEM headers/footers and whitespace
  const pemContents = pemKey
    .replace(/-----BEGIN (RSA )?PRIVATE KEY-----/g, '')
    .replace(/-----END (RSA )?PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');

  // Base64 decode
  let keyData: Uint8Array;
  try {
    keyData = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  } catch (e) {
    throw new Error(`Failed to decode base64 private key: ${e.message}`);
  }

  // If PKCS#1 format, convert to PKCS#8
  if (isPkcs1) {
    keyData = pkcs1ToPkcs8(keyData);
  }

  // Import as CryptoKey
  try {
    return await crypto.subtle.importKey(
      'pkcs8',
      keyData,
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: 'SHA-256',
      },
      true,
      ['sign']
    );
  } catch (e) {
    throw new Error(`Failed to import private key: ${e.message}. Make sure the key is valid RSA private key.`);
  }
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
      // Parse error for better debugging
      try {
        const errorData = JSON.parse(responseText);
        if (errorData.error === 'consent_required') {
          console.error('JWT consent required. User must grant consent first.');
        } else if (errorData.error === 'invalid_grant') {
          console.error('Invalid grant - check integration key, user ID, and private key.');
        }
      } catch (e) {
        // Not JSON, just log the raw response
      }
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
        customers:customer_id (id, name, email, phone, address, customer_type, type),
        vehicles:vehicle_id (id, reg, make, model, year, color, vin)
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

    // Generate the rental agreement document (uses tenant template if available)
    const documentBase64 = await generateDocument(supabase, rental, customer, vehicle, rental.tenant_id);

    // Get JWT access token
    const authResult = await getDocuSignAccessToken(
      DOCUSIGN_INTEGRATION_KEY,
      DOCUSIGN_USER_ID,
      DOCUSIGN_PRIVATE_KEY,
      DOCUSIGN_BASE_URL
    );

    if (!authResult) {
      // Generate consent URL for debugging
      const isDemo = DOCUSIGN_BASE_URL.includes('demo');
      const consentUrl = isDemo
        ? `https://account-d.docusign.com/oauth/auth?response_type=code&scope=signature%20impersonation&client_id=${DOCUSIGN_INTEGRATION_KEY}&redirect_uri=https://developers.docusign.com/platform/auth/consent`
        : `https://account.docusign.com/oauth/auth?response_type=code&scope=signature%20impersonation&client_id=${DOCUSIGN_INTEGRATION_KEY}&redirect_uri=https://developers.docusign.com/platform/auth/consent`;

      return {
        ok: false,
        error: 'Authentication failed',
        detail: `Failed to obtain DocuSign access token. If using JWT authentication, ensure consent is granted. Visit: ${consentUrl}`
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
