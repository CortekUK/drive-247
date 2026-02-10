import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

// DocuSign configuration from environment variables
const DOCUSIGN_INTEGRATION_KEY = process.env.DOCUSIGN_INTEGRATION_KEY || '';
const DOCUSIGN_USER_ID = process.env.DOCUSIGN_USER_ID || '';
const DOCUSIGN_PRIVATE_KEY = process.env.DOCUSIGN_PRIVATE_KEY || '';
const DOCUSIGN_BASE_URL = process.env.DOCUSIGN_BASE_URL || 'https://demo.docusign.net/restapi';

// Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

interface EnvelopeRequest {
    rentalId: string;
    customerEmail: string;
    customerName: string;
    tenantId?: string;  // Passed from frontend
    vehicleId?: string; // Fallback for tenant lookup
}

// Base64URL encode
function base64url(input: string | Buffer): string {
    const base64 = Buffer.isBuffer(input) ? input.toString('base64') : Buffer.from(input).toString('base64');
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Format date
function formatDate(date: string | Date | null): string {
    if (!date) return 'N/A';
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Format currency with dynamic currency code
function formatCurrency(amount: number | null, currencyCode: string = 'GBP'): string {
    if (amount === null || amount === undefined) {
        const symbols: Record<string, string> = { USD: '$', GBP: '\u00a3', EUR: '\u20ac' };
        return `${symbols[currencyCode] || currencyCode}0`;
    }
    const code = currencyCode?.toUpperCase() || 'GBP';
    const localeMap: Record<string, string> = { USD: 'en-US', GBP: 'en-GB', EUR: 'en-IE' };
    const locale = localeMap[code] || 'en-US';
    try {
        return new Intl.NumberFormat(locale, { style: 'currency', currency: code }).format(amount);
    } catch {
        return `${code} ${amount.toFixed(2)}`;
    }
}

// Process template variables - ALL AVAILABLE VARIABLES
function processTemplate(template: string, rental: any, customer: any, vehicle: any, tenant: any): string {
    const cc = tenant?.currency_code || 'GBP';
    const variables: Record<string, string> = {
        // ===== CUSTOMER DETAILS =====
        customer_name: customer?.name || '',
        customer_email: customer?.email || '',
        customer_phone: customer?.phone || '',
        customer_type: customer?.customer_type || '',
        customer_id_number: customer?.id_number || '',
        customer_license_number: customer?.license_number || '',
        customer_address: customer?.address || '', // Note: May not exist in all setups
        // Next of Kin
        nok_name: customer?.nok_full_name || '',
        nok_phone: customer?.nok_phone || '',
        nok_email: customer?.nok_email || '',
        nok_address: customer?.nok_address || '',
        nok_relationship: customer?.nok_relationship || '',

        // ===== VEHICLE DETAILS =====
        vehicle_make: vehicle?.make || '',
        vehicle_model: vehicle?.model || '',
        vehicle_year: vehicle?.year?.toString() || '',
        vehicle_reg: vehicle?.reg || '',
        vehicle_color: vehicle?.color || vehicle?.colour || '',
        vehicle_fuel_type: vehicle?.fuel_type || '',
        vehicle_description: vehicle?.description || '',
        vehicle_daily_rent: formatCurrency(vehicle?.daily_rent, cc),
        vehicle_weekly_rent: formatCurrency(vehicle?.weekly_rent, cc),
        vehicle_monthly_rent: formatCurrency(vehicle?.monthly_rent, cc),

        // ===== RENTAL DETAILS =====
        rental_number: rental?.rental_number || rental?.id?.substring(0, 8)?.toUpperCase() || '',
        rental_id: rental?.id || '',
        rental_start_date: formatDate(rental?.start_date),
        rental_end_date: rental?.end_date ? formatDate(rental.end_date) : 'Ongoing',
        monthly_amount: formatCurrency(rental?.monthly_amount, cc),
        rental_amount: formatCurrency(rental?.monthly_amount, cc), // Alias
        rental_period_type: rental?.rental_period_type || 'Monthly',
        pickup_location: rental?.pickup_location || '',
        return_location: rental?.return_location || '',
        pickup_time: rental?.pickup_time || '',
        return_time: rental?.return_time || '',
        promo_code: rental?.promo_code || '',

        // ===== COMPANY/TENANT DETAILS =====
        company_name: tenant?.company_name || 'Drive 247',
        company_email: tenant?.contact_email || '',
        company_phone: tenant?.contact_phone || tenant?.phone || '',
        company_address: tenant?.address || '',
        admin_name: tenant?.admin_name || '',
        admin_email: tenant?.admin_email || '',

        // ===== DATES =====
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

// Convert HTML to plain text
function htmlToText(html: string): string {
    return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
        .replace(/<hr\s*\/?>/gi, '\n' + '='.repeat(70) + '\n')
        .replace(/<\/td>/gi, ' | ')
        .replace(/<li>/gi, '• ')
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

// Generate default agreement
function generateDefaultAgreement(rental: any, customer: any, vehicle: any, tenant: any): string {
    const companyName = tenant?.company_name || 'Drive 247';
    const cc = tenant?.currency_code || 'GBP';

    return `
RENTAL AGREEMENT
${'='.repeat(70)}

Date: ${formatDate(new Date())}
Reference: ${rental?.id?.substring(0, 8)?.toUpperCase() || 'N/A'}

${'='.repeat(70)}

LANDLORD: ${companyName}
${tenant?.contact_email || ''} | ${tenant?.contact_phone || ''}

${'='.repeat(70)}

CUSTOMER:
Name: ${customer?.name || 'Customer'}
Email: ${customer?.email || 'N/A'}
Phone: ${customer?.phone || ''}

${'='.repeat(70)}

VEHICLE:
Registration: ${vehicle?.reg || 'N/A'}
Make & Model: ${vehicle?.make || ''} ${vehicle?.model || ''}

${'='.repeat(70)}

RENTAL TERMS:
Start Date: ${formatDate(rental?.start_date)}
End Date: ${rental?.end_date ? formatDate(rental.end_date) : 'Ongoing'}
Amount: ${formatCurrency(rental?.monthly_amount, cc)}

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

// Create JWT for DocuSign
function createJWT(): string {
    const privateKey = DOCUSIGN_PRIVATE_KEY.replace(/\\n/g, '\n');
    const isDemo = DOCUSIGN_BASE_URL.includes('demo');
    const authServer = isDemo ? 'account-d.docusign.com' : 'account.docusign.com';

    const now = Math.floor(Date.now() / 1000);

    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
        iss: DOCUSIGN_INTEGRATION_KEY,
        sub: DOCUSIGN_USER_ID,
        iat: now,
        exp: now + 3600,
        aud: authServer,
        scope: 'signature impersonation'
    };

    const headerB64 = base64url(JSON.stringify(header));
    const payloadB64 = base64url(JSON.stringify(payload));
    const unsignedToken = `${headerB64}.${payloadB64}`;

    const sign = crypto.createSign('RSA-SHA256');
    sign.update(unsignedToken);
    const signature = sign.sign(privateKey);

    return `${unsignedToken}.${base64url(signature)}`;
}

// Get access token
async function getAccessToken(): Promise<string | null> {
    try {
        console.log('Getting DocuSign access token...');

        const isDemo = DOCUSIGN_BASE_URL.includes('demo');
        const authServer = isDemo ? 'account-d.docusign.com' : 'account.docusign.com';

        const jwt = createJWT();
        console.log('JWT created, length:', jwt.length);

        const response = await fetch(`https://${authServer}/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
        });

        const text = await response.text();

        if (!response.ok) {
            console.error('Token exchange failed:', text);
            return null;
        }

        const data = JSON.parse(text);
        console.log('Access token obtained!');
        return data.access_token;

    } catch (error) {
        console.error('getAccessToken error:', error);
        return null;
    }
}

// Get user account info (dynamic account ID discovery)
async function getUserInfo(accessToken: string): Promise<{ accountId: string; baseUrl: string } | null> {
    try {
        console.log('Fetching user info...');
        const isDemo = DOCUSIGN_BASE_URL.includes('demo');
        const authServer = isDemo ? 'account-d.docusign.com' : 'account.docusign.com';

        const response = await fetch(`https://${authServer}/oauth/userinfo`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (!response.ok) {
            console.error('UserInfo failed:', response.status);
            return null;
        }

        const data = await response.json();
        const account = data.accounts?.find((a: any) => a.is_default) || data.accounts?.[0];

        if (!account) {
            console.error('No accounts found');
            return null;
        }

        console.log('Using Account:', account.account_name, `(${account.account_id})`);
        return {
            accountId: account.account_id,
            baseUrl: `${account.base_uri}/restapi`
        };
    } catch (error) {
        console.error('getUserInfo error:', error);
        return null;
    }
}

// Create and send envelope
async function createEnvelope(
    accessToken: string,
    accountInfo: { accountId: string; baseUrl: string },
    documentBase64: string,
    customerEmail: string,
    customerName: string,
    rentalId: string
): Promise<string | null> {
    try {
        console.log('Creating envelope...');

        // Webhook URL - Supabase Edge Function
        const webhookUrl = `${supabaseUrl}/functions/v1/docusign-webhook`;
        console.log('Webhook URL:', webhookUrl);

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
                        }]
                    }
                }]
            },
            status: 'sent',
            // Envelope-level webhook - no dashboard config needed!
            eventNotification: {
                url: webhookUrl,
                loggingEnabled: true,
                requireAcknowledgment: true,
                envelopeEvents: [
                    { envelopeEventStatusCode: 'sent' },
                    { envelopeEventStatusCode: 'delivered' },
                    { envelopeEventStatusCode: 'completed' },
                    { envelopeEventStatusCode: 'declined' },
                    { envelopeEventStatusCode: 'voided' }
                ],
                recipientEvents: [
                    { recipientEventStatusCode: 'Sent' },
                    { recipientEventStatusCode: 'Delivered' },
                    { recipientEventStatusCode: 'Completed' },
                    { recipientEventStatusCode: 'Declined' }
                ]
            }
        };

        const response = await fetch(
            `${accountInfo.baseUrl}/v2.1/accounts/${accountInfo.accountId}/envelopes`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(envelope)
            }
        );

        const text = await response.text();
        console.log('Envelope response:', response.status);

        if (!response.ok) {
            console.error('Envelope creation failed:', text);
            return { error: text, status: response.status };
        }

        const result = JSON.parse(text);
        console.log('Envelope ID:', result.envelopeId);
        return { envelopeId: result.envelopeId };

    } catch (error: any) {
        console.error('createEnvelope error:', error);
        return { error: error?.message || 'Unknown error' };
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json() as EnvelopeRequest;

        console.log('='.repeat(50));
        console.log('DOCUSIGN API - DIRECT IMPLEMENTATION');
        console.log('='.repeat(50));
        console.log('Rental ID:', body.rentalId);
        console.log('Customer:', body.customerName, body.customerEmail);

        if (!body.rentalId || !body.customerEmail || !body.customerName) {
            return NextResponse.json({ ok: false, error: 'Missing required fields' }, { status: 400 });
        }

        if (!DOCUSIGN_INTEGRATION_KEY || !DOCUSIGN_PRIVATE_KEY || !DOCUSIGN_USER_ID) {
            console.error('DocuSign configuration missing');
            return NextResponse.json({ ok: false, error: 'DocuSign not configured' }, { status: 500 });
        }

        // Initialize Supabase to fetch rental data and admin template
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Fetch rental with related data - fetch all fields for template variables
        const { data: rental, error: rentalError } = await supabase
            .from('rentals')
            .select(`
        *,
        customers:customer_id (*),
        vehicles:vehicle_id (*)
      `)
            .eq('id', body.rentalId)
            .single();

        let customer: { name: string; email: string; phone?: string } = { name: body.customerName, email: body.customerEmail };
        let vehicle: { make?: string; model?: string; reg: string; year?: string } = { make: '', model: '', reg: 'N/A' };
        let tenant: { company_name?: string; contact_email?: string; contact_phone?: string } | null = null;

        // Priority for tenant ID: 1) Passed from frontend, 2) From rental, 3) From vehicle
        let tenantId: string | null = body.tenantId || null;

        if (!rentalError && rental) {
            customer = rental.customers || customer;
            vehicle = rental.vehicles || vehicle;

            // Use rental's tenant_id if not passed from frontend
            if (!tenantId && rental.tenant_id) {
                tenantId = rental.tenant_id;
            }
        }

        // Fallback: Get tenant from vehicle if still no tenantId
        if (!tenantId && body.vehicleId) {
            console.log('Looking up tenant from vehicle:', body.vehicleId);
            const { data: vehicleData } = await supabase
                .from('vehicles')
                .select('tenant_id')
                .eq('id', body.vehicleId)
                .single();
            if (vehicleData?.tenant_id) {
                tenantId = vehicleData.tenant_id;
                console.log('Got tenant from vehicle:', tenantId);
            }
        }

        // Fetch tenant info if we have an ID - fetch all fields for template variables
        if (tenantId) {
            const { data: tenantData } = await supabase
                .from('tenants')
                .select('company_name, contact_email, contact_phone, phone, address, admin_name, admin_email, currency_code')
                .eq('id', tenantId)
                .single();
            tenant = tenantData;
        }

        // Try to get admin's custom template
        let documentContent: string;

        console.log('='.repeat(50));
        console.log('TEMPLATE LOOKUP');
        console.log('='.repeat(50));
        console.log('Tenant ID:', tenantId);
        console.log('Rental tenant_id:', rental?.tenant_id);

        if (tenantId) {
            console.log('Fetching template for tenant:', tenantId);

            const { data: templateData, error: templateError } = await supabase
                .from('agreement_templates')
                .select('template_content, template_name, is_active')
                .eq('tenant_id', tenantId)
                .eq('is_active', true)
                .single();

            console.log('Template query result:');
            console.log('  - Error:', templateError?.message || 'none');
            console.log('  - Found:', templateData ? 'YES' : 'NO');
            console.log('  - Template name:', templateData?.template_name || 'N/A');
            console.log('  - Content length:', templateData?.template_content?.length || 0);

            if (templateData?.template_content) {
                console.log('✅ Using admin custom template:', templateData.template_name);
                const processed = processTemplate(templateData.template_content, rental, customer, vehicle, tenant);
                documentContent = htmlToText(processed);
                console.log('Processed content length:', documentContent.length);
            } else {
                console.log('❌ No active template found, using default');
                documentContent = generateDefaultAgreement(rental, customer, vehicle, tenant);
            }
        } else {
            console.log('❌ No tenant ID on rental, using default template');
            documentContent = generateDefaultAgreement(
                { id: body.rentalId, start_date: new Date(), monthly_amount: 0 },
                customer,
                vehicle,
                {}
            );
        }

        const documentBase64 = Buffer.from(documentContent).toString('base64');

        // 1. Get Access Token
        const accessToken = await getAccessToken();
        if (!accessToken) {
            const consentUrl = `https://account-d.docusign.com/oauth/auth?response_type=code&scope=signature%20impersonation&client_id=${DOCUSIGN_INTEGRATION_KEY}&redirect_uri=https://developers.docusign.com/platform/auth/consent`;
            return NextResponse.json(
                { ok: false, error: 'DocuSign auth failed', detail: `Consent required: ${consentUrl}` },
                { status: 401 }
            );
        }

        // 2. Get user account info (dynamic account ID)
        const accountInfo = await getUserInfo(accessToken);
        if (!accountInfo) {
            return NextResponse.json(
                { ok: false, error: 'Failed to get DocuSign account info' },
                { status: 500 }
            );
        }

        // 3. Create Envelope
        const envelopeResult = await createEnvelope(
            accessToken,
            accountInfo,
            documentBase64,
            body.customerEmail,
            body.customerName,
            body.rentalId
        );

        if (!envelopeResult || envelopeResult.error) {
            return NextResponse.json({
                ok: false,
                error: 'Failed to create envelope',
                detail: envelopeResult?.error || 'Unknown error'
            }, { status: 500 });
        }

        const envelopeId = envelopeResult.envelopeId;

        // 4. Update rental with DocuSign info
        console.log('Updating rental with DocuSign envelope info...');
        const { error: updateError } = await supabase
            .from('rentals')
            .update({
                docusign_envelope_id: envelopeId,
                document_status: 'sent',
                envelope_created_at: new Date().toISOString(),
                envelope_sent_at: new Date().toISOString(),
            })
            .eq('id', body.rentalId);

        if (updateError) {
            console.error('Failed to update rental with envelope info:', updateError);
            // Don't fail the request - envelope was still created
        } else {
            console.log('✅ Rental updated with DocuSign status');
        }

        console.log('='.repeat(50));
        console.log('SUCCESS! Envelope:', envelopeId);
        console.log('='.repeat(50));

        return NextResponse.json({ ok: true, envelopeId, emailSent: true });

    } catch (error: any) {
        console.error('API Error:', error);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
}
