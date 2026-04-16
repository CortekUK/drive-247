import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { formatCurrency as sharedFormatCurrency } from '../_shared/format-utils.ts';
import { getBoldSignApiKey, getBoldSignBaseUrl, getTenantBoldSignMode, getBoldSignBrandId } from '../_shared/boldsign-client.ts';
import type { BoldSignMode } from '../_shared/boldsign-client.ts';

interface CreateDocumentRequest {
  rentalId: string;
  customerEmail?: string;
  customerName?: string;
}

// ============================================================================
// TEMPLATE PROCESSING FUNCTIONS
// ============================================================================

async function getActiveTemplate(supabase: ReturnType<typeof createClient>, tenantId: string, category: string = 'standard'): Promise<string | null> {
  try {
    console.log(`Fetching active ${category} template for tenant:`, tenantId);

    const { data, error } = await supabase
      .from('agreement_templates')
      .select('template_content')
      .eq('tenant_id', tenantId)
      .eq('template_category', category)
      .eq('is_active', true)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // Fallback to standard if no category-specific template
        if (category !== 'standard') {
          console.log(`No active ${category} template, falling back to standard`);
          return getActiveTemplate(supabase, tenantId, 'standard');
        }
        console.log('No active template found, will use default');
        return null;
      }
      console.error('Error fetching template:', error);
      return null;
    }

    console.log(`Found active ${category} template for tenant`);
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

let _currencyCode = 'USD';
function formatCurrency(amount: number | null): string {
  if (amount === null || amount === undefined) return sharedFormatCurrency(0, _currencyCode);
  return sharedFormatCurrency(amount, _currencyCode);
}

interface InstallmentData {
  plan_type: string;
  total_installable_amount: number;
  number_of_installments: number;
  installment_amount: number;
  upfront_amount: number;
  status: string;
  scheduled_installments: Array<{
    installment_number: number;
    amount: number;
    due_date: string;
    status: string;
  }>;
}

function buildInstallmentScheduleHtml(installment: InstallmentData): string {
  const rows = installment.scheduled_installments
    .sort((a, b) => a.installment_number - b.installment_number)
    .map(si => `<tr><td>Payment ${si.installment_number}</td><td>${formatCurrency(si.amount)}</td><td>${formatDate(si.due_date)}</td></tr>`)
    .join('');

  return `<h2>Payment Schedule</h2>
<p>This rental is set up with an installment payment plan. <strong>You will NOT be charged the full amount upfront.</strong></p>
<table>
<tr><td><strong>Plan Type</strong></td><td>${installment.plan_type.charAt(0).toUpperCase() + installment.plan_type.slice(1)}</td></tr>
<tr><td><strong>Total Rental Amount</strong></td><td>${formatCurrency(installment.total_installable_amount)}</td></tr>
<tr><td><strong>Upfront Amount</strong></td><td>${formatCurrency(installment.upfront_amount)}</td></tr>
<tr><td><strong>Number of Installments</strong></td><td>${installment.number_of_installments}</td></tr>
<tr><td><strong>Per Installment</strong></td><td>${formatCurrency(installment.installment_amount)}</td></tr>
</table>
<h3>Scheduled Payments</h3>
<table>
<tr><th>Payment</th><th>Amount</th><th>Due Date</th></tr>
${rows}
</table>`;
}

function buildInstallmentScheduleText(installment: InstallmentData): string {
  const lines = installment.scheduled_installments
    .sort((a, b) => a.installment_number - b.installment_number)
    .map(si => `  Payment ${si.installment_number}:  ${formatCurrency(si.amount)}  |  Due: ${formatDate(si.due_date)}`)
    .join('\n');

  return `${'─'.repeat(70)}
PAYMENT SCHEDULE
${'─'.repeat(70)}
This rental is set up with an installment payment plan.
You will NOT be charged the full amount upfront.

Plan Type:           ${installment.plan_type.charAt(0).toUpperCase() + installment.plan_type.slice(1)}
Total Rental Amount: ${formatCurrency(installment.total_installable_amount)}
Upfront Amount:      ${formatCurrency(installment.upfront_amount)}
Installments:        ${installment.number_of_installments} x ${formatCurrency(installment.installment_amount)}

Scheduled Payments:
${lines}
`;
}

