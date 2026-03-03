import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// BoldSign configuration — resolved per-request based on tenant mode
const BOLDSIGN_BASE_URL = process.env.BOLDSIGN_BASE_URL || 'https://api.boldsign.com';

function getBoldSignApiKey(mode: 'test' | 'live'): string {
    return mode === 'live'
        ? (process.env.BOLDSIGN_LIVE_API_KEY || '')
        : (process.env.BOLDSIGN_TEST_API_KEY || '');
}

// Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

interface SignRequest {
  rentalId: string;
  returnUrl?: string;
  agreementId?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as SignRequest;

    console.log('='.repeat(50));
    console.log('ESIGN SIGN API (BoldSign) - Generate Signing URL');
    console.log('='.repeat(50));
    console.log('Rental ID:', body.rentalId, 'Agreement ID:', body.agreementId);

    if (!body.rentalId && !body.agreementId) {
      return NextResponse.json({ ok: false, error: 'Missing rental ID or agreement ID' }, { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let envelopeId: string | null = null;
    let boldsignMode: 'test' | 'live' = 'test';
    let documentStatus: string | null = null;
    let customerEmail: string | null = null;
    let customerName: string | null = null;

    // If agreementId provided, look up from rental_agreements
    if (body.agreementId) {
      const { data: agreement } = await supabase
        .from('rental_agreements')
        .select('document_id, boldsign_mode, document_status, rental_id')
        .eq('id', body.agreementId)
        .single();

      if (agreement) {
        envelopeId = agreement.document_id;
        documentStatus = agreement.document_status;
        if (agreement.boldsign_mode) boldsignMode = agreement.boldsign_mode as 'test' | 'live';
      }
    }

    // Fetch rental with customer info
    const { data: rental, error: rentalError } = await supabase
      .from('rentals')
      .select(`
        id,
        docusign_envelope_id,
        document_status,
        boldsign_mode,
        tenant_id,
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

    // Use rental's envelope if not found from agreement
    if (!envelopeId) envelopeId = rental.docusign_envelope_id;
    if (!documentStatus) documentStatus = rental.document_status;

    if (!envelopeId) {
      return NextResponse.json({ ok: false, error: 'No document for this rental' }, { status: 400 });
    }

    // Check if already signed
    if (documentStatus === 'completed' || documentStatus === 'signed') {
      return NextResponse.json({ ok: false, error: 'Document already signed' }, { status: 400 });
    }

    const customer = rental.customers as any;
    if (!customer?.email || !customer?.name) {
      return NextResponse.json({ ok: false, error: 'Customer info not found' }, { status: 400 });
    }

    // Resolve BoldSign mode from rental if not set
    if (boldsignMode === 'test' && rental.boldsign_mode) {
      boldsignMode = rental.boldsign_mode as 'test' | 'live';
    }
    if (boldsignMode === 'test' && rental.tenant_id) {
      const { data: tenantData } = await supabase
        .from('tenants')
        .select('boldsign_mode')
        .eq('id', rental.tenant_id)
        .single();
      if (tenantData?.boldsign_mode) boldsignMode = tenantData.boldsign_mode as 'test' | 'live';
    }

    const BOLDSIGN_API_KEY = getBoldSignApiKey(boldsignMode);
    if (!BOLDSIGN_API_KEY) {
      return NextResponse.json({ ok: false, error: 'BoldSign not configured' }, { status: 500 });
    }

    // Default return URL
    const returnUrl = body.returnUrl || `${request.headers.get('origin')}/portal/agreements?signed=true`;

    // Get embedded signing link from BoldSign
    console.log('Getting embedded signing link from BoldSign... (mode:', boldsignMode, ')');
    const signLinkResponse = await fetch(
      `${BOLDSIGN_BASE_URL}/v1/document/getEmbeddedSignLink?documentId=${envelopeId}&signerEmail=${encodeURIComponent(customer.email)}&redirectUrl=${encodeURIComponent(returnUrl)}`,
      {
        headers: { 'X-API-KEY': BOLDSIGN_API_KEY },
      }
    );

    if (!signLinkResponse.ok) {
      const errorText = await signLinkResponse.text();
      console.error('BoldSign embedded sign link failed:', signLinkResponse.status, errorText);

      // Fall back to email-based signing
      return NextResponse.json({
        ok: false,
        error: 'Please check your email for the signing link',
        emailSent: true,
      }, { status: 200 });
    }

    const signLinkData = await signLinkResponse.json();

    if (signLinkData.signLink) {
      console.log('Signing URL generated successfully');
      return NextResponse.json({ ok: true, signingUrl: signLinkData.signLink });
    }

    // Fallback to email
    return NextResponse.json({
      ok: false,
      error: 'Please check your email for the signing link',
      emailSent: true,
    }, { status: 200 });

  } catch (error: any) {
    console.error('Sign API Error:', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
