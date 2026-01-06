import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

interface PreviewRequest {
    rentalId: string;
    tenantId: string;
}

// Format helpers
function formatDate(date: string | Date | null): string {
    if (!date) return 'N/A';
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatCurrency(amount: number | null): string {
    if (amount === null || amount === undefined) return '£0';
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount);
}

// Process template variables
function processTemplate(template: string, rental: any, customer: any, vehicle: any, tenant: any): string {
    const variables: Record<string, string> = {
        customer_name: customer?.name || 'Customer',
        customer_email: customer?.email || '',
        customer_phone: customer?.phone || '',
        customer_address: customer?.address || '',
        vehicle_make: vehicle?.make || '',
        vehicle_model: vehicle?.model || '',
        vehicle_reg: vehicle?.reg || 'N/A',
        vehicle_colour: vehicle?.colour || '',
        rental_number: rental?.id?.substring(0, 8)?.toUpperCase() || 'N/A',
        rental_id: rental?.id || '',
        rental_start_date: formatDate(rental?.start_date),
        rental_end_date: rental?.end_date ? formatDate(rental.end_date) : 'Ongoing',
        monthly_amount: formatCurrency(rental?.monthly_amount),
        weekly_amount: formatCurrency(rental?.weekly_amount || (rental?.monthly_amount / 4)),
        deposit_amount: formatCurrency(rental?.deposit_amount || 0),
        rental_period_type: rental?.rental_period_type || 'Monthly',
        company_name: tenant?.company_name || 'Drive 247',
        company_email: tenant?.contact_email || '',
        company_phone: tenant?.contact_phone || '',
        company_address: tenant?.address || '',
        agreement_date: formatDate(new Date()),
        today_date: formatDate(new Date()),
    };

    let result = template;
    for (const [key, value] of Object.entries(variables)) {
        // Match {{key}}, {{ key }}, {{KEY}}, etc.
        result = result.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi'), value);
    }
    return result;
}

