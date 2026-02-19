import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// BoldSign configuration
const BOLDSIGN_API_KEY = process.env.BOLDSIGN_API_KEY || '';
const BOLDSIGN_BASE_URL = process.env.BOLDSIGN_BASE_URL || 'https://api.boldsign.com';

// Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

interface SignRequest {
  rentalId: string;
  returnUrl?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as SignRequest;

    console.log('='.repeat(50));
    console.log('ESIGN SIGN API (BoldSign) - Generate Signing URL');
    console.log('='.repeat(50));
    console.log('Rental ID:', body.rentalId);

    if (!body.rentalId) {
      return NextResponse.json({ ok: false, error: 'Missing rental ID' }, { status: 400 });
    }

    if (!BOLDSIGN_API_KEY) {
      return NextResponse.json({ ok: false, error: 'BoldSign not configured' }, { status: 500 });
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
      return NextResponse.json({ ok: false, error: 'No document for this rental' }, { status: 400 });
    }

    // Check if already signed
    if (rental.document_status === 'completed' || rental.document_status === 'signed') {
      return NextResponse.json({ ok: false, error: 'Document already signed' }, { status: 400 });
    }

    const customer = rental.customers as any;
    if (!customer?.email || !customer?.name) {
      return NextResponse.json({ ok: false, error: 'Customer info not found' }, { status: 400 });
    }

    // Default return URL
    const returnUrl = body.returnUrl || `${request.headers.get('origin')}/portal/agreements?signed=true`;

    // Get embedded signing link from BoldSign
    console.log('Getting embedded signing link from BoldSign...');
    const signLinkResponse = await fetch(
      `${BOLDSIGN_BASE_URL}/v1/document/getEmbeddedSignLink?documentId=${rental.docusign_envelope_id}&signerEmail=${encodeURIComponent(customer.email)}&redirectUrl=${encodeURIComponent(returnUrl)}`,
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
