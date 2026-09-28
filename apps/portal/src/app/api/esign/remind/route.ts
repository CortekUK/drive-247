import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isLeanTenant } from '@/lib/lean-areas';
import { readTenantOnV2ById } from '@/lib/portal-tenant';

/**
 * NUDGE THE SIGNER. Same document, same link, no new envelope, no credit.
 *
 * ── why this exists ────────────────────────────────────────────────────────
 *
 * "Resend" used to mean POST /api/esign, which builds a NEW BoldSign document
 * and — see the revoke block in ../route.ts — REVOKES the previous one first,
 * with the message "Superseded by a newer agreement". A revoked document cannot
 * be signed. So the act of resending destroyed the very link the customer was
 * holding, and the customer who went back to the email already open in front of
 * them still could not sign. They complain, the operator resends, the new link
 * dies too.
 *
 * Moore Luxe reported it on 29 Sep 2026: "multiple customers complaining that
 * they're getting an email, but they're not allowed to sign, which is why I
 * have to continuously send multiple emails which slowly eat my credits."
 * Their account held 61 documents for 18 rentals — 14 of those rentals had more
 * than one, three had six, and 20 documents were voided, 15 of them replaced
 * within two hours. At 7 credits per document that is roughly 300 credits spent
 * on envelopes nobody was allowed to sign. They hit zero and two agreements
 * failed outright with `credit_failed`, so those customers got no email at all.
 *
 * BoldSign already has the right primitive: a reminder re-sends the existing
 * document to whoever has not signed yet. It costs nothing, and the link the
 * customer already has keeps working.
 *
 * ── what this route will NOT do ────────────────────────────────────────────
 *
 * It never creates anything and never revokes anything. If there is no live
 * document to nudge — already signed, already voided, expired, or never created
 * because the tenant was out of credits — it answers `code: 'no_live_document'`
 * and the caller decides whether to issue a real one. Deciding that here would
 * hide a 7-credit charge behind a button that says "remind".
 */

const BOLDSIGN_BASE_URL = process.env.BOLDSIGN_BASE_URL || 'https://api.boldsign.com';

/** Statuses where a signer is still expected to act. Anything else cannot be nudged. */
const REMINDABLE = ['sent', 'delivered', 'pending'];

function getBoldSignApiKey(mode: 'test' | 'live'): string {
    return mode === 'live'
        ? (process.env.BOLDSIGN_LIVE_API_KEY || process.env.BOLDSIGN_API_KEY || '')
        : (process.env.BOLDSIGN_TEST_API_KEY || process.env.BOLDSIGN_API_KEY || '');
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

function notLive(reason: string) {
    // 409, not 404: the agreement exists, it just cannot be reminded. The client
    // branches on `code`, never on the prose.
    return NextResponse.json({ ok: false, code: 'no_live_document', error: reason }, { status: 409 });
}

export async function POST(request: NextRequest) {
    try {
        const { agreementId, rentalId, message } = await request.json();

        if (!agreementId && !rentalId) {
            return NextResponse.json({ ok: false, error: 'agreementId or rentalId required' }, { status: 400 });
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        let documentId: string | null = null;
        let mode: 'test' | 'live' = 'test';
        let tenantId: string | null = null;

        // Path A: a specific agreement row (extensions always come this way).
        if (agreementId) {
            const { data: agreement, error } = await supabase
                .from('rental_agreements')
                .select('document_id, boldsign_mode, document_status, rental_id, tenant_id')
                .eq('id', agreementId)
                .single();

            if (error || !agreement) {
                return NextResponse.json({ ok: false, error: 'Agreement not found' }, { status: 404 });
            }
            if (!agreement.document_id) return notLive('That agreement has no document to remind.');
            if (!REMINDABLE.includes(String(agreement.document_status || '').toLowerCase())) {
                return notLive(`Agreement is ${agreement.document_status}, so there is nothing to remind.`);
            }

            documentId = agreement.document_id;
            tenantId = agreement.tenant_id;
            if (agreement.boldsign_mode) mode = agreement.boldsign_mode as 'test' | 'live';
        }

        // Path B: a rental. Prefer its newest LIVE agreement row; the rentals
        // column is the fallback for originals written before agreements-v2.
        if (!documentId && rentalId) {
            const { data: rows } = await supabase
                .from('rental_agreements')
                .select('document_id, boldsign_mode, document_status, tenant_id')
                .eq('rental_id', rentalId)
                .not('document_id', 'is', null)
                .in('document_status', REMINDABLE)
                .order('created_at', { ascending: false })
                .limit(1);

            const live = rows?.[0];
            if (live) {
                documentId = live.document_id;
                tenantId = live.tenant_id;
                if (live.boldsign_mode) mode = live.boldsign_mode as 'test' | 'live';
            } else {
                const { data: rental } = await supabase
                    .from('rentals')
                    .select('docusign_envelope_id, boldsign_mode, tenant_id, document_status')
                    .eq('id', rentalId)
                    .single();

                if (!rental?.docusign_envelope_id) {
                    return notLive('No document has been sent for this rental yet.');
                }
                if (!REMINDABLE.includes(String(rental.document_status || '').toLowerCase())) {
                    return notLive(`Agreement is ${rental.document_status}, so there is nothing to remind.`);
                }

                documentId = rental.docusign_envelope_id;
                tenantId = rental.tenant_id;
                if (rental.boldsign_mode) mode = rental.boldsign_mode as 'test' | 'live';
            }

            // Mode fallback, copied from the void route for the same reason:
            // `portal_experience` is read separately, because a column Postgres
            // refuses takes the WHOLE row with it — and a live tenant silently
            // dropping to the sandbox key 404s its own document.
            if (tenantId) {
                const { data: tenant } = await supabase
                    .from('tenants')
                    .select('boldsign_mode, slug')
                    .eq('id', tenantId)
                    .single();
                const onV2 = await readTenantOnV2ById(supabase, tenantId);
                if (isLeanTenant(tenant?.slug, onV2)) {
                    mode = 'live';
                } else if (tenant?.boldsign_mode && !mode) {
                    mode = tenant.boldsign_mode as 'test' | 'live';
                }
            }
        }

        if (!documentId) return notLive('No document ID resolved.');

        const apiKey = getBoldSignApiKey(mode);
        if (!apiKey) {
            return NextResponse.json({ ok: false, error: 'BoldSign not configured' }, { status: 500 });
        }

        const reminderMessage =
            (typeof message === 'string' && message.trim()) ||
            'A reminder to sign your rental agreement. Please use the link in this email.';

        const res = await fetch(
            `${BOLDSIGN_BASE_URL}/v1/document/remind?documentId=${encodeURIComponent(documentId)}`,
            {
                method: 'POST',
                headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
                // No `receiverEmails`: BoldSign then reminds every signer who has
                // not yet signed, which is exactly who should be chased. Naming
                // them would mean trusting our copy of the address over the one
                // the envelope was actually addressed to.
                body: JSON.stringify({ message: reminderMessage }),
            }
        );

        if (!res.ok) {
            const detail = await res.text();
            console.error('BoldSign remind failed:', res.status, detail);
            return NextResponse.json(
                { ok: false, error: 'Failed to send the reminder at BoldSign', detail },
                { status: 502 }
            );
        }

        // Nothing is written back. A reminder changes no state we hold — the
        // document is the same document, at the same status, on the same link.
        return NextResponse.json({ ok: true, documentId, reminded: true });
    } catch (err: any) {
        console.error('Remind route error:', err);
        return NextResponse.json({ ok: false, error: err?.message || 'Unexpected error' }, { status: 500 });
    }
}
