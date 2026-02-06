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

interface SignRequest {
  rentalId: string;
  returnUrl?: string;
}

// Base64URL encode
function base64url(input: string | Buffer): string {
  const base64 = Buffer.isBuffer(input) ? input.toString('base64') : Buffer.from(input).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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

// Create recipient view (embedded signing URL)
async function createRecipientView(
  accessToken: string,
  accountInfo: { accountId: string; baseUrl: string },
  envelopeId: string,
  signerEmail: string,
  signerName: string,
  returnUrl: string
): Promise<{ url?: string; error?: string }> {
  try {
    const recipientViewRequest = {
      authenticationMethod: 'none',
      email: signerEmail,
      userName: signerName,
      returnUrl: returnUrl,
      clientUserId: null // null for remote signers (email recipients)
    };

    const response = await fetch(
      `${accountInfo.baseUrl}/v2.1/accounts/${accountInfo.accountId}/envelopes/${envelopeId}/views/recipient`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(recipientViewRequest)
      }
    );

    const text = await response.text();

    if (!response.ok) {
      console.error('RecipientView failed:', text);
      // If recipient view fails (common for remote signers), try the correction view
      return { error: text };
    }

    const result = JSON.parse(text);
    return { url: result.url };
  } catch (error: any) {
    console.error('createRecipientView error:', error);
    return { error: error?.message || 'Unknown error' };
  }
}

// Get envelope recipients to find correct signing URL approach
async function getEnvelopeRecipients(
  accessToken: string,
  accountInfo: { accountId: string; baseUrl: string },
  envelopeId: string
): Promise<any> {
  try {
    const response = await fetch(
      `${accountInfo.baseUrl}/v2.1/accounts/${accountInfo.accountId}/envelopes/${envelopeId}/recipients`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        }
      }
    );

    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as SignRequest;

    console.log('='.repeat(50));
    console.log('DOCUSIGN SIGN API - Generate Signing URL');
    console.log('='.repeat(50));
    console.log('Rental ID:', body.rentalId);

    if (!body.rentalId) {
      return NextResponse.json({ ok: false, error: 'Missing rental ID' }, { status: 400 });
    }

    if (!DOCUSIGN_INTEGRATION_KEY || !DOCUSIGN_PRIVATE_KEY || !DOCUSIGN_USER_ID) {
      return NextResponse.json({ ok: false, error: 'DocuSign not configured' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch rental with customer info
    const { data: rental, error: rentalError } = await supabase
      .from('rentals')
      .select(`
        id,
        docusign_envelope_id,
        document_status,
        customers:customer_id (
          id,
          name,
          email
        )
      `)
      .eq('id', body.rentalId)
      .single();

    if (rentalError || !rental) {
      console.error('Rental not found:', rentalError);
      return NextResponse.json({ ok: false, error: 'Rental not found' }, { status: 404 });
    }

    if (!rental.docusign_envelope_id) {
      return NextResponse.json({ ok: false, error: 'No DocuSign envelope for this rental' }, { status: 400 });
    }

    // Check if already signed
    if (rental.document_status === 'completed' || rental.document_status === 'signed') {
      return NextResponse.json({ ok: false, error: 'Document already signed' }, { status: 400 });
    }

    const customer = rental.customers as any;
    if (!customer?.email || !customer?.name) {
      return NextResponse.json({ ok: false, error: 'Customer info not found' }, { status: 400 });
    }

    // Default return URL - customer portal agreements page
    const returnUrl = body.returnUrl || `${request.headers.get('origin')}/portal/agreements?signed=true`;

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

    // Try to create recipient view
    console.log('Creating recipient view for:', customer.email, customer.name);
    const viewResult = await createRecipientView(
      accessToken,
      accountInfo,
      rental.docusign_envelope_id,
      customer.email,
      customer.name,
      returnUrl
    );

    if (viewResult.url) {
      console.log('✅ Signing URL generated successfully');
      return NextResponse.json({ ok: true, signingUrl: viewResult.url });
    }

    // If recipient view fails (likely because it's a remote signer without clientUserId),
    // we need to provide an alternative - either resend email or show a message
    console.log('Recipient view failed, checking envelope status...');

    const recipients = await getEnvelopeRecipients(accessToken, accountInfo, rental.docusign_envelope_id);
    const signer = recipients?.signers?.[0];

    if (signer) {
      console.log('Signer status:', signer.status);

      // If the document was sent via email, we can't generate an embedded signing URL
      // Instead, suggest checking email or resending
      if (!signer.clientUserId) {
        return NextResponse.json({
          ok: false,
          error: 'Please check your email for the signing link from DocuSign',
          emailSent: true,
          signerStatus: signer.status
        }, { status: 200 });
      }
    }

    return NextResponse.json({
      ok: false,
      error: viewResult.error || 'Failed to generate signing URL'
    }, { status: 500 });

  } catch (error: any) {
    console.error('Sign API Error:', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
