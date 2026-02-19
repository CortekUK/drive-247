import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// BoldSign configuration
const BOLDSIGN_API_KEY = process.env.BOLDSIGN_API_KEY || '';
const BOLDSIGN_BASE_URL = process.env.BOLDSIGN_BASE_URL || 'https://api.boldsign.com';

// Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

interface ESignRequest {
    rentalId: string;
    customerEmail: string;
    customerName: string;
    tenantId: string;
}

// Format helpers
function formatDate(date: string | Date | null): string {
    if (!date) return 'N/A';
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatCurrency(amount: number | null, currencyCode: string = 'GBP'): string {
    const value = amount ?? 0;
    const code = currencyCode?.toUpperCase() || 'GBP';
    const localeMap: Record<string, string> = { USD: 'en-US', GBP: 'en-GB', EUR: 'en-IE' };
    const locale = localeMap[code] || 'en-US';
    try {
        return new Intl.NumberFormat(locale, { style: 'currency', currency: code }).format(value);
    } catch {
        return `${code} ${value.toFixed(2)}`;
    }
}

// Process template variables
function processTemplate(template: string, rental: any, customer: any, vehicle: any, tenant: any, currencyCode: string = 'GBP'): string {
    const variables: Record<string, string> = {
        customer_name: customer?.name || '',
        customer_email: customer?.email || '',
        customer_phone: customer?.phone || '',
        customer_type: customer?.customer_type || '',
        customer_id_number: customer?.id_number || '',
        customer_license_number: customer?.license_number || '',
        customer_address: customer?.address || '',
        nok_name: customer?.nok_full_name || '',
        nok_phone: customer?.nok_phone || '',
        nok_email: customer?.nok_email || '',
        nok_address: customer?.nok_address || '',
        nok_relationship: customer?.nok_relationship || '',

        vehicle_make: vehicle?.make || '',
        vehicle_model: vehicle?.model || '',
        vehicle_year: vehicle?.year?.toString() || '',
        vehicle_reg: vehicle?.reg || '',
        vehicle_color: vehicle?.color || vehicle?.colour || '',
        vehicle_fuel_type: vehicle?.fuel_type || '',
        vehicle_description: vehicle?.description || '',
        vehicle_daily_rent: formatCurrency(vehicle?.daily_rent, currencyCode),
        vehicle_weekly_rent: formatCurrency(vehicle?.weekly_rent, currencyCode),
        vehicle_monthly_rent: formatCurrency(vehicle?.monthly_rent, currencyCode),

        rental_number: rental?.rental_number || rental?.id?.substring(0, 8)?.toUpperCase() || '',
        rental_id: rental?.id || '',
        rental_start_date: formatDate(rental?.start_date),
        rental_end_date: rental?.end_date ? formatDate(rental.end_date) : 'Ongoing',
        monthly_amount: formatCurrency(rental?.monthly_amount, currencyCode),
        rental_amount: formatCurrency(rental?.monthly_amount, currencyCode),
        rental_period_type: rental?.rental_period_type || 'Monthly',
        pickup_location: rental?.pickup_location || '',
        return_location: rental?.return_location || '',
        pickup_time: rental?.pickup_time || '',
        return_time: rental?.return_time || '',
        promo_code: rental?.promo_code || '',

        company_name: tenant?.company_name || 'Drive 247',
        company_email: tenant?.contact_email || '',
        company_phone: tenant?.contact_phone || tenant?.phone || '',
        company_address: tenant?.address || '',
        admin_name: tenant?.admin_name || '',
        admin_email: tenant?.admin_email || '',

        agreement_date: formatDate(new Date()),
        today_date: formatDate(new Date()),
        current_date: formatDate(new Date()),
    };

    let result = template;
    for (const [key, value] of Object.entries(variables)) {
        result = result.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi'), value);
    }
    return result;
}

function removeEmptyFields(html: string): string {
    return html
        .replace(/<tr>\s*<td>.*?<\/td>\s*<td>\s*<\/td>\s*<\/tr>/gi, '')
        .replace(/<p>\s*<strong>[^<]*:<\/strong>\s*<\/p>/gi, '')
        .replace(/<p>\s*<strong>[^<]*:<\/strong>(\s|&nbsp;)*<\/p>/gi, '')
        .replace(/<p>\s*<\/p>/gi, '')
        .replace(/<tr>\s*<td>.*?<\/td>\s*<td>\s+<\/td>\s*<\/tr>/gi, '');
}

function htmlToText(html: string): string {
    return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
        .replace(/<hr\s*\/?>/gi, '\n' + '='.repeat(70) + '\n')
        .replace(/<\/td>/gi, ' | ')
        .replace(/<li>/gi, '\u2022 ')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]+/g, ' ')
        .trim();
}

