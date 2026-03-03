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

export async function POST(request: NextRequest) {
    try {
        const { rentalId, envelopeId: providedEnvelopeId, agreementId } = await request.json();

        if (!rentalId && !providedEnvelopeId && !agreementId) {
            return NextResponse.json({ ok: false, error: 'rentalId, envelopeId, or agreementId required' }, { status: 400 });
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        let documentId = providedEnvelopeId;
        let boldsignMode: 'test' | 'live' = 'test';

        // If agreementId provided, look up from rental_agreements
        if (agreementId) {
            const { data: agreement } = await supabase
                .from('rental_agreements')
                .select('document_id, boldsign_mode, signed_document_id')
                .eq('id', agreementId)
                .single();

            if (agreement) {
                if (agreement.boldsign_mode) boldsignMode = agreement.boldsign_mode as 'test' | 'live';

                // If signed document exists in agreement, return it
                if (agreement.signed_document_id) {
                    const { data: doc } = await supabase
                        .from('customer_documents')
                        .select('file_url')
                        .eq('id', agreement.signed_document_id)
                        .single();

                    if (doc?.file_url) {
                        let documentUrl = doc.file_url;
                        if (!documentUrl.startsWith('http')) {
                            const { data: urlData } = supabase.storage
                                .from('customer-documents')
                                .getPublicUrl(doc.file_url);
                            documentUrl = urlData.publicUrl;
                        }
                        return NextResponse.json({ ok: true, documentUrl, status: 'completed', source: 'stored' });
                    }
                }

                documentId = agreement.document_id;
            }
        }

        // Fallback: Get document ID from rental if not provided
        if (!documentId && rentalId) {
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
                return NextResponse.json({ ok: false, error: 'No signed document for this rental' }, { status: 404 });
            }

            documentId = rental.docusign_envelope_id;
        }

        if (!documentId) {
            return NextResponse.json({ ok: false, error: 'No document ID found' }, { status: 404 });
        }

        // Resolve BoldSign mode from rental if not already set
        if (boldsignMode === 'test' && rentalId) {
            const { data: rentalMode } = await supabase
                .from('rentals')
                .select('boldsign_mode, tenant_id')
                .eq('id', rentalId)
                .single();
            if (rentalMode?.boldsign_mode) {
                boldsignMode = rentalMode.boldsign_mode as 'test' | 'live';
            } else if (rentalMode?.tenant_id) {
                const { data: tenantData } = await supabase
                    .from('tenants')
                    .select('boldsign_mode')
                    .eq('id', rentalMode.tenant_id)
                    .single();
                if (tenantData?.boldsign_mode) boldsignMode = tenantData.boldsign_mode as 'test' | 'live';
            }
        }

        const BOLDSIGN_API_KEY = getBoldSignApiKey(boldsignMode);
        if (!BOLDSIGN_API_KEY) {
            return NextResponse.json({ ok: false, error: 'BoldSign not configured' }, { status: 500 });
        }

        // Try to get document properties for status (non-blocking)
        let documentStatus = 'unknown';
        try {
            const statusResponse = await fetch(
                `${BOLDSIGN_BASE_URL}/v1/document/properties?documentId=${documentId}`,
                { headers: { 'X-API-KEY': BOLDSIGN_API_KEY } }
            );
            if (statusResponse.ok) {
                const propsData = await statusResponse.json();
                documentStatus = propsData.status || 'unknown';
            }
        } catch (e) {
            console.warn('Could not fetch document properties:', e);
        }

        // Download the document PDF
        const docResponse = await fetch(
            `${BOLDSIGN_BASE_URL}/v1/document/download?documentId=${documentId}`,
            { headers: { 'X-API-KEY': BOLDSIGN_API_KEY } }
        );

        if (!docResponse.ok) {
            const errorText = await docResponse.text();
            console.error('BoldSign download error:', docResponse.status, errorText);
            return NextResponse.json({ ok: false, error: 'Failed to get document from BoldSign' }, { status: 500 });
        }

        // Get the PDF as base64
        const pdfBuffer = await docResponse.arrayBuffer();
        const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');

        return NextResponse.json({
            ok: true,
            documentBase64: pdfBase64,
            contentType: 'application/pdf',
            status: documentStatus,
            source: 'boldsign'
        });

    } catch (error: any) {
        console.error('View eSign Error:', error);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
}