// Generate default agreement if no template
function generateDefaultAgreement(rental: any, customer: any, vehicle: any, tenant: any): string {
    const companyName = tenant?.company_name || 'Drive 247';
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; color: #333; }
    h1 { text-align: center; color: #1a1a1a; border-bottom: 2px solid #333; padding-bottom: 10px; }
    h2 { color: #444; margin-top: 30px; }
    .header { text-align: center; margin-bottom: 40px; }
    .section { margin: 20px 0; padding: 15px; background: #f9f9f9; border-radius: 5px; }
    .field { margin: 8px 0; }
    .label { font-weight: bold; color: #555; }
    .divider { border-top: 1px solid #ddd; margin: 30px 0; }
    .signature-section { margin-top: 50px; }
    .signature-line { border-bottom: 1px solid #333; width: 300px; margin: 40px 0 5px 0; }
    .footer { margin-top: 50px; text-align: center; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="header">
    <h1>RENTAL AGREEMENT</h1>
    <p><strong>${companyName}</strong></p>
    <p>Date: ${formatDate(new Date())}</p>
    <p>Reference: ${rental?.id?.substring(0, 8)?.toUpperCase() || 'N/A'}</p>
  </div>

  <div class="section">
    <h2>Company Details</h2>
    <div class="field"><span class="label">Company:</span> ${companyName}</div>
    <div class="field"><span class="label">Email:</span> ${tenant?.contact_email || ''}</div>
    <div class="field"><span class="label">Phone:</span> ${tenant?.contact_phone || ''}</div>
  </div>

  <div class="section">
    <h2>Customer Details</h2>
    <div class="field"><span class="label">Name:</span> ${customer?.name || 'Customer'}</div>
    <div class="field"><span class="label">Email:</span> ${customer?.email || ''}</div>
    <div class="field"><span class="label">Phone:</span> ${customer?.phone || ''}</div>
  </div>

  <div class="section">
    <h2>Vehicle Details</h2>
    <div class="field"><span class="label">Registration:</span> ${vehicle?.reg || 'N/A'}</div>
    <div class="field"><span class="label">Make & Model:</span> ${vehicle?.make || ''} ${vehicle?.model || ''}</div>
    <div class="field"><span class="label">Colour:</span> ${vehicle?.colour || ''}</div>
  </div>

  <div class="section">
    <h2>Rental Terms</h2>
    <div class="field"><span class="label">Start Date:</span> ${formatDate(rental?.start_date)}</div>
    <div class="field"><span class="label">End Date:</span> ${rental?.end_date ? formatDate(rental.end_date) : 'Ongoing'}</div>
    <div class="field"><span class="label">Period Type:</span> ${rental?.rental_period_type || 'Monthly'}</div>
    <div class="field"><span class="label">Amount:</span> ${formatCurrency(rental?.monthly_amount)}</div>
  </div>

  <div class="section">
    <h2>Terms and Conditions</h2>
    <ol>
      <li>The Customer agrees to rent the vehicle described above for the specified period.</li>
      <li>The Customer will maintain the vehicle in good condition during the rental period.</li>
      <li>The Customer is responsible for any damage to the vehicle during the rental period.</li>
      <li>All rental payments must be made on or before the due date.</li>
      <li>The Customer agrees to return the vehicle in the same condition as received.</li>
    </ol>
  </div>

  <div class="signature-section">
    <h2>Signatures</h2>
    <div class="signature-line"></div>
    <p>Customer Signature: ${customer?.name || '_________________'}</p>
    <p>Date: ${formatDate(new Date())}</p>
  </div>

  <div class="footer">
    <p>${companyName} - Rental Agreement</p>
    <p>Generated: ${new Date().toISOString()}</p>
  </div>
</body>
</html>
`;
}

// Wrap plain HTML template with proper styling for PDF
function wrapWithPDFStyles(html: string, tenant: any): string {
    // If already has DOCTYPE, return as is
    if (html.includes('<!DOCTYPE') || html.includes('<html')) {
        return html;
    }

    // Wrap with basic HTML structure and print-friendly styles
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page { margin: 20mm; }
    body { 
      font-family: Arial, Helvetica, sans-serif; 
      margin: 0; 
      padding: 20px;
      line-height: 1.6; 
      color: #333;
      font-size: 12pt;
    }
    h1, h2, h3 { color: #1a1a1a; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0; }
    th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
    .signature-line { border-bottom: 1px solid #333; width: 250px; margin: 30px 0 5px 0; display: inline-block; }
  </style>
</head>
<body>
${html}
</body>
</html>
`;
}

export async function POST(request: NextRequest) {
    try {
        const { rentalId, tenantId } = await request.json() as PreviewRequest;

        console.log('='.repeat(50));
        console.log('AGREEMENT PREVIEW API');
        console.log('='.repeat(50));
        console.log('Rental ID:', rentalId);
        console.log('Tenant ID:', tenantId);

        if (!rentalId) {
            return NextResponse.json({ ok: false, error: 'rentalId is required' }, { status: 400 });
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Fetch rental with related data
        const { data: rental, error: rentalError } = await supabase
            .from('rentals')
            .select(`
        *,
        customers:customer_id(*),
        vehicles:vehicle_id(*)
      `)
            .eq('id', rentalId)
            .single();

        if (rentalError || !rental) {
            console.error('Rental not found:', rentalError);
            return NextResponse.json({ ok: false, error: 'Rental not found' }, { status: 404 });
        }

        const customer = rental.customers || {};
        const vehicle = rental.vehicles || {};

        // Fetch tenant info
        const resolvedTenantId = tenantId || rental.tenant_id;
        let tenant = null;
        if (resolvedTenantId) {
            const { data: tenantData } = await supabase
                .from('tenants')
                .select('company_name, contact_email, contact_phone, address')
                .eq('id', resolvedTenantId)
                .single();
            tenant = tenantData;
        }

        // Fetch active agreement template
        let htmlContent: string;
        if (resolvedTenantId) {
            const { data: templateData } = await supabase
                .from('agreement_templates')
                .select('template_content, template_name')
                .eq('tenant_id', resolvedTenantId)
                .eq('is_active', true)
                .single();

            if (templateData?.template_content) {
                console.log('Using admin template:', templateData.template_name);
                const processed = processTemplate(templateData.template_content, rental, customer, vehicle, tenant);
                htmlContent = wrapWithPDFStyles(processed, tenant);
            } else {
                console.log('No admin template, using default');
                htmlContent = generateDefaultAgreement(rental, customer, vehicle, tenant);
            }
        } else {
            console.log('No tenant ID, using default template');
            htmlContent = generateDefaultAgreement(rental, customer, vehicle, tenant);
        }

        console.log('Generated HTML length:', htmlContent.length);

        // Return HTML content (we'll convert to PDF on client side or use a PDF service)
        // For now, return base64 encoded HTML that can be rendered
        const htmlBase64 = Buffer.from(htmlContent).toString('base64');

        return NextResponse.json({
            ok: true,
            html: htmlContent,
            htmlBase64,
            contentType: 'text/html',
            rental: {
                id: rental.id,
                status: rental.status,
                document_status: rental.document_status,
            }
        });

    } catch (error: any) {
        console.error('Preview API Error:', error);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
}
