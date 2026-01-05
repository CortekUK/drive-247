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

// Base64URL encode
function base64url(input: string | Buffer): string {
    const base64 = Buffer.isBuffer(input) ? input.toString('base64') : Buffer.from(input).toString('base64');
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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

// Map DocuSign envelope status to our document_status
function mapEnvelopeStatus(status: string): string {
    const statusMap: Record<string, string> = {
        'created': 'pending',
        'sent': 'sent',
        'delivered': 'delivered',
        'signed': 'signed',
        'completed': 'signed',
        'declined': 'declined',
        'voided': 'voided',
    };
    return statusMap[status.toLowerCase()] || status.toLowerCase();
}

export async function POST(request: NextRequest) {
    try {
        const { rentalId, envelopeId } = await request.json();

        console.log('='.repeat(50));
        console.log('CHECKING DOCUSIGN STATUS');
        console.log('='.repeat(50));
        console.log('Rental ID:', rentalId);
        console.log('Envelope ID:', envelopeId);

        if (!envelopeId) {
            return NextResponse.json({ ok: false, error: 'No envelope ID provided' }, { status: 400 });
        }

        if (!DOCUSIGN_INTEGRATION_KEY || !DOCUSIGN_PRIVATE_KEY || !DOCUSIGN_USER_ID) {
            return NextResponse.json({ ok: false, error: 'DocuSign not configured' }, { status: 500 });
        }

        // Get access token
        const accessToken = await getAccessToken();
        if (!accessToken) {
            return NextResponse.json({ ok: false, error: 'DocuSign auth failed' }, { status: 401 });
        }

        // Get account info
        const accountInfo = await getUserInfo(accessToken);
        if (!accountInfo) {
            return NextResponse.json({ ok: false, error: 'Failed to get DocuSign account' }, { status: 500 });
        }

        // Get envelope status from DocuSign
        console.log('Fetching envelope status from DocuSign...');
        const envelopeResponse = await fetch(
            `${accountInfo.baseUrl}/v2.1/accounts/${accountInfo.accountId}/envelopes/${envelopeId}`,
            {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );

        if (!envelopeResponse.ok) {
            const errorText = await envelopeResponse.text();
            console.error('DocuSign API error:', errorText);
            return NextResponse.json({ ok: false, error: 'Failed to get envelope status' }, { status: 500 });
        }

        const envelopeData = await envelopeResponse.json();
        console.log('Envelope status from DocuSign:', envelopeData.status);
        console.log('Status changed:', envelopeData.statusChangedDateTime);

        // Map to our status
        const newStatus = mapEnvelopeStatus(envelopeData.status);
        console.log('Mapped status:', newStatus);

        // Update database if we have rentalId
        if (rentalId) {
            const supabase = createClient(supabaseUrl, supabaseServiceKey);

            const updateData: Record<string, any> = {
                document_status: newStatus,
            };

            // Set completion timestamp if signed
            if (newStatus === 'signed' && envelopeData.completedDateTime) {
                updateData.envelope_completed_at = envelopeData.completedDateTime;
            }

            const { error: updateError } = await supabase
                .from('rentals')
                .update(updateData)
                .eq('id', rentalId);

            if (updateError) {
                console.error('Failed to update rental:', updateError);
            } else {
                console.log('✅ Rental status updated to:', newStatus);
            }
        }

        console.log('='.repeat(50));

        return NextResponse.json({
            ok: true,
            status: newStatus,
            docusignStatus: envelopeData.status,
            statusChangedDateTime: envelopeData.statusChangedDateTime,
            completedDateTime: envelopeData.completedDateTime,
        });

    } catch (error: any) {
        console.error('Status check error:', error);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
}
