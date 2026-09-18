import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isLeanTenant, readTenantOnV2ById } from '@/lib/lean-tenants';

// BoldSign configuration — resolved per-request based on tenant mode
const BOLDSIGN_BASE_URL = process.env.BOLDSIGN_BASE_URL || 'https://api.boldsign.com';

function getBoldSignApiKey(mode: 'test' | 'live'): string {
    return mode === 'live'
        ? (process.env.BOLDSIGN_LIVE_API_KEY || process.env.BOLDSIGN_API_KEY || '')
        : (process.env.BOLDSIGN_TEST_API_KEY || process.env.BOLDSIGN_API_KEY || '');
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
    /**
     * NULL means "not resolved yet", and that distinction is the whole point.
     *
     * This was `let boldsignMode: 'test' | 'live' = 'test'` and every later
     * step asked `if (boldsignMode === 'test' && …)` to mean "if nobody has
     * decided yet". But 'test' is also a LEGITIMATE resolved answer, so a
     * document genuinely created in test mode was indistinguishable from one
     * nothing had spoken for, and it fell through to the next step. The last of
     * those steps forces LIVE for a lean/v2 tenant — so a test-mode document
     * belonging to a v2 tenant was signed against the LIVE BoldSign account,
     * where its document id does not exist. The signer sees a failure they
     * cannot act on, and the tenant's test document is unsignable.
     *
     * With a sentinel, the most specific source that actually spoke wins:
     * the agreement row, else the rental row, else the tenant. `?? 'test'` at
     * the end keeps the old default for the case where none of them said
     * anything, which is what the original initialiser was really for.
     */
    let boldsignMode: 'test' | 'live' | null = null;
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

    // Resolve BoldSign mode from the rental, then the tenant — but only while
    // nothing more specific has already answered. Mirrors view/route.ts:115-136.
    if (!boldsignMode && rental.boldsign_mode) {
      boldsignMode = rental.boldsign_mode as 'test' | 'live';
    } else if (!boldsignMode && rental.tenant_id) {
      const { data: tenantData } = await supabase
        .from('tenants')
        .select('boldsign_mode, slug')
        .eq('id', rental.tenant_id)
        .single();
      // Lean tenants are always live; everyone else keeps the column. A tenant
      // is lean by canary slug OR by `tenants.portal_experience = 'v2'`, read in
      // a query of its own so an unreadable column cannot take `boldsign_mode`
      // down with it.
      const onV2 = await readTenantOnV2ById(supabase, rental.tenant_id);
      if (isLeanTenant(tenantData?.slug, onV2)) {
        boldsignMode = 'live';
      } else if (tenantData?.boldsign_mode) {
        boldsignMode = tenantData.boldsign_mode as 'test' | 'live';
      }
    }

    // Nothing recorded a mode: keep the historical default rather than guessing.
    const resolvedMode: 'test' | 'live' = boldsignMode ?? 'test';

    const BOLDSIGN_API_KEY = getBoldSignApiKey(resolvedMode);
    if (!BOLDSIGN_API_KEY) {
      return NextResponse.json({ ok: false, error: 'BoldSign not configured' }, { status: 500 });
    }

    // Default return URL
    const returnUrl = body.returnUrl || `${request.headers.get('origin')}/portal/agreements?signed=true`;

    // Get embedded signing link from BoldSign
    console.log('Getting embedded signing link from BoldSign... (mode:', resolvedMode, ')');
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
