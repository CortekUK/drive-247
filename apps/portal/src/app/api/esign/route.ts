import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

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
    deliveryMode?: 'Email' | 'SMS' | 'EmailAndSMS' | 'WhatsApp';
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

Customer Signature: _________________________

Date: ______________

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
                .select('company_name, contact_email, contact_phone, phone, address, admin_name, admin_email, currency_code, logo_url, boldsign_brand_id')
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

        // Generate PDF from text content
        const pdfDoc = await PDFDocument.create();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const fontSize = 10;
        const lineHeight = 14;
        const margin = 50;
        const pageWidth = 595;  // A4
        const pageHeight = 842;
        const maxWidth = pageWidth - margin * 2;

        const lines = documentContent.split('\n');
        let page = pdfDoc.addPage([pageWidth, pageHeight]);
        let y = pageHeight - margin;

        for (const line of lines) {
            const words = line.split(' ');
            let currentLine = '';
            for (const word of words) {
                const testLine = currentLine ? `${currentLine} ${word}` : word;
                const width = font.widthOfTextAtSize(testLine, fontSize);
                if (width > maxWidth && currentLine) {
                    if (y < margin + lineHeight) {
                        page = pdfDoc.addPage([pageWidth, pageHeight]);
                        y = pageHeight - margin;
                    }
                    const isHeader = currentLine.startsWith('=') || (currentLine === currentLine.toUpperCase() && currentLine.length > 3 && !currentLine.startsWith('{{'));
                    page.drawText(currentLine, { x: margin, y, size: fontSize, font: isHeader ? boldFont : font, color: rgb(0, 0, 0) });
                    y -= lineHeight;
                    currentLine = word;
                } else {
                    currentLine = testLine;
                }
            }
            if (y < margin + lineHeight) {
                page = pdfDoc.addPage([pageWidth, pageHeight]);
                y = pageHeight - margin;
            }
            if (currentLine) {
                const isHeader = currentLine.startsWith('=') || (currentLine === currentLine.toUpperCase() && currentLine.length > 3 && !currentLine.startsWith('{{'));
                page.drawText(currentLine, { x: margin, y, size: fontSize, font: isHeader ? boldFont : font, color: rgb(0, 0, 0) });
            }
            y -= lineHeight;
        }

        const pdfBytes = await pdfDoc.save();

        // Get or create BoldSign brand for this tenant
        let brandId = tenant?.boldsign_brand_id || '';
        if (!brandId && body.tenantId && tenant?.company_name) {
            try {
                const brandForm = new FormData();
                brandForm.append('BrandName', tenant.company_name);
                brandForm.append('EmailDisplayName', tenant.company_name);

                // Fetch tenant logo or generate a placeholder
                let logoAttached = false;
                if (tenant.logo_url) {
                    try {
                        const logoResponse = await fetch(tenant.logo_url);
                        if (logoResponse.ok) {
                            const logoBuffer = await logoResponse.arrayBuffer();
                            const contentType = logoResponse.headers.get('content-type') || 'image/png';
                            const ext = contentType.includes('svg') ? 'svg' : contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'png';
                            const logoBlob = new Blob([logoBuffer], { type: contentType });
                            brandForm.append('BrandLogo', logoBlob, `logo.${ext}`);
                            logoAttached = true;
                        }
                    } catch (e) {
                        console.warn('Could not fetch tenant logo for brand:', e);
                    }
                }

                // BoldSign requires a logo (JPG/PNG/SVG) — generate a simple SVG placeholder
                if (!logoAttached) {
                    const initials = tenant.company_name.split(' ').map((w: string) => w[0]).join('').substring(0, 2).toUpperCase();
                    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#3366CC"/><text x="100" y="120" font-family="Arial,sans-serif" font-size="80" font-weight="bold" fill="white" text-anchor="middle">${initials}</text></svg>`;
                    const svgBlob = new Blob([svg], { type: 'image/svg+xml' });
                    brandForm.append('BrandLogo', svgBlob, 'logo.svg');
                }

                const brandResponse = await fetch(`${BOLDSIGN_BASE_URL}/v1/brand/create`, {
                    method: 'POST',
                    headers: { 'X-API-KEY': BOLDSIGN_API_KEY },
                    body: brandForm,
                });

                if (brandResponse.ok) {
                    const brandResult = await brandResponse.json();
                    brandId = brandResult.brandId;
                    await supabase
                        .from('tenants')
                        .update({ boldsign_brand_id: brandId })
                        .eq('id', body.tenantId);
                    console.log('Created BoldSign brand:', brandId);
                } else {
                    console.warn('Failed to create BoldSign brand:', await brandResponse.text());
                }
            } catch (e) {
                console.warn('Error creating BoldSign brand:', e);
            }
        }

        // Build BoldSign request
        const formData = new FormData();
        formData.append('Title', `Rental Agreement - Ref: ${body.rentalId.substring(0, 8).toUpperCase()}`);
        formData.append('Message', 'Please review and sign the rental agreement.');
        if (brandId) {
            formData.append('BrandId', brandId);
        }
        formData.append('Signers[0][Name]', body.customerName);
        formData.append('Signers[0][EmailAddress]', body.customerEmail);
        formData.append('Signers[0][SignerType]', 'Signer');

        // Set delivery mode (Email, SMS, EmailAndSMS, WhatsApp)
        const deliveryMode = body.deliveryMode || 'Email';
        if (deliveryMode !== 'Email') {
            formData.append('Signers[0][DeliveryMode]', deliveryMode);
            // Add phone number for SMS/WhatsApp delivery
            const phone = (customer as any)?.phone || '';
            if (phone && (deliveryMode === 'SMS' || deliveryMode === 'EmailAndSMS' || deliveryMode === 'WhatsApp')) {
                // Extract country code and number (assume format like +44... or 44...)
                const cleaned = phone.replace(/\s+/g, '').replace(/^(\+)/, '');
                const countryCode = cleaned.substring(0, 2);
                const number = cleaned.substring(2);
                formData.append('Signers[0][PhoneNumber][CountryCode]', `+${countryCode}`);
                formData.append('Signers[0][PhoneNumber][Number]', number);
            }
        }
        formData.append('Signers[0][FormFields][0][FieldType]', 'Signature');
        formData.append('Signers[0][FormFields][0][PageNumber]', String(pdfDoc.getPageCount()));
        formData.append('Signers[0][FormFields][0][Bounds][X]', '50');
        formData.append('Signers[0][FormFields][0][Bounds][Y]', String(Math.max(y - 60, 50)));
        formData.append('Signers[0][FormFields][0][Bounds][Width]', '250');
        formData.append('Signers[0][FormFields][0][Bounds][Height]', '50');
        formData.append('Signers[0][FormFields][0][IsRequired]', 'true');
        formData.append('EnableSigningOrder', 'false');
        formData.append('DisableEmails', 'false');

        const fileBlob = new Blob([pdfBytes], { type: 'application/pdf' });
        formData.append('Files', fileBlob, 'Rental-Agreement.pdf');

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
