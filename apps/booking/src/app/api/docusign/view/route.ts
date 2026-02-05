import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const DOCUSIGN_INTEGRATION_KEY = process.env.DOCUSIGN_INTEGRATION_KEY || '';
const DOCUSIGN_USER_ID = process.env.DOCUSIGN_USER_ID || '';
const DOCUSIGN_PRIVATE_KEY = process.env.DOCUSIGN_PRIVATE_KEY || '';
const DOCUSIGN_BASE_URL = process.env.DOCUSIGN_BASE_URL || 'https://demo.docusign.net/restapi';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function base64url(input: string | Buffer): string {
    const base64 = Buffer.isBuffer(input) ? input.toString('base64') : Buffer.from(input).toString('base64');
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

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

export async function POST(request: NextRequest) {
    try {
        const { rentalId, envelopeId: providedEnvelopeId } = await request.json();

        if (!rentalId && !providedEnvelopeId) {
            return NextResponse.json({ ok: false, error: 'rentalId or envelopeId required' }, { status: 400 });
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        let envelopeId = providedEnvelopeId;

        // Get envelope ID from rental if not provided
        if (rentalId && !envelopeId) {
            const { data: rental, error } = await supabase
                .from('rentals')
                .select('docusign_envelope_id, signed_document_id')
                .eq('id', rentalId)
                .single();

            if (error || !rental) {
                return NextResponse.json({ ok: false, error: 'Rental not found' }, { status: 404 });
            }

            // If signed document exists, return its URL
            if (rental.signed_document_id) {
                const { data: doc } = await supabase
                    .from('customer_documents')
                    .select('file_url')
                    .eq('id', rental.signed_document_id)
                    .single();

                if (doc?.file_url) {
                    // Check if it's already a full URL
                    let documentUrl = doc.file_url;
                    if (!documentUrl.startsWith('http')) {
                        const { data: urlData } = supabase.storage
                            .from('customer-documents')
                            .getPublicUrl(doc.file_url);
                        documentUrl = urlData.publicUrl;
                    }

                    return NextResponse.json({
                        ok: true,
                        documentUrl,
                        status: 'completed',
                        source: 'stored'
                    });
                }
            }

            if (!rental.docusign_envelope_id) {
                return NextResponse.json({ ok: false, error: 'No DocuSign envelope for this rental' }, { status: 404 });
            }

            envelopeId = rental.docusign_envelope_id;
        }

        // Get DocuSign access token
        const accessToken = await getAccessToken();
        if (!accessToken) {
            return NextResponse.json({ ok: false, error: 'DocuSign auth failed' }, { status: 401 });
        }

        // Get account info
        const accountInfo = await getUserInfo(accessToken);
        if (!accountInfo) {
            return NextResponse.json({ ok: false, error: 'Failed to get DocuSign account' }, { status: 500 });
        }

        // Get envelope status
        const statusResponse = await fetch(
            `${accountInfo.baseUrl}/v2.1/accounts/${accountInfo.accountId}/envelopes/${envelopeId}`,
            { headers: { 'Authorization': `Bearer ${accessToken}` } }
        );

        if (!statusResponse.ok) {
            return NextResponse.json({ ok: false, error: 'Failed to get envelope status' }, { status: 500 });
        }

        const envelopeData = await statusResponse.json();

        // Download the combined document PDF
        const docResponse = await fetch(
            `${accountInfo.baseUrl}/v2.1/accounts/${accountInfo.accountId}/envelopes/${envelopeId}/documents/combined`,
            { headers: { 'Authorization': `Bearer ${accessToken}` } }
        );

        if (!docResponse.ok) {
            return NextResponse.json({ ok: false, error: 'Failed to get document from DocuSign' }, { status: 500 });
        }

        // Get the PDF as base64
        const pdfBuffer = await docResponse.arrayBuffer();
        const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');

        return NextResponse.json({
            ok: true,
            documentBase64: pdfBase64,
            contentType: 'application/pdf',
            status: envelopeData.status,
            source: 'docusign'
        });

    } catch (error: any) {
        console.error('View DocuSign Error:', error);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
}
