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

export async function POST(request: NextRequest) {
    try {
        const { agreementId, rentalId, reason } = await request.json();

        if (!agreementId && !rentalId) {
            return NextResponse.json({ ok: false, error: 'agreementId or rentalId required' }, { status: 400 });
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        let documentId: string | null = null;
        let mode: 'test' | 'live' = 'test';
        let resolvedAgreementId: string | null = agreementId || null;
        let resolvedRentalId: string | null = rentalId || null;
        let isOriginal = false;

        // Path A: agreementId provided → look up the rental_agreements row
        if (agreementId) {
            const { data: agreement, error } = await supabase
                .from('rental_agreements')
                .select('document_id, boldsign_mode, agreement_type, rental_id, document_status')
                .eq('id', agreementId)
                .single();

            if (error || !agreement) {
                return NextResponse.json({ ok: false, error: 'Agreement not found' }, { status: 404 });
            }

            if (agreement.document_status === 'signed' || agreement.document_status === 'completed') {
                return NextResponse.json(
                    { ok: false, error: 'Cannot void an already-signed agreement' },
                    { status: 400 }
                );
            }

            documentId = agreement.document_id;
            if (agreement.boldsign_mode) mode = agreement.boldsign_mode as 'test' | 'live';
            resolvedRentalId = agreement.rental_id;
            isOriginal = agreement.agreement_type === 'original';
        }

        // Path B: rentalId provided (original agreement on rentals row) — fall back to docusign_envelope_id
        if (!documentId && rentalId) {
            const { data: rental } = await supabase
                .from('rentals')
                .select('docusign_envelope_id, boldsign_mode, tenant_id, document_status')
                .eq('id', rentalId)
                .single();

            if (!rental?.docusign_envelope_id) {
                return NextResponse.json({ ok: false, error: 'No active envelope for this rental' }, { status: 404 });
            }

            if (rental.document_status === 'signed' || rental.document_status === 'completed') {
                return NextResponse.json(
                    { ok: false, error: 'Cannot void an already-signed agreement' },
                    { status: 400 }
                );
            }

            documentId = rental.docusign_envelope_id;
            isOriginal = true;

            if (rental.boldsign_mode) {
                mode = rental.boldsign_mode as 'test' | 'live';
            } else if (rental.tenant_id) {
                const { data: tenant } = await supabase
                    .from('tenants')
                    .select('boldsign_mode')
                    .eq('id', rental.tenant_id)
                    .single();
                if (tenant?.boldsign_mode) mode = tenant.boldsign_mode as 'test' | 'live';
            }
        }

        if (!documentId) {
            return NextResponse.json({ ok: false, error: 'No document ID resolved' }, { status: 400 });
        }

        const apiKey = getBoldSignApiKey(mode);
        if (!apiKey) {
            return NextResponse.json({ ok: false, error: 'BoldSign not configured' }, { status: 500 });
        }

        const revokeMessage = (typeof reason === 'string' && reason.trim()) || 'Voided by tenant admin';

        const revokeRes = await fetch(
            `${BOLDSIGN_BASE_URL}/v1/document/revoke?documentId=${encodeURIComponent(documentId)}`,
            {
                method: 'POST',
                headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({ revokeMessage }),
            }
        );

        if (!revokeRes.ok) {
            const text = await revokeRes.text();
            console.error('BoldSign revoke failed:', revokeRes.status, text);
            return NextResponse.json(
                { ok: false, error: 'Failed to void agreement at BoldSign', detail: text },
                { status: 500 }
            );
        }

        // Reflect the void in DB
        if (resolvedAgreementId) {
            await supabase
                .from('rental_agreements')
                .update({ document_status: 'voided' })
                .eq('id', resolvedAgreementId);
        }
        if (isOriginal && resolvedRentalId) {
            await supabase
                .from('rentals')
                .update({ document_status: 'voided' })
                .eq('id', resolvedRentalId);
        }

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        console.error('Void route error:', err);
        return NextResponse.json({ ok: false, error: err?.message || 'Unexpected error' }, { status: 500 });
    }
}