function processTemplate(
  template: string,
  rental: Record<string, unknown>,
  customer: Record<string, unknown>,
  vehicle: Record<string, unknown>,
  tenant: Record<string, unknown>,
  verification?: Record<string, unknown> | null,
  installment?: InstallmentData | null
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
    vehicle_daily_mileage: vehicle?.daily_mileage?.toString() || '',
    vehicle_weekly_mileage: vehicle?.weekly_mileage?.toString() || '',
    vehicle_monthly_mileage: vehicle?.monthly_mileage?.toString() || '',
    vehicle_allowed_mileage: (() => {
      // Calculate total allowed mileage based on rental tier and duration
      const startDate = rental?.start_date as string | undefined;
      const endDate = rental?.end_date as string | undefined;
      if (!startDate || !endDate) return vehicle?.monthly_mileage?.toString() || 'Unlimited';
      const days = Math.max(1, Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)));

      // Use rental-level mileage overrides if present, otherwise fall back to vehicle
      const dailyMileage = (rental?.daily_mileage_override as number | null) ?? (vehicle?.daily_mileage as number | null);
      const weeklyMileage = (rental?.weekly_mileage_override as number | null) ?? (vehicle?.weekly_mileage as number | null);
      const monthlyMileage = (rental?.monthly_mileage_override as number | null) ?? (vehicle?.monthly_mileage as number | null);

      const _mtd = (tenant?.monthly_tier_days as number) ?? 30;
      if (days >= _mtd) {
        if (monthlyMileage == null) return 'Unlimited';
        return (monthlyMileage * Math.ceil(days / _mtd)).toString();
      } else if (days >= 7) {
        if (weeklyMileage == null) return 'Unlimited';
        return (weeklyMileage * Math.ceil(days / 7)).toString();
      } else {
        if (dailyMileage == null) return 'Unlimited';
        return (dailyMileage * days).toString();
      }
    })(),
    mileage_tier: (() => {
      const startDate = rental?.start_date as string | undefined;
      const endDate = rental?.end_date as string | undefined;
      if (!startDate || !endDate) return 'monthly';
      const days = Math.max(1, Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)));
      const __mtd = (tenant?.monthly_tier_days as number) ?? 30;
      if (days >= __mtd) return 'monthly';
      if (days >= 7) return 'weekly';
      return 'daily';
    })(),
    vehicle_excess_mileage_rate: (() => {
      // Use rental-level override if present, otherwise fall back to vehicle
      const rate = (rental?.excess_mileage_rate_override as number | null) ?? (vehicle?.excess_mileage_rate as number | null);
      if (rate == null) return 'N/A';
      return formatCurrency(rate);
    })(),

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
    monthly_amount: formatCurrency(rental?.discount_applied ? ((rental.monthly_amount as number) - (rental.discount_applied as number)) : rental?.monthly_amount as number),
    rental_amount: formatCurrency(rental?.discount_applied ? ((rental.monthly_amount as number) - (rental.discount_applied as number)) : rental?.monthly_amount as number),
    rental_price: (() => {
      const type = (rental?.rental_period_type as string) || 'Monthly';
      const rate = type === 'Daily' ? vehicle?.daily_rent as number : type === 'Weekly' ? vehicle?.weekly_rent as number : vehicle?.monthly_rent as number;
      if (rental?.discount_applied && rate) {
        return formatCurrency(rate - (rental.discount_applied as number));
      }
      return formatCurrency(rate);
    })(),
    discount_amount: rental?.discount_applied ? formatCurrency(rental.discount_applied as number) : '',
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

    // Installment payment schedule
    installment_schedule: installment ? buildInstallmentScheduleHtml(installment) : '',
    has_installments: installment ? 'true' : 'false',
    installment_plan_type: installment ? installment.plan_type.charAt(0).toUpperCase() + installment.plan_type.slice(1) : '',
    installment_total_amount: installment ? formatCurrency(installment.total_installable_amount) : '',
    installment_upfront_amount: installment ? formatCurrency(installment.upfront_amount) : '',
    installment_count: installment ? installment.number_of_installments.toString() : '',
    installment_per_payment: installment ? formatCurrency(installment.installment_amount) : '',
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
  tenant: Record<string, unknown> | null,
  installment?: InstallmentData | null
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

${installment ? buildInstallmentScheduleText(installment) : ''}${'='.repeat(70)}
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