function generateDefaultAgreement(rental: any, customer: any, vehicle: any, tenant: any, currencyCode: string = 'GBP'): string {
    const companyName = tenant?.company_name || 'Drive 247';
    const line = (label: string, value: string | null | undefined) => value ? `${label}: ${value}` : '';
    const lines = (...parts: string[]) => parts.filter(Boolean).join('\n');

    return `
RENTAL AGREEMENT
${'='.repeat(70)}

Date: ${formatDate(new Date())}
Reference: ${rental?.id?.substring(0, 8)?.toUpperCase() || 'N/A'}

${'='.repeat(70)}

LANDLORD: ${companyName}
${lines(tenant?.contact_email, tenant?.contact_phone)}

${'='.repeat(70)}

CUSTOMER:
${lines(
    line('Name', customer?.name),
    line('Email', customer?.email),
    line('Phone', customer?.phone)
)}

${'='.repeat(70)}

VEHICLE:
${lines(
    line('Registration', vehicle?.reg),
    (vehicle?.make || vehicle?.model) ? `Make & Model: ${[vehicle?.make, vehicle?.model].filter(Boolean).join(' ')}` : ''
)}

${'='.repeat(70)}

RENTAL TERMS:
${lines(
    line('Start Date', formatDate(rental?.start_date)),
    line('End Date', rental?.end_date ? formatDate(rental.end_date) : 'Ongoing'),
    line('Amount', formatCurrency(rental?.monthly_amount, currencyCode))
)}

${'='.repeat(70)}

TERMS:
1. Customer agrees to rent the vehicle for the specified period.
2. Customer will maintain the vehicle in good condition.
3. Customer is responsible for any damage during rental.

${'='.repeat(70)}

SIGNATURE:

{{sign|1|*|Customer Signature|customer_sig}}

Date: {{text|1||Date|date_field}}

${'='.repeat(70)}
${companyName} - Generated: ${new Date().toISOString()}
`;
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json() as ESignRequest;

        console.log('='.repeat(50));
        console.log('PORTAL ESIGN API (BoldSign)');
        console.log('='.repeat(50));
        console.log('Rental ID:', body.rentalId);
        console.log('Customer:', body.customerName, body.customerEmail);
        console.log('Tenant ID:', body.tenantId);

        if (!body.rentalId || !body.customerEmail || !body.customerName) {
            return NextResponse.json({ ok: false, error: 'Missing required fields' }, { status: 400 });
        }

        if (!BOLDSIGN_API_KEY) {
            return NextResponse.json({ ok: false, error: 'BoldSign not configured' }, { status: 500 });
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Fetch rental with related data
        const { data: rental } = await supabase
            .from('rentals')
            .select(`*, customers:customer_id(*), vehicles:vehicle_id(*)`)
            .eq('id', body.rentalId)
            .single();

        const customer = rental?.customers || { name: body.customerName, email: body.customerEmail };
        const vehicle = rental?.vehicles || { make: '', model: '', reg: 'N/A' };

        // Fetch tenant
        let tenant = null;
        if (body.tenantId) {
            const { data: tenantData } = await supabase
                .from('tenants')
                .select('company_name, contact_email, contact_phone, phone, address, admin_name, admin_email, currency_code')
                .eq('id', body.tenantId)
                .single();
            tenant = tenantData;
        }

        // Generate document content
        const currencyCode = tenant?.currency_code || 'GBP';
        let documentContent: string;
        if (body.tenantId) {
            const { data: templateData } = await supabase
                .from('agreement_templates')
                .select('template_content')
                .eq('tenant_id', body.tenantId)
                .eq('is_active', true)
                .single();

            if (templateData?.template_content) {
                console.log('Using admin template');
                documentContent = htmlToText(removeEmptyFields(processTemplate(templateData.template_content, rental, customer, vehicle, tenant, currencyCode)));
            } else {
                console.log('Using default template');
                documentContent = generateDefaultAgreement(rental, customer, vehicle, tenant, currencyCode);
            }
        } else {
            documentContent = generateDefaultAgreement(rental, customer, vehicle, tenant, currencyCode);
        }

        // Send via BoldSign
        const formData = new FormData();
        formData.append('Title', `Rental Agreement - Ref: ${body.rentalId.substring(0, 8).toUpperCase()}`);
        formData.append('Message', 'Please review and sign the rental agreement.');
        formData.append('Signers[0][Name]', body.customerName);
        formData.append('Signers[0][EmailAddress]', body.customerEmail);
        formData.append('Signers[0][SignerType]', 'Signer');
        formData.append('EnableSigningOrder', 'false');
        formData.append('UseTextTags', 'true');

        const fileBlob = new Blob([documentContent], { type: 'text/plain' });
        formData.append('Files', fileBlob, 'Rental-Agreement.txt');

        console.log('Sending document to BoldSign...');
        const boldSignResponse = await fetch(`${BOLDSIGN_BASE_URL}/v1/document/send`, {
            method: 'POST',
            headers: { 'X-API-KEY': BOLDSIGN_API_KEY },
            body: formData,
        });

        if (!boldSignResponse.ok) {
            const errorText = await boldSignResponse.text();
            console.error('BoldSign error:', boldSignResponse.status, errorText);
            return NextResponse.json({ ok: false, error: 'Failed to create document', detail: errorText }, { status: 500 });
        }

        const boldSignResult = await boldSignResponse.json();
        const documentId = boldSignResult.documentId;

        // Update rental with BoldSign document info
        console.log('Updating rental with document info...');
        await supabase
            .from('rentals')
            .update({
                docusign_envelope_id: documentId,
                document_status: 'sent',
                envelope_created_at: new Date().toISOString(),
                envelope_sent_at: new Date().toISOString(),
            })
            .eq('id', body.rentalId);

        console.log('SUCCESS! Document ID:', documentId);
        return NextResponse.json({ ok: true, envelopeId: documentId, emailSent: true });

    } catch (error: any) {
        console.error('API Error:', error);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
}
