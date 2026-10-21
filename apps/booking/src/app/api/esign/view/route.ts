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
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/**
 * A stored signed copy, as the v2 drawers can draw it. Those drawers render
 * the PDF with pdf.js, which has to `fetch()` it, so a copy hosted anywhere
 * but our own storage (seeded rows point at outside hosts) is blocked by CORS
 * and the drawer shows nothing. When the caller asks for `inline`, such a copy
 * is fetched here and returned as base64 instead. Our own storage sends CORS
 * headers, so its URL still goes back as a URL. Without `inline` (every v1
 * caller) the response is exactly what it always was.
 *
 * Only an https URL to a public host, only a PDF, at most 20 MB.
 */
const INLINE_MAX_BYTES = 20 * 1024 * 1024;

function isOwnStorage(url: string): boolean {
    try {
        return !!supabaseUrl && new URL(url).origin === new URL(supabaseUrl).origin;
    } catch {
        return false;
    }
}

function isPublicHttps(url: string): boolean {
    try {
        const { protocol, hostname } = new URL(url);
        if (protocol !== 'https:') return false;
        const host = hostname.toLowerCase();
        if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
        // No literal addresses: a stored URL must name a host.
        if (/^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[')) return false;
        return true;
    } catch {
        return false;
    }
}

async function storedDocumentResponse(documentUrl: string, inline: boolean) {
    if (inline && !isOwnStorage(documentUrl) && isPublicHttps(documentUrl)) {
        try {
            const response = await fetch(documentUrl, { redirect: 'follow' });
            const length = Number(response.headers.get('content-length') ?? 0);
            if (response.ok && length <= INLINE_MAX_BYTES) {
                const buffer = Buffer.from(await response.arrayBuffer());
                if (buffer.byteLength <= INLINE_MAX_BYTES && buffer.subarray(0, 5).toString('latin1') === '%PDF-') {
                    return NextResponse.json({
                        ok: true,
                        documentBase64: buffer.toString('base64'),
                        contentType: 'application/pdf',
                        status: 'completed',
                        source: 'stored',
                    });
                }
            }
        } catch (e) {
            console.warn('Stored document could not be fetched inline:', e);
        }
    }
    return NextResponse.json({ ok: true, documentUrl, status: 'completed', source: 'stored' });
}

export async function POST(request: NextRequest) {
    try {
        const { rentalId, envelopeId: providedEnvelopeId, agreementId, inline } = await request.json();

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
                        return storedDocumentResponse(documentUrl, inline === true);
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

                    return storedDocumentResponse(documentUrl, inline === true);
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
                    .select('boldsign_mode, slug')
                    .eq('id', rentalMode.tenant_id)
                    .single();
                // Lean tenants are always live; everyone else keeps the column.
                // Lean by canary slug OR by `tenants.portal_experience = 'v2'`,
                // read separately so an unreadable column cannot take
                // `boldsign_mode` down with it.
                const onV2 = await readTenantOnV2ById(supabase, rentalMode.tenant_id);
                if (isLeanTenant(tenantData?.slug, onV2)) {
                    boldsignMode = 'live';
                } else if (tenantData?.boldsign_mode) {
                    boldsignMode = tenantData.boldsign_mode as 'test' | 'live';
                }
            }
        }

        const BOLDSIGN_API_KEY = getBoldSignApiKey(boldsignMode);
        if (!BOLDSIGN_API_KEY) {
            return NextResponse.json({ ok: false, error: 'BoldSign not configured' }, { status: 500 });
        }

        // Try to read status from DB first (our webhook keeps it in sync).
        // Only fall back to BoldSign if DB has no status — saves an API call on every view.
        let documentStatus = 'unknown';
        try {
            if (agreementId) {
                const { data: a } = await supabase
                    .from('rental_agreements')
                    .select('document_status')
                    .eq('id', agreementId)
                    .single();
                if (a?.document_status) documentStatus = a.document_status;
            } else if (rentalId) {
                const { data: r } = await supabase
                    .from('rentals')
                    .select('document_status')
                    .eq('id', rentalId)
                    .single();
                if (r?.document_status) documentStatus = r.document_status;
            }
        } catch (e) {
            console.warn('DB status lookup failed:', e);
        }

        if (documentStatus === 'unknown') {
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