async function fetchInstallmentData(
  supabase: ReturnType<typeof createClient>,
  rentalId: string
): Promise<InstallmentData | null> {
  try {
    const { data: plan, error } = await supabase
      .from('installment_plans')
      .select('plan_type, total_installable_amount, number_of_installments, installment_amount, upfront_amount, status')
      .eq('rental_id', rentalId)
      .in('status', ['active', 'pending'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !plan) return null;

    const { data: scheduled } = await supabase
      .from('scheduled_installments')
      .select('installment_number, amount, due_date, status')
      .eq('rental_id', rentalId)
      .order('installment_number', { ascending: true });

    return {
      ...plan,
      scheduled_installments: scheduled || [],
    } as InstallmentData;
  } catch (err) {
    console.error('Error fetching installment data:', err);
    return null;
  }
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
    .select('company_name, contact_email, contact_phone, monthly_tier_days')
    .eq('id', tenantId)
    .single();

  // Fetch installment plan if rental has one
  const rentalId = rental?.id as string;
  const installment = rentalId ? await fetchInstallmentData(supabase, rentalId) : null;
  if (installment) {
    console.log(`Installment plan found: ${installment.plan_type}, ${installment.number_of_installments} payments of ${installment.installment_amount}`);
  }

  const templateCategory = (rental as Record<string, unknown>)?.is_pay_as_you_go ? 'payg' : 'standard';
  const template = await getActiveTemplate(supabase, tenantId, templateCategory);

  if (template) {
    console.log('Using custom template from portal');
    const processedContent = processTemplate(template, rental, customer, vehicle, tenant || {}, verification, installment);
    return htmlToText(processedContent);
  }

  console.log('Using default template');
  return generateDefaultTemplate(rental, customer, vehicle, tenant, installment);
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
    formData.append('DisableEmails', 'true');

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

    // Dedup guard: if this rental already has an active, non-terminal agreement, skip creating another.
    // Prevents double-clicks and duplicate API calls from burning sandbox quota.
    {
      const { data: existingRental } = await supabase
        .from('rentals')
        .select('docusign_envelope_id, document_status')
        .eq('id', rentalId)
        .single();
      const existingStatus = (existingRental?.document_status || '').toLowerCase();
      const isActiveNonTerminal = existingRental?.docusign_envelope_id &&
        !['declined', 'voided', 'expired'].includes(existingStatus);
      if (isActiveNonTerminal) {
        console.log('Rental already has an active BoldSign document, skipping create:', existingRental.docusign_envelope_id, 'status:', existingStatus);
        return jsonResponse({
          ok: true,
          documentId: existingRental.docusign_envelope_id,
          emailSent: false,
          deduped: true,
        });
      }
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

    // Get tenant currency code, brand info, and BoldSign mode
    let tenantBrandId: string | undefined;
    let boldsignMode: BoldSignMode = 'test';
    if (tenantId) {
      const { data: tenantInfo } = await supabase
        .from('tenants')
        .select('currency_code, boldsign_mode, boldsign_test_brand_id, boldsign_live_brand_id')
        .eq('id', tenantId)
        .single();
      if (tenantInfo?.currency_code) _currencyCode = tenantInfo.currency_code;
      if (tenantInfo?.boldsign_mode) boldsignMode = tenantInfo.boldsign_mode as BoldSignMode;
      const brandId = getBoldSignBrandId(tenantInfo || {}, boldsignMode);
      if (brandId) tenantBrandId = brandId;
    }

    // Resolve API key based on mode
    let BOLDSIGN_API_KEY: string;
    try {
      BOLDSIGN_API_KEY = getBoldSignApiKey(boldsignMode);
    } catch {
      return errorResponse('BoldSign API key not configured for mode: ' + boldsignMode, 400);
    }
    const BOLDSIGN_BASE_URL = getBoldSignBaseUrl();
    console.log('BoldSign mode:', boldsignMode);

    // Generate document content
    let doc: string;
    if (tenantId) {
      doc = await generateDocument(supabase, rental, customer, vehicle, tenantId, verification);
    } else {
      doc = generateDefaultTemplate(rental || {}, customer, vehicle, null);
    }

    // Blocking credit check BEFORE sending to BoldSign
    const isTestMode = boldsignMode === 'test';
    let creditDeductionResult: any = null;
    if (tenantId) {
      const { data: deductResult, error: deductError } = await supabase.rpc('deduct_credits', {
        p_tenant_id: tenantId,
        p_category: 'esign',
        p_description: `E-sign agreement: ${name} (Ref: ${rentalId.substring(0, 8).toUpperCase()})`,
        p_reference_id: rentalId,
        p_reference_type: 'rental',
        p_is_test_mode: isTestMode,
      });

      if (deductError) {
        console.error('Credit deduction RPC error:', deductError.message);
        return errorResponse('Credit check failed: ' + deductError.message, 500);
      }

      if (deductResult?.success === false) {
        console.warn('Insufficient credits for esign:', deductResult);
        return errorResponse('insufficient_credits', 402);
      }

      creditDeductionResult = deductResult;
      console.log(`Credits deducted: ${deductResult.amount_deducted} (test: ${isTestMode}, balance: ${deductResult.balance_after})`);
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
      // Refund credits since BoldSign failed
      if (tenantId && creditDeductionResult?.success) {
        try {
          await supabase.rpc('add_credits', {
            p_tenant_id: tenantId,
            p_amount: creditDeductionResult.amount_deducted,
            p_type: 'refund',
            p_description: `Refund: BoldSign send failed (Ref: ${rentalId.substring(0, 8).toUpperCase()})`,
            p_category: 'esign',
            p_is_test_mode: isTestMode,
          });
          console.log('Credits refunded after BoldSign failure');
        } catch (refundErr) {
          console.error('Failed to refund credits:', refundErr);
        }
      }
      return errorResponse('Failed to create document', 400);
    }

    // Trigger auto-refill if needed (non-blocking)
    if (creditDeductionResult?.auto_refill_needed && tenantId) {
      try {
        await supabase.functions.invoke('manage-credit-wallet', {
          body: { action: 'auto_refill', tenantId },
        });
        console.log('Auto-refill triggered for tenant', tenantId);
      } catch (refillErr) {
        console.warn('Auto-refill trigger failed:', refillErr);
      }
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
