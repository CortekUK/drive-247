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
  tenant: Record<string, unknown>,
  verification?: Record<string, unknown> | null
): string {
  // Compose full address from separate fields
  const customerAddress = [
    customer?.address_street as string,
    customer?.address_city as string,
    customer?.address_state as string,
    customer?.address_zip as string,
  ].filter(Boolean).join(', ') || (customer?.address as string) || (verification?.address as string) || '';

  // Resolve identity fields: customer table first, then fall back to identity_verifications
  const dob = (customer?.date_of_birth as string) || (verification?.date_of_birth as string) || '';
  const documentNumber = (customer?.license_number as string) || (verification?.document_number as string) || '';
  const documentExpiry = (verification?.document_expiry_date as string) || '';
  const documentType = (verification?.document_type as string) || '';

  const variables: Record<string, string> = {
    // Customer — basic
    customer_name: (customer?.name as string) || 'Customer',
    customer_email: (customer?.email as string) || '',
    customer_phone: (customer?.phone as string) || '',
    customer_type: (customer?.customer_type as string) || (customer?.type as string) || 'Individual',
    customer_address: customerAddress,
    customer_address_street: (customer?.address_street as string) || '',
    customer_address_city: (customer?.address_city as string) || '',
    customer_address_state: (customer?.address_state as string) || '',
    customer_address_zip: (customer?.address_zip as string) || '',

    // Customer — identity & license (with verification fallback)
    customer_id_number: (customer?.id_number as string) || documentNumber,
    customer_license_number: documentNumber,
    customer_license_state: (customer?.license_state as string) || '',
    customer_license_expiry: documentExpiry ? formatDate(documentExpiry) : '',
    customer_document_type: documentType === 'drivers_license' ? "Driver's License" : documentType === 'passport' ? 'Passport' : documentType === 'id_card' ? 'ID Card' : '',
    customer_date_of_birth: dob ? formatDate(dob) : '',
    customer_dob: dob ? formatDate(dob) : '',

    // Customer — next of kin
    nok_name: (customer?.nok_full_name as string) || '',
    nok_phone: (customer?.nok_phone as string) || '',
    nok_email: (customer?.nok_email as string) || '',
    nok_address: (customer?.nok_address as string) || '',
    nok_relationship: (customer?.nok_relationship as string) || '',

    // Vehicle
    vehicle_make: (vehicle?.make as string) || '',
    vehicle_model: (vehicle?.model as string) || '',
    vehicle_year: vehicle?.year?.toString() || '',
    vehicle_reg: (vehicle?.reg as string) || 'N/A',
    vehicle_color: (vehicle?.color as string) || '',
    vehicle_vin: (vehicle?.vin as string) || 'Not Added',
    vehicle_fuel_type: (vehicle?.fuel_type as string) || '',
    vehicle_daily_rent: formatCurrency(vehicle?.daily_rent as number),
    vehicle_weekly_rent: formatCurrency(vehicle?.weekly_rent as number),
    vehicle_monthly_rent: formatCurrency(vehicle?.monthly_rent as number),
    vehicle_mileage: vehicle?.current_mileage?.toString() || '',
    vehicle_allowed_mileage: vehicle?.allowed_mileage?.toString() || '',

    // Rental
    rental_number: (rental?.rental_number as string) || (rental?.id as string)?.substring(0, 8)?.toUpperCase() || 'N/A',
    rental_id: (rental?.id as string) || '',
    rental_start_date: formatDate(rental?.start_date as string),
    rental_end_date: rental?.end_date ? formatDate(rental.end_date as string) : 'Ongoing',
    rental_days: (() => {
      if (rental?.start_date && rental?.end_date) {
        const diff = Math.ceil((new Date(rental.end_date as string).getTime() - new Date(rental.start_date as string).getTime()) / (1000 * 60 * 60 * 24));
        return diff > 0 ? diff.toString() : '1';
      }
      return '';
    })(),
    monthly_amount: formatCurrency(rental?.monthly_amount as number),
    rental_amount: formatCurrency(rental?.monthly_amount as number),
    rental_price: (() => {
      const type = (rental?.rental_period_type as string) || 'Monthly';
      const rate = type === 'Daily' ? vehicle?.daily_rent as number : type === 'Weekly' ? vehicle?.weekly_rent as number : vehicle?.monthly_rent as number;
      return formatCurrency(rate);
    })(),
    rental_period_type: (rental?.rental_period_type as string) || 'Monthly',
    rental_status: (rental?.status as string) || '',
    pickup_location: (rental?.pickup_location as string) || '',
    return_location: (rental?.return_location as string) || '',
    delivery_address: (rental?.delivery_address as string) || '',
    pickup_time: (rental?.pickup_time as string) || '',
    return_time: (rental?.return_time as string) || '',

    // Company / Tenant
    company_name: (tenant?.company_name as string) || 'Drive 247',
    company_email: (tenant?.contact_email as string) || '',
    company_phone: (tenant?.contact_phone as string) || '',
    company_address: (tenant?.address as string) || '',

    // Dates
    agreement_date: formatDate(new Date()),
    today_date: formatDate(new Date()),
    current_date: formatDate(new Date()),
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
Rental Price:  ${(() => { const t = (rental?.rental_period_type as string) || 'Monthly'; const r = t === 'Daily' ? vehicle?.daily_rent as number : t === 'Weekly' ? vehicle?.weekly_rent as number : vehicle?.monthly_rent as number; return formatCurrency(r); })()} (${(rental?.rental_period_type as string) || 'Monthly'})

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
  tenantId: string,
  verification?: Record<string, unknown> | null
): Promise<string> {
  const { data: tenant } = await supabase
    .from('tenants')
    .select('company_name, contact_email, contact_phone')
    .eq('id', tenantId)
    .single();

  const template = await getActiveTemplate(supabase, tenantId);

  if (template) {
    console.log('Using custom template from portal');
    const processedContent = processTemplate(template, rental, customer, vehicle, tenant || {}, verification);
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
  rentalId: string,
  brandId?: string
): Promise<{ documentId: string } | null> {
  try {
    console.log('Creating BoldSign document...');

    // Handle BoldSign e-sign text tags
    // If template already has {{@sig1}} (inserted via editor), leave it. Otherwise legacy fallback.
    let taggedText = documentText;
    const hasExplicitSigTag = /\{\{@sig1\}\}/.test(taggedText);
    if (!hasExplicitSigTag) {
      const replaced = taggedText.replace(/Customer Signature:\s*_+/i, 'Customer Signature: {{@sig1}}');
      if (replaced === taggedText) {
        taggedText += '\n\nCustomer Signature: {{@sig1}}';
      } else {
        taggedText = replaced;
      }
    }

    const encoder = new TextEncoder();
    const fileBytes = encoder.encode(taggedText);

    // Build multipart form data
    const formData = new FormData();
    formData.append('Title', `Rental Agreement - Ref: ${rentalId.substring(0, 8).toUpperCase()}`);
    formData.append('Message', 'Please review and sign the rental agreement.');
    if (brandId) {
      formData.append('BrandId', brandId);
    }
    formData.append('Signers[0][Name]', customerName);
    formData.append('Signers[0][EmailAddress]', customerEmail);
    formData.append('Signers[0][SignerType]', 'Signer');
    // Use text tags: BoldSign finds {{@sig1}}, {{@date1}}, {{@init1}} and places fields there
    formData.append('UseTextTags', 'true');

    const hasDateTag = /\{\{@date1\}\}/.test(taggedText);
    const hasInitTag = /\{\{@init1\}\}/.test(taggedText);

    let tagIdx = 0;

    // Signature field (always present)
    formData.append(`TextTagDefinitions[${tagIdx}][DefinitionId]`, 'sig1');
    formData.append(`TextTagDefinitions[${tagIdx}][Type]`, 'Signature');
    formData.append(`TextTagDefinitions[${tagIdx}][SignerIndex]`, '1');
    formData.append(`TextTagDefinitions[${tagIdx}][IsRequired]`, 'true');
    formData.append(`TextTagDefinitions[${tagIdx}][Size][Width]`, '250');
    formData.append(`TextTagDefinitions[${tagIdx}][Size][Height]`, '50');
    tagIdx++;

    // Date signed field (if present in template)
    if (hasDateTag) {
      formData.append(`TextTagDefinitions[${tagIdx}][DefinitionId]`, 'date1');
      formData.append(`TextTagDefinitions[${tagIdx}][Type]`, 'DateSigned');
      formData.append(`TextTagDefinitions[${tagIdx}][SignerIndex]`, '1');
      formData.append(`TextTagDefinitions[${tagIdx}][IsRequired]`, 'true');
      formData.append(`TextTagDefinitions[${tagIdx}][Size][Width]`, '150');
      formData.append(`TextTagDefinitions[${tagIdx}][Size][Height]`, '30');
      tagIdx++;
    }

    // Initials field (if present in template)
    if (hasInitTag) {
      formData.append(`TextTagDefinitions[${tagIdx}][DefinitionId]`, 'init1');
      formData.append(`TextTagDefinitions[${tagIdx}][Type]`, 'Initial');
      formData.append(`TextTagDefinitions[${tagIdx}][SignerIndex]`, '1');
      formData.append(`TextTagDefinitions[${tagIdx}][IsRequired]`, 'true');
      formData.append(`TextTagDefinitions[${tagIdx}][Size][Width]`, '100');
      formData.append(`TextTagDefinitions[${tagIdx}][Size][Height]`, '40');
      tagIdx++;
    }

    formData.append('EnableSigningOrder', 'false');
    formData.append('DisableEmails', 'false');

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
        customers:customer_id (*),
        vehicles:vehicle_id (*)
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

    // Fetch latest identity verification for this customer
    let verification: Record<string, unknown> | null = null;
    const custId = (rental?.customer_id || customer?.id) as string | undefined;
    if (custId) {
      const { data: verificationData } = await supabase
        .from('identity_verifications')
        .select('date_of_birth, document_number, document_expiry_date, document_type, address')
        .eq('customer_id', custId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      verification = verificationData;
      console.log('Verification data:', verification ? 'found' : 'none');
    }

    const email = (customerEmail || customer?.email || 'N/A') as string;
    const name = (customerName || customer?.name || 'Customer') as string;

    console.log('Customer:', name, email);
    console.log('Vehicle:', vehicle?.make, vehicle?.model, vehicle?.reg);
    console.log('Tenant ID:', tenantId);

    // Get tenant currency code and brand info
    let tenantBrandId: string | undefined;
    if (tenantId) {
      const { data: tenantInfo } = await supabase
        .from('tenants')
        .select('currency_code, boldsign_brand_id')
        .eq('id', tenantId)
        .single();
      if (tenantInfo?.currency_code) _currencyCode = tenantInfo.currency_code;
      if (tenantInfo?.boldsign_brand_id) tenantBrandId = tenantInfo.boldsign_brand_id;
    }

    // Generate document content
    let doc: string;
    if (tenantId) {
      doc = await generateDocument(supabase, rental, customer, vehicle, tenantId, verification);
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
      rentalId,
      tenantBrandId
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
