import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isLeanTenant } from '@/lib/lean-areas';
import { readTenantOnV2ById } from '@/lib/portal-tenant';

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
/**
 * A status a customer can still sign from. Anything else is a dead end:
 * `voided` (we revoked it when a replacement was sent), `completed`/`signed`
 * (done), `declined`, `expired`, `credit_failed` (never created).
 */
const SIGNABLE_STATUSES = new Set(['created', 'sent', 'delivered', 'viewed', 'pending']);
const DONE_STATUSES = new Set(['completed', 'signed']);

/** A plain page, because the reader is a renter on a phone, not an operator. */
function customerMessage(title: string, detail: string, status: number) {
    return new NextResponse(
        `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f6f6f7;color:#1a1a1a">
<div style="max-width:520px;margin:12vh auto;padding:28px 24px;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08)">
<h1 style="margin:0 0 12px;font-size:20px">${title}</h1>
<p style="margin:0;line-height:1.6;color:#444;font-size:15px">${detail}</p>
</div></body></html>`,
        { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
}

export async function GET(request: NextRequest) {
    const agreementId = request.nextUrl.searchParams.get('id');

    if (!agreementId) {
        return new NextResponse('Missing agreement ID', { status: 400 });
    }

    try {
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Look up agreement
        const { data: emailed } = await supabase
            .from('rental_agreements')
            .select('id, document_id, boldsign_mode, document_status, rental_id, tenant_id, agreement_type')
            .eq('id', agreementId)
            .single();

        if (!emailed?.document_id) {
            return new NextResponse('Agreement not found', { status: 404 });
        }

        /*
         * ── THE LINK IN AN OLD EMAIL MUST STILL WORK ───────────────────────────
         *
         * Sending a replacement agreement REVOKES the previous one (see the
         * revoke loop in ../route.ts) — so every earlier email the renter holds
         * now points at a document BoldSign will not accept a signature on. It
         * still issued a signing link for it, so the renter tapped the button,
         * landed on a dead BoldSign page, and told the operator "it doesn't
         * work". The operator's fix is to send again, which revokes one more
         * link and adds one more identical email to the renter's inbox.
         *
         * Moore Luxe, week of 25 Sep 2026: 36 documents for 13 rentals, 16 of
         * them revoked, 5 ever signed. One renter was sent SEVEN.
         *
         * So the id in the email is treated as "which rental, which kind of
         * agreement", not "which document". Whatever the renter taps, they get
         * the one that is actually live. Picking the newest LIVE one of the
         * SAME TYPE matters: a rental can hold a live original and a live
         * extension at once, and sending someone to the wrong one would have
         * them sign a document that is not the one they were asked about.
         */
        const { data: siblings } = await supabase
            .from('rental_agreements')
            .select('id, document_id, boldsign_mode, document_status, rental_id, tenant_id, agreement_type')
            .eq('rental_id', emailed.rental_id)
            .eq('agreement_type', emailed.agreement_type)
            .order('created_at', { ascending: false });

        const candidates = siblings?.length ? siblings : [emailed];
        const agreement =
            candidates.find((a) => a.document_id && SIGNABLE_STATUSES.has(String(a.document_status))) ?? emailed;

        if (agreement.id !== emailed.id) {
            // Worth a line: it means the renter is working from an email the
            // operator has already superseded, which is the loop this fixes.
            console.log(
                `Signing redirect - emailed agreement ${emailed.id} is ${emailed.document_status}; ` +
                    `sending the renter to the live one (${agreement.id}) for rental ${emailed.rental_id}`,
            );
        }

        if (DONE_STATUSES.has(String(agreement.document_status))) {
            return customerMessage(
                'Already signed',
                'This agreement has been signed. There is nothing left for you to do — keep the confirmation email for your records.',
                200,
            );
        }

        if (!SIGNABLE_STATUSES.has(String(agreement.document_status))) {
            // Every version is spent and none is live: the operator has to send
            // a fresh one. Say so plainly instead of dropping them on an error.
            if (candidates.some((a) => DONE_STATUSES.has(String(a.document_status)))) {
                return customerMessage(
                    'Already signed',
                    'This agreement has been signed. There is nothing left for you to do — keep the confirmation email for your records.',
                    200,
                );
            }
            return customerMessage(
                'This link has been replaced',
                'A newer version of your rental agreement was issued, so this link no longer works. Please contact the rental company and ask them to send it again.',
                410,
            );
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
                .select('boldsign_mode, slug')
                .eq('id', agreement.tenant_id)
                .single();
            // Lean tenants are always live; everyone else keeps the column.
            // `portal_experience` is read in a query of its OWN rather than added
            // to the select above: if that column is not yet readable, Postgres
            // refuses the WHOLE row, `boldsign_mode` comes back undefined, and
            // every tenant on `live` would silently fall back to the sandbox key
            // and 404 its own signed document.
            const onV2 = await readTenantOnV2ById(supabase, agreement.tenant_id);
            if (isLeanTenant(tenant?.slug, onV2)) {
                boldsignMode = 'live';
            } else if (tenant?.boldsign_mode) {
                boldsignMode = tenant.boldsign_mode as 'test' | 'live';
            }
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
            console.error(
                `Signing redirect - BoldSign error for agreement ${agreement.id} (emailed ${agreementId}):`,
                signLinkRes.status,
                await signLinkRes.text(),
            );
            return customerMessage(
                'We could not open your agreement',
                'Something went wrong loading the signing page. Please contact the rental company and ask them to send the agreement again.',
                502,
            );
        }

        const { signLink } = await signLinkRes.json();
        if (!signLink) {
            return customerMessage(
                'We could not open your agreement',
                'The signing page is not available right now. Please try again in a few minutes.',
                502,
            );
        }

        // Redirect customer to BoldSign signing page
        return NextResponse.redirect(signLink);
    } catch (error) {
        console.error('Signing redirect error:', error);
        return new NextResponse('Something went wrong. Please try again.', { status: 500 });
    }
}
