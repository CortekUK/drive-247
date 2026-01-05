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

// ============================================================================
// TEMPLATE PROCESSING FUNCTIONS
// ============================================================================

// Fetch active agreement template for tenant
async function getActiveTemplate(supabase: any, tenantId: string): Promise<string | null> {
  try {
    console.log('Fetching active template for tenant:', tenantId);

    const { data, error } = await supabase
      .from('agreement_templates')
      .select('template_content')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        console.log('No active template found, will use default');
        return null;
      }
      console.error('Error fetching template:', error);
      return null;
    }

    console.log('Found active template for tenant');
    return data?.template_content || null;
  } catch (error) {
    console.error('getActiveTemplate error:', error);
    return null;
  }
}

// Format date for display
function formatDate(date: string | Date | null): string {
  if (!date) return 'N/A';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// Format currency
function formatCurrency(amount: number | null): string {
  if (amount === null || amount === undefined) return '$0';
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
    // Customer variables
    customer_name: customer?.name || 'Customer',
    customer_email: customer?.email || '',
    customer_phone: customer?.phone || '',
    customer_address: customer?.address || '',
    customer_type: customer?.customer_type || customer?.type || 'Individual',

    // Vehicle variables
    vehicle_make: vehicle?.make || '',
    vehicle_model: vehicle?.model || '',
    vehicle_year: vehicle?.year?.toString() || '',
    vehicle_reg: vehicle?.reg || 'N/A',
    vehicle_color: vehicle?.color || '',

    // Rental variables
    rental_number: rental?.id?.substring(0, 8)?.toUpperCase() || 'N/A',
    rental_start_date: formatDate(rental?.start_date),
    rental_end_date: rental?.end_date ? formatDate(rental.end_date) : 'Ongoing',
    monthly_amount: formatCurrency(rental?.monthly_amount),
    rental_period_type: rental?.rental_period_type || 'Monthly',

    // Company/Tenant variables
    company_name: tenant?.company_name || 'Drive 247',
    company_email: tenant?.contact_email || '',
    company_phone: tenant?.contact_phone || '',

    // Agreement date
    agreement_date: formatDate(new Date()),
  };

  let result = template;

  // Replace all {{variable}} placeholders
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi');
    result = result.replace(placeholder, value);
  }

  return result;
}

// Convert HTML to plain text for DocuSign
function htmlToText(html: string): string {
  return html
    // Replace <br> tags with newlines
    .replace(/<br\s*\/?>/gi, '\n')
    // Replace closing block tags with newlines
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    // Replace <hr> with separator line
    .replace(/<hr\s*\/?>/gi, '\n' + '='.repeat(70) + '\n')
    // Handle table cells
    .replace(/<\/td>/gi, ' | ')
    .replace(/<\/th>/gi, ' | ')
    // Handle list items
    .replace(/<li>/gi, '• ')
    // Remove all remaining HTML tags
    .replace(/<[^>]+>/g, '')
    // Decode HTML entities
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&middot;/gi, '·')
    // Clean up excessive whitespace
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// Generate default template when no custom template exists
function generateDefaultTemplate(rental: any, customer: any, vehicle: any, tenant: any): string {
  const companyName = tenant?.company_name || 'Drive 247';

  return `
RENTAL AGREEMENT
${'='.repeat(70)}

Agreement Date: ${formatDate(new Date())}
Reference: ${rental?.id?.substring(0, 8)?.toUpperCase() || 'N/A'}

${'='.repeat(70)}

LANDLORD:
${companyName}
${tenant?.contact_email || ''}
${tenant?.contact_phone || ''}

${'='.repeat(70)}

CUSTOMER:
Name: ${customer?.name || 'Customer'}
Email: ${customer?.email || 'N/A'}
Phone: ${customer?.phone || ''}

${'='.repeat(70)}

VEHICLE DETAILS:
Registration: ${vehicle?.reg || 'N/A'}
Make & Model: ${vehicle?.make || ''} ${vehicle?.model || ''}
Year: ${vehicle?.year || ''}

${'='.repeat(70)}

RENTAL TERMS:
Start Date: ${formatDate(rental?.start_date)}
End Date: ${rental?.end_date ? formatDate(rental.end_date) : 'Ongoing'}
Amount: ${formatCurrency(rental?.monthly_amount)}
Period: ${rental?.rental_period_type || 'Monthly'}

${'='.repeat(70)}

TERMS AND CONDITIONS:
1. Customer agrees to rent the vehicle for the specified period.
2. Payment is due on the agreed schedule.
3. Customer will maintain the vehicle in good condition.
4. Customer is responsible for any damage during the rental period.
5. Vehicle must not be used for illegal purposes or sub-leased.

${'='.repeat(70)}

SIGNATURES:

Customer Signature: _________________________

Date: ______________


${companyName} Signature: _________________________

Date: ______________

${'='.repeat(70)}
${companyName} - Generated: ${new Date().toISOString()}
`;
}

