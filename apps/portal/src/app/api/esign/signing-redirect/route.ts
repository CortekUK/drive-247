import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const BOLDSIGN_BASE_URL = process.env.BOLDSIGN_BASE_URL || 'https://api.boldsign.com';

function getBoldSignApiKey(mode: 'test' | 'live'): string {
    return mode === 'live'
        ? (process.env.BOLDSIGN_LIVE_API_KEY || process.env.BOLDSIGN_API_KEY || '')
        : (process.env.BOLDSIGN_TEST_API_KEY || process.env.BOLDSIGN_API_KEY || '');
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

/**
 * Public GET endpoint for email signing links.
 * Usage: /api/esign/signing-redirect?id=<agreementId>
 *
 * Fetches the embedded signing link from BoldSign (1 API call) and redirects the customer.
 * This replaces the old approach of pre-fetching signing links at email-send time
 * (which consumed multiple BoldSign API calls via retries and contributed to rate limiting).
 */
export async function GET(request: NextRequest) {
    const agreementId = request.nextUrl.searchParams.get('id');

    if (!agreementId) {
        return new NextResponse('Missing agreement ID', { status: 400 });
    }

    try {
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Look up agreement
        const { data: agreement } = await supabase
            .from('rental_agreements')
            .select('document_id, boldsign_mode, document_status, rental_id, tenant_id')
            .eq('id', agreementId)
            .single();

        if (!agreement?.document_id) {
            return new NextResponse('Agreement not found', { status: 404 });
        }

        if (agreement.document_status === 'completed' || agreement.document_status === 'signed') {
            return new NextResponse('This document has already been signed.', { status: 400 });
        }

        // Get customer email from the rental
        const { data: rental } = await supabase
            .from('rentals')
            .select('customers:customer_id(email)')
            .eq('id', agreement.rental_id)
            .single();

        const customerEmail = (rental?.customers as any)?.email;
        if (!customerEmail) {
            return new NextResponse('Customer not found', { status: 404 });
        }

        // Resolve BoldSign mode
        let boldsignMode: 'test' | 'live' = (agreement.boldsign_mode as 'test' | 'live') || 'test';
        if (boldsignMode === 'test' && agreement.tenant_id) {
            const { data: tenant } = await supabase
                .from('tenants')
                .select('boldsign_mode')
                .eq('id', agreement.tenant_id)
                .single();
            if (tenant?.boldsign_mode) boldsignMode = tenant.boldsign_mode as 'test' | 'live';
        }

        const apiKey = getBoldSignApiKey(boldsignMode);
        if (!apiKey) {
            return new NextResponse('Signing service not configured', { status: 500 });
        }

        // Fetch signing link from BoldSign (single API call)
        const signLinkRes = await fetch(
            `${BOLDSIGN_BASE_URL}/v1/document/getEmbeddedSignLink?documentId=${agreement.document_id}&signerEmail=${encodeURIComponent(customerEmail)}`,
            { headers: { 'X-API-KEY': apiKey } }
        );

        if (!signLinkRes.ok) {
            console.error('Signing redirect - BoldSign error:', signLinkRes.status, await signLinkRes.text());
            return new NextResponse(
                'Unable to load the signing page. The document may have expired or already been signed. Please contact support.',
                { status: 502 }
            );
        }

        const { signLink } = await signLinkRes.json();
        if (!signLink) {
            return new NextResponse('Signing link not available. Please try again in a moment.', { status: 502 });
        }

        // Redirect customer to BoldSign signing page
        return NextResponse.redirect(signLink);
    } catch (error) {
        console.error('Signing redirect error:', error);
        return new NextResponse('Something went wrong. Please try again.', { status: 500 });
    }
}
