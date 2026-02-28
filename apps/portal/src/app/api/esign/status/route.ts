import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// BoldSign configuration
const BOLDSIGN_API_KEY = process.env.BOLDSIGN_API_KEY || '';
const BOLDSIGN_BASE_URL = process.env.BOLDSIGN_BASE_URL || 'https://api.boldsign.com';

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
        const { rentalId, envelopeId } = await request.json();

        console.log('='.repeat(50));
        console.log('CHECKING ESIGN STATUS (BoldSign)');
        console.log('='.repeat(50));
        console.log('Rental ID:', rentalId);
        console.log('Document ID:', envelopeId);

        if (!envelopeId) {
            return NextResponse.json({ ok: false, error: 'No document ID provided' }, { status: 400 });
        }

        if (!BOLDSIGN_API_KEY) {
            return NextResponse.json({ ok: false, error: 'BoldSign not configured' }, { status: 500 });
        }

        // Get document properties from BoldSign
        console.log('Fetching document status from BoldSign...');
        const propsResponse = await fetch(
            `${BOLDSIGN_BASE_URL}/v1/document/properties?documentId=${envelopeId}`,
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

        // Update database if we have rentalId
        if (rentalId) {
            const supabase = createClient(supabaseUrl, supabaseServiceKey);

            const updateData: Record<string, any> = {
                document_status: newStatus,
            };

            if (newStatus === 'signed' && propsData.activityDate) {
                updateData.envelope_completed_at = propsData.activityDate;
            }

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
