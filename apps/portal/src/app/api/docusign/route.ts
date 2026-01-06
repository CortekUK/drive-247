import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

// DocuSign configuration
const DOCUSIGN_INTEGRATION_KEY = process.env.DOCUSIGN_INTEGRATION_KEY || '';
const DOCUSIGN_USER_ID = process.env.DOCUSIGN_USER_ID || '';
const DOCUSIGN_PRIVATE_KEY = process.env.DOCUSIGN_PRIVATE_KEY || '';
const DOCUSIGN_BASE_URL = process.env.DOCUSIGN_BASE_URL || 'https://demo.docusign.net/restapi';

// Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

interface DocuSignRequest {
    rentalId: string;
    customerEmail: string;
    customerName: string;
    tenantId: string;
}

// Base64URL encode
function base64url(input: string | Buffer): string {
    const base64 = Buffer.isBuffer(input) ? input.toString('base64') : Buffer.from(input).toString('base64');
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Format helpers
function formatDate(date: string | Date | null): string {
    if (!date) return 'N/A';
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatCurrency(amount: number | null): string {
    if (amount === null || amount === undefined) return '$0';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

// Process template variables - ALL AVAILABLE VARIABLES
function processTemplate(template: string, rental: any, customer: any, vehicle: any, tenant: any): string {
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
        vehicle_daily_rent: formatCurrency(vehicle?.daily_rent),
        vehicle_weekly_rent: formatCurrency(vehicle?.weekly_rent),
        vehicle_monthly_rent: formatCurrency(vehicle?.monthly_rent),

        // ===== RENTAL DETAILS =====
        rental_number: rental?.rental_number || rental?.id?.substring(0, 8)?.toUpperCase() || '',
        rental_id: rental?.id || '',
        rental_start_date: formatDate(rental?.start_date),
        rental_end_date: rental?.end_date ? formatDate(rental.end_date) : 'Ongoing',
        monthly_amount: formatCurrency(rental?.monthly_amount),
        rental_amount: formatCurrency(rental?.monthly_amount), // Alias
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

// HTML to text
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

// Default agreement
function generateDefaultAgreement(rental: any, customer: any, vehicle: any, tenant: any): string {
    const companyName = tenant?.company_name || 'Drive 247';
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
Amount: ${formatCurrency(rental?.monthly_amount)}

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

// JWT creation
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
        const isDemo = DOCUSIGN_BASE_URL.includes('demo');
        const authServer = isDemo ? 'account-d.docusign.com' : 'account.docusign.com';
        const jwt = createJWT();

        const response = await fetch(`https://${authServer}/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
        });

        if (!response.ok) return null;
        const data = await response.json();
        return data.access_token;
    } catch {
        return null;
    }
}

// Get user account info
async function getUserInfo(accessToken: string): Promise<{ accountId: string; baseUrl: string } | null> {
    try {
        const isDemo = DOCUSIGN_BASE_URL.includes('demo');
        const authServer = isDemo ? 'account-d.docusign.com' : 'account.docusign.com';

        const response = await fetch(`https://${authServer}/oauth/userinfo`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (!response.ok) return null;
        const data = await response.json();
        const account = data.accounts?.find((a: any) => a.is_default) || data.accounts?.[0];

        if (!account) return null;
        return { accountId: account.account_id, baseUrl: `${account.base_uri}/restapi` };
    } catch {
        return null;
    }
}

// Create envelope
async function createEnvelope(
    accessToken: string,
    accountInfo: { accountId: string; baseUrl: string },
    documentBase64: string,
    email: string,
    name: string,
    rentalId: string
): Promise<string | null> {
    try {
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
                    email,
                    name,
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
            status: 'sent'
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

        if (!response.ok) return null;
        const result = await response.json();
        return result.envelopeId;
    } catch {
        return null;
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json() as DocuSignRequest;

        console.log('='.repeat(50));
        console.log('PORTAL DOCUSIGN API');
        console.log('='.repeat(50));
        console.log('Rental ID:', body.rentalId);
        console.log('Customer:', body.customerName, body.customerEmail);
        console.log('Tenant ID:', body.tenantId);

        if (!body.rentalId || !body.customerEmail || !body.customerName) {
            return NextResponse.json({ ok: false, error: 'Missing required fields' }, { status: 400 });
        }

        if (!DOCUSIGN_INTEGRATION_KEY || !DOCUSIGN_PRIVATE_KEY || !DOCUSIGN_USER_ID) {
            return NextResponse.json({ ok: false, error: 'DocuSign not configured' }, { status: 500 });
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

        // Fetch tenant - fetch all fields for template variables
        let tenant = null;
        if (body.tenantId) {
            const { data: tenantData } = await supabase
                .from('tenants')
                .select('company_name, contact_email, contact_phone, phone, address, admin_name, admin_email')
                .eq('id', body.tenantId)
                .single();
            tenant = tenantData;
        }

        // Fetch template
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
                documentContent = htmlToText(processTemplate(templateData.template_content, rental, customer, vehicle, tenant));
            } else {
                console.log('Using default template');
                documentContent = generateDefaultAgreement(rental, customer, vehicle, tenant);
            }
        } else {
            documentContent = generateDefaultAgreement(rental, customer, vehicle, tenant);
        }

        const documentBase64 = Buffer.from(documentContent).toString('base64');

        // Get access token
        const accessToken = await getAccessToken();
        if (!accessToken) {
            return NextResponse.json({
                ok: false,
                error: 'DocuSign auth failed',
                detail: `Consent required: https://account-d.docusign.com/oauth/auth?response_type=code&scope=signature%20impersonation&client_id=${DOCUSIGN_INTEGRATION_KEY}&redirect_uri=https://developers.docusign.com/platform/auth/consent`
            }, { status: 401 });
        }

        // Get account info
        const accountInfo = await getUserInfo(accessToken);
        if (!accountInfo) {
            return NextResponse.json({ ok: false, error: 'Failed to get DocuSign account' }, { status: 500 });
        }

        // Create envelope
        const envelopeId = await createEnvelope(
            accessToken,
            accountInfo,
            documentBase64,
            body.customerEmail,
            body.customerName,
            body.rentalId
        );

        if (!envelopeId) {
            return NextResponse.json({ ok: false, error: 'Failed to create envelope' }, { status: 500 });
        }

        // Update rental with DocuSign info
        console.log('Updating rental with envelope info...');
        await supabase
            .from('rentals')
            .update({
                docusign_envelope_id: envelopeId,
                document_status: 'sent',
                envelope_created_at: new Date().toISOString(),
                envelope_sent_at: new Date().toISOString(),
            })
            .eq('id', body.rentalId);

        console.log('SUCCESS! Envelope:', envelopeId);
        return NextResponse.json({ ok: true, envelopeId, emailSent: true });

    } catch (error: any) {
        console.error('API Error:', error);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
}
