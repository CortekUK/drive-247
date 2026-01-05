import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Supabase client with service role for updates
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

/**
 * DocuSign Connect Webhook Handler
 * 
 * This endpoint receives status updates from DocuSign when:
 * - Envelope is sent
 * - Recipient views the document
 * - Recipient signs the document
 * - Envelope is completed
 * - Envelope is declined/voided
 * 
 * Configure DocuSign Connect to send webhooks to:
 * https://yourdomain.com/api/docusign/webhook
 */

interface DocuSignWebhookPayload {
    event: string;
    apiVersion: string;
    uri: string;
    retryCount: number;
    configurationId: number;
    generatedDateTime: string;
    data: {
        accountId: string;
        userId: string;
        envelopeId: string;
        envelopeSummary?: {
            status: string;
            statusDateTime: string;
            recipients?: {
                signers?: Array<{
                    email: string;
                    name: string;
                    status: string;
                    signedDateTime?: string;
                    deliveredDateTime?: string;
                    sentDateTime?: string;
                }>;
            };
        };
    };
}

// Map DocuSign status to our document_status
function mapDocuSignStatus(event: string, envelopeStatus?: string): string {
    // Handle event types
    switch (event) {
        case 'envelope-created':
            return 'pending';
        case 'envelope-sent':
            return 'sent';
        case 'envelope-delivered':
            return 'delivered';
        case 'envelope-completed':
            return 'signed';
        case 'envelope-declined':
            return 'declined';
        case 'envelope-voided':
            return 'voided';
        case 'recipient-sent':
            return 'sent';
        case 'recipient-delivered':
            return 'delivered';
        case 'recipient-completed':
            return 'signed';
        case 'recipient-declined':
            return 'declined';
        case 'recipient-viewed':
            return 'viewed';
        default:
            // Fall back to envelope status if event not recognized
            if (envelopeStatus) {
                return envelopeStatus.toLowerCase();
            }
            return 'sent';
    }
}

export async function POST(request: NextRequest) {
    try {
        const payload = await request.json() as DocuSignWebhookPayload;

        console.log('='.repeat(50));
        console.log('DOCUSIGN WEBHOOK RECEIVED');
        console.log('='.repeat(50));
        console.log('Event:', payload.event);
        console.log('Envelope ID:', payload.data?.envelopeId);
        console.log('Envelope Status:', payload.data?.envelopeSummary?.status);

        const envelopeId = payload.data?.envelopeId;

        if (!envelopeId) {
            console.log('No envelope ID in webhook payload');
            return NextResponse.json({ ok: true, message: 'No envelope ID' });
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Find rental by envelope ID
        const { data: rental, error: findError } = await supabase
            .from('rentals')
            .select('id, document_status')
            .eq('docusign_envelope_id', envelopeId)
            .single();

        if (findError || !rental) {
            console.log('Rental not found for envelope:', envelopeId);
            return NextResponse.json({ ok: true, message: 'Rental not found' });
        }

        console.log('Found rental:', rental.id);
        console.log('Current status:', rental.document_status);

        // Determine new status
        const newStatus = mapDocuSignStatus(
            payload.event,
            payload.data?.envelopeSummary?.status
        );

        console.log('New status:', newStatus);

        // Build update object
        const updateData: Record<string, any> = {
            document_status: newStatus,
        };

        // Set completion timestamp if signed/completed
        if (newStatus === 'signed' || payload.event === 'envelope-completed') {
            updateData.envelope_completed_at =
                payload.data?.envelopeSummary?.statusDateTime ||
                new Date().toISOString();
        }

        // Set sent timestamp if being sent
        if (newStatus === 'sent' && !rental.document_status) {
            updateData.envelope_sent_at = new Date().toISOString();
        }

        // Update rental
        const { error: updateError } = await supabase
            .from('rentals')
            .update(updateData)
            .eq('id', rental.id);

        if (updateError) {
            console.error('Failed to update rental:', updateError);
            return NextResponse.json({ ok: false, error: 'Update failed' }, { status: 500 });
        }

        console.log('✅ Rental updated successfully');
        console.log('='.repeat(50));

        // Return 200 to acknowledge receipt
        return NextResponse.json({
            ok: true,
            message: 'Webhook processed',
            rentalId: rental.id,
            newStatus
        });

    } catch (error: any) {
        console.error('Webhook Error:', error);
        // Still return 200 to prevent DocuSign from retrying
        return NextResponse.json({
            ok: false,
            error: error.message
        }, { status: 200 });
    }
}

// Also handle GET for webhook verification
export async function GET(request: NextRequest) {
    return NextResponse.json({
        status: 'DocuSign webhook endpoint active',
        timestamp: new Date().toISOString()
    });
}
