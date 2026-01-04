import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

// Supabase client for updating rental status
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// DocuSign configuration
const DOCUSIGN_INTEGRATION_KEY = process.env.DOCUSIGN_INTEGRATION_KEY || '';
const DOCUSIGN_USER_ID = process.env.DOCUSIGN_USER_ID || '';
const DOCUSIGN_PRIVATE_KEY = process.env.DOCUSIGN_PRIVATE_KEY || '';
// Base URL is only used for initial auth server determination
const DOCUSIGN_BASE_URL = process.env.DOCUSIGN_BASE_URL || 'https://demo.docusign.net/restapi';

interface EnvelopeRequest {
    rentalId: string;
    customerEmail: string;
    customerName: string;
    vehicleName?: string;
    amount?: number;
}

// Base64URL encode
function base64url(input: string | Buffer): string {
    const base64 = Buffer.isBuffer(input) ? input.toString('base64') : Buffer.from(input).toString('base64');
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Generate rental agreement document
function generateAgreement(data: EnvelopeRequest): string {
    const text = `
RENTAL AGREEMENT
================

Date: ${new Date().toLocaleDateString()}
Reference: ${data.rentalId}

CUSTOMER:
Name: ${data.customerName}
Email: ${data.customerEmail}

VEHICLE: ${data.vehicleName || 'As per booking'}
AMOUNT: $${data.amount || 0}

TERMS:
1. Customer agrees to rental terms.
2. Customer is responsible for vehicle during rental.
3. Return vehicle in same condition.

SIGNATURE:

Customer Signature: _________________________

Date: ______________


Drive 247 - Generated ${new Date().toISOString()}
`;
    return Buffer.from(text).toString('base64');
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

    // Sign with RSA-SHA256
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(unsignedToken);
    const signature = sign.sign(privateKey);

    return `${unsignedToken}.${base64url(signature)}`;
}

// Get access token from DocuSign
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
        // console.log('Token response:', response.status, text.substring(0, 200));

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

// Get User Info to find correct Account ID and Base URL
async function getUserInfo(accessToken: string): Promise<{ accountId: string; baseUrl: string } | null> {
    try {
        console.log('Fetching user info...');
        const isDemo = DOCUSIGN_BASE_URL.includes('demo');
        const authServer = isDemo ? 'account-d.docusign.com' : 'account.docusign.com';

        const response = await fetch(`https://${authServer}/oauth/userinfo`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (!response.ok) {
            console.error('UserInfo failed:', response.status, await response.text());
            return null;
        }

        const data = await response.json();
        console.log('UserInfo received for:', data.name);

        // Find the account that matches our expected environment or just use default
        // DocuSign returns an array of accounts. We need the one that matches our credentials.
        // Usually the default one is safe.
        const account = data.accounts.find((a: any) => a.is_default) || data.accounts[0];

        if (!account) {
            console.error('No accounts found for user');
            return null;
        }

        console.log('Using Account:', account.account_name, `(${account.account_id})`);
        console.log('Base URI:', account.base_uri);

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
async function createEnvelope(accessToken: string, accountInfo: { accountId: string; baseUrl: string }, data: EnvelopeRequest): Promise<string | null> {
    try {
        console.log('Creating envelope...');
        const { accountId, baseUrl } = accountInfo;

        const envelope = {
            emailSubject: `Rental Agreement - ${data.rentalId.substring(0, 8)}`,
            documents: [{
                documentBase64: generateAgreement(data),
                name: 'Rental Agreement.txt',
                fileExtension: 'txt',
                documentId: '1'
            }],
            recipients: {
                signers: [{
                    email: data.customerEmail,
                    name: data.customerName,
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

        const text = await response.text();
        console.log('Envelope response:', response.status);

        if (!response.ok) {
            console.error('Envelope creation failed:', text);
            return null;
        }

        const result = JSON.parse(text);
        console.log('Envelope ID:', result.envelopeId);
        return result.envelopeId;

    } catch (error) {
        console.error('createEnvelope error:', error);
        return null;
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json() as EnvelopeRequest;

        console.log('='.repeat(50));
        console.log('DOCUSIGN API - CREATE ENVELOPE (DYNAMIC ACCOUNT)');
        console.log('='.repeat(50));
        console.log('Customer:', body.customerName, body.customerEmail);

        if (!body.rentalId || !body.customerEmail || !body.customerName) {
            return NextResponse.json({ ok: false, error: 'Missing required fields' }, { status: 400 });
        }

        if (!DOCUSIGN_INTEGRATION_KEY || !DOCUSIGN_PRIVATE_KEY) {
            return NextResponse.json({ ok: false, error: 'DocuSign not configured' }, { status: 500 });
        }

        // 1. Get Access Token
        const accessToken = await getAccessToken();
        if (!accessToken) {
            const consentUrl = `https://account-d.docusign.com/oauth/auth?response_type=code&scope=signature%20impersonation&client_id=${DOCUSIGN_INTEGRATION_KEY}&redirect_uri=https://developers.docusign.com/platform/auth/consent`;
            return NextResponse.json(
                { ok: false, error: 'DocuSign auth failed', detail: `Check JWT consent: ${consentUrl}` },
                { status: 401 }
            );
        }

        // 2. Discover User Account Info (Account ID & Base URL)
        const accountInfo = await getUserInfo(accessToken);
        if (!accountInfo) {
            return NextResponse.json(
                { ok: false, error: 'Failed to retrieve DocuSign account info' },
                { status: 500 }
            );
        }

        // 3. Create Envelope
        const envelopeId = await createEnvelope(accessToken, accountInfo, body);
        if (!envelopeId) {
            return NextResponse.json({ ok: false, error: 'Failed to create envelope' }, { status: 500 });
        }

        // 4. Update rental record with DocuSign status
        if (supabaseUrl && supabaseServiceKey) {
            try {
                const supabase = createClient(supabaseUrl, supabaseServiceKey);
                const { error: updateError } = await supabase
                    .from('rentals')
                    .update({
                        document_status: 'sent'
                    })
                    .eq('id', body.rentalId);

                if (updateError) {
                    console.error('Failed to update rental document_status:', updateError);
                } else {
                    console.log('Rental document_status updated to "sent"');
                }
            } catch (dbError) {
                console.error('Database update error:', dbError);
            }
        }

        console.log('SUCCESS! Envelope:', envelopeId);
        return NextResponse.json({ ok: true, envelopeId, emailSent: true });

    } catch (error: any) {
        console.error('API Error:', error);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
}
