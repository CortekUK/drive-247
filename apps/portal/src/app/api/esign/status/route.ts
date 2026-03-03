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

// Map BoldSign document status to our document_status
function mapDocumentStatus(status: string): string {
    const statusMap: Record<string, string> = {
        'WaitingForOthers': 'sent',
        'NeedsSigning': 'sent',
        'InProgress': 'signed',
        'Completed': 'completed',
        'Declined': 'declined',
        'Revoked': 'voided',
        'Expired': 'expired',
        'Draft': 'pending',
    };
    return statusMap[status] || status.toLowerCase();
}

export async function POST(request: NextRequest) {
    try {
        const { rentalId, envelopeId, agreementId } = await request.json();

        console.log('='.repeat(50));
        console.log('CHECKING ESIGN STATUS (BoldSign)');
        console.log('='.repeat(50));
        console.log('Rental ID:', rentalId, 'Agreement ID:', agreementId);

        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        let documentId = envelopeId;
        let boldsignMode: 'test' | 'live' = 'test';
        let agreementType: string | null = null;

        // If agreementId provided, look up document_id from rental_agreements
        if (agreementId) {
            const { data: agreement } = await supabase
                .from('rental_agreements')
                .select('document_id, boldsign_mode, agreement_type, rental_id')
                .eq('id', agreementId)
                .single();

            if (agreement?.document_id) {
                documentId = agreement.document_id;
                agreementType = agreement.agreement_type;
                if (agreement.boldsign_mode) boldsignMode = agreement.boldsign_mode as 'test' | 'live';
            }
        }

        if (!documentId) {
            return NextResponse.json({ ok: false, error: 'No document ID provided' }, { status: 400 });
        }

        console.log('Document ID:', documentId);

        // Resolve BoldSign mode from rental if not already set
        if (boldsignMode === 'test' && rentalId) {
            const { data: rentalData } = await supabase
                .from('rentals')
                .select('boldsign_mode, tenant_id')
                .eq('id', rentalId)
                .single();
            if (rentalData?.boldsign_mode) {
                boldsignMode = rentalData.boldsign_mode as 'test' | 'live';
            } else if (rentalData?.tenant_id) {
                const { data: tenantData } = await supabase
                    .from('tenants')
                    .select('boldsign_mode')
                    .eq('id', rentalData.tenant_id)
                    .single();
                if (tenantData?.boldsign_mode) boldsignMode = tenantData.boldsign_mode as 'test' | 'live';
            }
        }

        const BOLDSIGN_API_KEY = getBoldSignApiKey(boldsignMode);
        if (!BOLDSIGN_API_KEY) {
            return NextResponse.json({ ok: false, error: 'BoldSign not configured' }, { status: 500 });
        }

        // Get document properties from BoldSign
        console.log('Fetching document status from BoldSign... (mode:', boldsignMode, ')');
        const propsResponse = await fetch(
            `${BOLDSIGN_BASE_URL}/v1/document/properties?documentId=${documentId}`,
            {
                headers: { 'X-API-KEY': BOLDSIGN_API_KEY },
            }
        );

        if (!propsResponse.ok) {
            const errorText = await propsResponse.text();
            console.error('BoldSign API error:', errorText);
            return NextResponse.json({ ok: false, error: 'Failed to get document status' }, { status: 500 });
        }

        const propsData = await propsResponse.json();
        console.log('Document status from BoldSign:', propsData.status);

        // Map to our status
        const newStatus = mapDocumentStatus(propsData.status);
        console.log('Mapped status:', newStatus);

        const updateData: Record<string, any> = {
            document_status: newStatus,
        };

        if ((newStatus === 'signed' || newStatus === 'completed') && propsData.activityDate) {
            updateData.envelope_completed_at = propsData.activityDate;
        }

        // Update rental_agreements if agreementId provided
        if (agreementId) {
            const { error: agreeError } = await supabase
                .from('rental_agreements')
                .update(updateData)
                .eq('id', agreementId);
            if (agreeError) console.error('Failed to update rental_agreements:', agreeError);
            else console.log('Agreement status updated to:', newStatus);
        }

        // Update rentals table if original agreement or no agreementId (backward compat)
        if (rentalId && (!agreementType || agreementType === 'original')) {
            const { error: updateError } = await supabase
                .from('rentals')
                .update(updateData)
                .eq('id', rentalId);

            if (updateError) {
                console.error('Failed to update rental:', updateError);
            } else {
                console.log('Rental status updated to:', newStatus);
            }
        }

        console.log('='.repeat(50));

        return NextResponse.json({
            ok: true,
            status: newStatus,
            boldsignStatus: propsData.status,
            statusChangedDateTime: propsData.activityDate,
            completedDateTime: propsData.completedDate,
        });

    } catch (error: any) {
        console.error('Status check error:', error);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
}