// Generate document from template or use default
async function generateDocument(
  supabase: any,
  rental: any,
  customer: any,
  vehicle: any,
  tenantId: string
): Promise<string> {
  // Get tenant info
  const { data: tenant } = await supabase
    .from('tenants')
    .select('company_name, contact_email, contact_phone')
    .eq('id', tenantId)
    .single();

  // Try to get active template
  const template = await getActiveTemplate(supabase, tenantId);

  if (template) {
    console.log('Using custom template from portal');
    // Process template variables
    const processedContent = processTemplate(template, rental, customer, vehicle, tenant);
    // Convert HTML to plain text
    const plainText = htmlToText(processedContent);
    return btoa(plainText);
  }

  // Fallback to default template
  console.log('Using default template');
  const defaultText = generateDefaultTemplate(rental, customer, vehicle, tenant);
  return btoa(defaultText);
}

// ============================================================================
// JWT AND AUTHENTICATION FUNCTIONS
// ============================================================================

function base64url(data: string | Uint8Array): string {
  let base64: string;
  if (typeof data === 'string') {
    base64 = btoa(data);
  } else {
    base64 = btoa(String.fromCharCode(...data));
  }
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function parsePEM(pem: string): Uint8Array {
  const lines = pem
    .replace(/\\n/g, '\n')
    .split('\n')
    .filter(line => !line.includes('-----') && line.trim() !== '');
  const base64 = lines.join('');
  const binary = atob(base64);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function createJWT(
  integrationKey: string,
  userId: string,
  privateKeyPem: string,
  authServer: string
): Promise<string | null> {
  try {
    console.log('Creating JWT...');

    const header = { alg: 'RS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: integrationKey,
      sub: userId,
      iat: now,
      exp: now + 3600,
      aud: authServer,
      scope: 'signature impersonation'
    };

    const headerB64 = base64url(JSON.stringify(header));
    const payloadB64 = base64url(JSON.stringify(payload));
    const unsignedToken = `${headerB64}.${payloadB64}`;

    const keyData = parsePEM(privateKeyPem);
    let cryptoKey: CryptoKey;

    try {
      cryptoKey = await crypto.subtle.importKey(
        'pkcs8',
        keyData,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign']
      );
    } catch {
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
    }

    const encoder = new TextEncoder();
    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      encoder.encode(unsignedToken)
    );

    const jwt = `${unsignedToken}.${base64url(new Uint8Array(signature))}`;
    console.log('JWT created successfully');
    return jwt;

  } catch (error) {
    console.error('JWT creation failed:', error);
    return null;
  }
}

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
    if (!jwt) return null;

    const response = await fetch(`https://${authServer}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });

    const responseText = await response.text();
    if (!response.ok) {
      console.error('Token exchange failed:', responseText);
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

// ============================================================================
// DOCUSIGN ENVELOPE FUNCTIONS
// ============================================================================

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

    const envelope = {
      emailSubject: `Rental Agreement - Ref: ${rentalId.substring(0, 8).toUpperCase()}`,
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
            }],
            dateSignedTabs: [{
              anchorString: 'Date:',
              anchorUnits: 'pixels',
              anchorXOffset: '50',
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

    if (!response.ok) {
      console.error('Envelope creation failed:', responseText);
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

// ============================================================================
// MAIN HANDLER
// ============================================================================

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
    console.log('CREATE DOCUSIGN ENVELOPE (with Template Support)');
    console.log('='.repeat(60));
    console.log('Rental ID:', rentalId);

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

    if (!INTEGRATION_KEY || !USER_ID || !ACCOUNT_ID || !PRIVATE_KEY) {
      return new Response(
        JSON.stringify({ ok: false, error: 'DocuSign configuration missing' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch rental with customer and vehicle data
    const { data: rental, error: rentalError } = await supabase
      .from('rentals')
      .select(`
        *,
        customers:customer_id (id, name, email, phone, address, customer_type, type),
        vehicles:vehicle_id (id, reg, make, model, year, color)
      `)
      .eq('id', rentalId)
      .single();

    let customer: any;
    let vehicle: any;
    let tenantId: string | null = null;

    if (rentalError || !rental) {
      console.log('Rental not found, using provided customer data');
      // Use provided data as fallback
      customer = { name: customerName || 'Customer', email: customerEmail || 'N/A' };
      vehicle = { make: 'Vehicle', model: '', reg: 'N/A' };
    } else {
      customer = rental.customers || { name: customerName, email: customerEmail };
      vehicle = rental.vehicles || { make: 'Vehicle', model: '', reg: 'N/A' };
      tenantId = rental.tenant_id;
    }

    // Override with provided values if available
    const email = customerEmail || customer?.email || 'N/A';
    const name = customerName || customer?.name || 'Customer';

    console.log('Customer:', name, email);
    console.log('Vehicle:', vehicle?.make, vehicle?.model, vehicle?.reg);
    console.log('Tenant ID:', tenantId);

    // Generate document (uses admin template if available)
    let doc: string;
    if (tenantId) {
      doc = await generateDocument(supabase, rental, customer, vehicle, tenantId);
    } else {
      // No tenant, use basic default
      doc = btoa(generateDefaultTemplate(
        { id: rentalId, start_date: new Date(), monthly_amount: 0 },
        { name, email },
        vehicle,
        {}
      ));
    }

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
