import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { formatCurrency as sharedFormatCurrency } from '../_shared/format-utils.ts';

interface CreateDocumentRequest {
  rentalId: string;
  customerEmail?: string;
  customerName?: string;
}

// ============================================================================
// TEMPLATE PROCESSING FUNCTIONS
// ============================================================================

async function getActiveTemplate(supabase: ReturnType<typeof createClient>, tenantId: string): Promise<string | null> {
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

function formatDate(date: string | Date | null): string {
  if (!date) return 'N/A';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

let _currencyCode = 'GBP';
function formatCurrency(amount: number | null): string {
  if (amount === null || amount === undefined) return sharedFormatCurrency(0, _currencyCode);
  return sharedFormatCurrency(amount, _currencyCode);
}

function processTemplate(
  template: string,
  rental: Record<string, unknown>,
  customer: Record<string, unknown>,
  vehicle: Record<string, unknown>,
  tenant: Record<string, unknown>
): string {
  const variables: Record<string, string> = {
    customer_name: (customer?.name as string) || 'Customer',
    customer_email: (customer?.email as string) || '',
    customer_phone: (customer?.phone as string) || '',
    customer_address: (customer?.address as string) || '',
    customer_type: (customer?.customer_type as string) || (customer?.type as string) || 'Individual',

    vehicle_make: (vehicle?.make as string) || '',
    vehicle_model: (vehicle?.model as string) || '',
    vehicle_year: vehicle?.year?.toString() || '',
    vehicle_reg: (vehicle?.reg as string) || 'N/A',
    vehicle_color: (vehicle?.color as string) || '',

    rental_number: (rental?.id as string)?.substring(0, 8)?.toUpperCase() || 'N/A',
    rental_start_date: formatDate(rental?.start_date as string),
    rental_end_date: rental?.end_date ? formatDate(rental.end_date as string) : 'Ongoing',
    monthly_amount: formatCurrency(rental?.monthly_amount as number),
    rental_period_type: (rental?.rental_period_type as string) || 'Monthly',

    company_name: (tenant?.company_name as string) || 'Drive 247',
    company_email: (tenant?.contact_email as string) || '',
    company_phone: (tenant?.contact_phone as string) || '',

    agreement_date: formatDate(new Date()),
  };

  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi');
    result = result.replace(placeholder, value);
  }

  return result;
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n' + '='.repeat(70) + '\n')
    .replace(/<\/td>/gi, ' | ')
    .replace(/<\/th>/gi, ' | ')
    .replace(/<li>/gi, '\u2022 ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&middot;/gi, '\u00b7')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function generateDefaultTemplate(
  rental: Record<string, unknown>,
  customer: Record<string, unknown>,
  vehicle: Record<string, unknown>,
  tenant: Record<string, unknown> | null
): string {
  return `${'='.repeat(70)}
                         RENTAL AGREEMENT
${'='.repeat(70)}

Agreement Date: ${formatDate(new Date())}
Rental Reference: ${(rental?.id as string)?.substring(0, 8)?.toUpperCase() || 'N/A'}

${'─'.repeat(70)}
VEHICLE DETAILS
${'─'.repeat(70)}
Make:          ${(vehicle?.make as string) || 'N/A'}
Model:         ${(vehicle?.model as string) || 'N/A'}
Year:          ${vehicle?.year || 'N/A'}
Registration:  ${(vehicle?.reg as string) || 'N/A'}
Color:         ${(vehicle?.color as string) || 'N/A'}

${'─'.repeat(70)}
CUSTOMER DETAILS
${'─'.repeat(70)}
Name:          ${(customer?.name as string) || 'N/A'}
Email:         ${(customer?.email as string) || 'N/A'}
Phone:         ${(customer?.phone as string) || 'N/A'}
Address:       ${(customer?.address as string) || 'N/A'}

${'─'.repeat(70)}
RENTAL PERIOD
${'─'.repeat(70)}
Start Date:    ${formatDate(rental?.start_date as string)}
End Date:      ${rental?.end_date ? formatDate(rental.end_date as string) : 'Ongoing'}
Payment:       ${formatCurrency(rental?.monthly_amount as number)} (${(rental?.rental_period_type as string) || 'Monthly'})

${'='.repeat(70)}
                      TERMS & CONDITIONS
${'='.repeat(70)}

The Customer agrees to rent the vehicle described above for the specified rental period and confirms that all information provided is accurate and complete.

Payment is due in accordance with the agreed schedule. Late payments, failed authorizations, or chargebacks may result in additional charges or immediate termination of the rental.

The vehicle is provided in safe, operable condition. The Customer agrees to return the vehicle on time, in substantially the same condition as received, reasonable wear and tear excepted.

BY SIGNING BELOW, THE CUSTOMER ACKNOWLEDGES THAT THEY HAVE READ, UNDERSTOOD, AND AGREE TO THESE TERMS & CONDITIONS.

${'='.repeat(70)}
                         SIGNATURES
${'='.repeat(70)}

Customer Signature: _______________________________

Date: _______________________________


For ${(tenant?.company_name as string) || 'Drive 247'}
`;
}

async function generateDocument(
  supabase: ReturnType<typeof createClient>,
  rental: Record<string, unknown>,
  customer: Record<string, unknown>,
  vehicle: Record<string, unknown>,
  tenantId: string
): Promise<string> {
  const { data: tenant } = await supabase
    .from('tenants')
    .select('company_name, contact_email, contact_phone')
    .eq('id', tenantId)
    .single();

  const template = await getActiveTemplate(supabase, tenantId);

  if (template) {
    console.log('Using custom template from portal');
    const processedContent = processTemplate(template, rental, customer, vehicle, tenant || {});
    return htmlToText(processedContent);
  }

  console.log('Using default template');
  return generateDefaultTemplate(rental, customer, vehicle, tenant);
}

// ============================================================================
// BOLDSIGN DOCUMENT CREATION
// ============================================================================

async function sendBoldSignDocument(
  apiKey: string,
  baseUrl: string,
  documentText: string,
  customerEmail: string,
  customerName: string,
  rentalId: string
): Promise<{ documentId: string } | null> {
  try {
    console.log('Creating BoldSign document...');

    // Convert text content to a simple text file (BoldSign accepts files directly)
    const encoder = new TextEncoder();
    const fileBytes = encoder.encode(documentText);

    // Build multipart form data
    const formData = new FormData();
    formData.append('Title', `Rental Agreement - Ref: ${rentalId.substring(0, 8).toUpperCase()}`);
    formData.append('Message', 'Please review and sign the rental agreement.');
    formData.append('Signers[0][Name]', customerName);
    formData.append('Signers[0][EmailAddress]', customerEmail);
    formData.append('Signers[0][SignerType]', 'Signer');
    formData.append('Signers[0][FormFields][0][FieldType]', 'Signature');
    formData.append('Signers[0][FormFields][0][PageNumber]', '1');
    formData.append('Signers[0][FormFields][0][Bounds][X]', '50');
    formData.append('Signers[0][FormFields][0][Bounds][Y]', '200');
    formData.append('Signers[0][FormFields][0][Bounds][Width]', '250');
    formData.append('Signers[0][FormFields][0][Bounds][Height]', '50');
    formData.append('Signers[0][FormFields][0][IsRequired]', 'true');
    formData.append('EnableSigningOrder', 'false');
    formData.append('EnableEmbeddedSigning', 'true');

    const blob = new Blob([fileBytes], { type: 'text/plain' });
    formData.append('Files', blob, 'Rental-Agreement.txt');

    const response = await fetch(`${baseUrl}/v1/document/send`, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
      },
      body: formData,
    });

    const responseText = await response.text();
    console.log('BoldSign response status:', response.status);

    if (!response.ok) {
      console.error('BoldSign document creation failed:', responseText);
      return null;
    }

    const result = JSON.parse(responseText);
    console.log('BoldSign document created! ID:', result.documentId);
    return { documentId: result.documentId };
  } catch (error) {
    console.error('sendBoldSignDocument error:', error);
    return null;
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { rentalId, customerEmail, customerName } = await req.json() as CreateDocumentRequest;

    console.log('='.repeat(60));
    console.log('CREATE BOLDSIGN DOCUMENT');
    console.log('='.repeat(60));
    console.log('Rental ID:', rentalId);

    if (!rentalId) {
      return errorResponse('rentalId is required', 400);
    }

    const BOLDSIGN_API_KEY = Deno.env.get('BOLDSIGN_API_KEY');
    const BOLDSIGN_BASE_URL = Deno.env.get('BOLDSIGN_BASE_URL') || 'https://api.boldsign.com';

    if (!BOLDSIGN_API_KEY) {
      return errorResponse('BoldSign API key not configured', 400);
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

    let customer: Record<string, unknown>;
    let vehicle: Record<string, unknown>;
    let tenantId: string | null = null;

    if (rentalError || !rental) {
      console.log('Rental not found, using provided customer data');
      customer = { name: customerName || 'Customer', email: customerEmail || 'N/A' };
      vehicle = { make: 'Vehicle', model: '', reg: 'N/A' };
    } else {
      customer = rental.customers || { name: customerName, email: customerEmail };
      vehicle = rental.vehicles || { make: 'Vehicle', model: '', reg: 'N/A' };
      tenantId = rental.tenant_id;
    }

    const email = (customerEmail || customer?.email || 'N/A') as string;
    const name = (customerName || customer?.name || 'Customer') as string;

    console.log('Customer:', name, email);
    console.log('Vehicle:', vehicle?.make, vehicle?.model, vehicle?.reg);
    console.log('Tenant ID:', tenantId);

    // Get tenant currency code
    if (tenantId) {
      const { data: tenantCurrency } = await supabase
        .from('tenants')
        .select('currency_code')
        .eq('id', tenantId)
        .single();
      if (tenantCurrency?.currency_code) _currencyCode = tenantCurrency.currency_code;
    }

    // Generate document content
    let doc: string;
    if (tenantId) {
      doc = await generateDocument(supabase, rental, customer, vehicle, tenantId);
    } else {
      doc = generateDefaultTemplate(rental || {}, customer, vehicle, null);
    }

    // Send via BoldSign
    const result = await sendBoldSignDocument(
      BOLDSIGN_API_KEY,
      BOLDSIGN_BASE_URL,
      doc,
      email,
      name,
      rentalId
    );

    if (!result) {
      return errorResponse('Failed to create document', 400);
    }

    console.log('='.repeat(60));
    console.log('SUCCESS! Document ID:', result.documentId);
    console.log('='.repeat(60));

    return jsonResponse({ ok: true, documentId: result.documentId, emailSent: true });
  } catch (error) {
    console.error('Error:', error);
    return errorResponse(`Internal error: ${String(error)}`, 500);
  }
});
