import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';

interface BoldSignEvent {
  event: {
    eventType: string;
    eventUtcTimestamp: string;
  };
  document: {
    documentId: string;
    messageTitle: string;
    status: string;
    signerDetails: Array<{
      signerName: string;
      signerEmail: string;
      status: string;
      signedDate?: string;
    }>;
    createdDate: string;
    activityDate: string;
    expiryDate?: string;
  };
}

// Map BoldSign status to our DB document_status
function mapBoldSignStatus(eventType: string): string {
  const statusMap: Record<string, string> = {
    'Sent': 'sent',
    'Viewed': 'delivered',
    'Signed': 'signed',
    'Completed': 'completed',
    'Declined': 'declined',
    'Revoked': 'voided',
    'Expired': 'expired',
    'Reassigned': 'sent',
  };
  return statusMap[eventType] || 'pending';
}

async function downloadSignedDocument(
  supabaseClient: ReturnType<typeof createClient>,
  documentId: string,
  apiKey: string,
  baseUrl: string
): Promise<{ success: boolean; fileUrl?: string; fileName?: string; error?: string }> {
  try {
    console.log('Downloading signed document from BoldSign for document:', documentId);

    const response = await fetch(
      `${baseUrl}/v1/document/download?documentId=${documentId}`,
      {
        headers: { 'X-API-KEY': apiKey },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error downloading from BoldSign:', response.status, errorText);
      return { success: false, error: `BoldSign download failed: ${response.status}` };
    }

    const pdfBlob = await response.blob();
    console.log('Document downloaded, size:', pdfBlob.size, 'bytes');

    // Upload to Supabase Storage
    const fileName = `rental-agreement-${documentId}-signed.pdf`;
    console.log('Uploading to Supabase Storage, filename:', fileName);

    const { data: uploadData, error: uploadError } = await supabaseClient.storage
      .from('customer-documents')
      .upload(fileName, pdfBlob, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('Error uploading signed document to Supabase:', uploadError);
      return { success: false, error: uploadError.message };
    }

    console.log('Upload successful, storage path:', uploadData?.path);

    // Get public URL
    const { data: urlData } = supabaseClient.storage
      .from('customer-documents')
      .getPublicUrl(fileName);

    console.log('Signed document uploaded successfully:', urlData.publicUrl);
    return { success: true, fileUrl: urlData.publicUrl, fileName };
  } catch (error) {
    console.error('Error downloading signed document:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

async function handleBoldSignWebhook(supabaseClient: ReturnType<typeof createClient>, event: BoldSignEvent) {
  try {
    const eventType = event.event.eventType;
    const documentId = event.document.documentId;

    console.log('Processing BoldSign webhook:', eventType, 'Document:', documentId);

    if (!documentId) {
      console.error('No document ID in webhook event');
      return { ok: false, error: 'Missing document ID' };
    }

    // Find the rental by document ID (stored in docusign_envelope_id column)
    const { data: rental, error: rentalError } = await supabaseClient
      .from('rentals')
      .select('*, tenant_id, customers:customer_id(id, name, email)')
      .eq('docusign_envelope_id', documentId)
      .single();

    if (rentalError || !rental) {
      console.error('Rental not found for document:', documentId);
      return { ok: false, error: 'Rental not found' };
    }

    console.log('Found rental:', rental.id, 'Event:', eventType);

    const mappedStatus = mapBoldSignStatus(eventType);
    const updateData: Record<string, unknown> = {
      document_status: mappedStatus,
    };

    // If completed, update rental to Active, vehicle to Rented, and download signed document
    if (mappedStatus === 'completed') {
      console.log('Document completed, activating rental and downloading signed document...');

      updateData.status = 'Active';

      // Update vehicle status to Rented
      if (rental.vehicle_id) {
        const { error: vehicleUpdateError } = await supabaseClient
          .from('vehicles')
          .update({ status: 'Rented' })
          .eq('id', rental.vehicle_id);

        if (vehicleUpdateError) {
          console.error('Error updating vehicle status:', vehicleUpdateError);
        } else {
          console.log('Vehicle status updated to Rented:', rental.vehicle_id);
        }
      }

      // Download signed document from BoldSign
      const BOLDSIGN_API_KEY = Deno.env.get('BOLDSIGN_API_KEY');
      const BOLDSIGN_BASE_URL = Deno.env.get('BOLDSIGN_BASE_URL') || 'https://api.boldsign.com';

      if (!BOLDSIGN_API_KEY) {
        console.error('BoldSign API key not configured');
        return { ok: false, error: 'BoldSign API key missing' };
      }

      const downloadResult = await downloadSignedDocument(
        supabaseClient,
        documentId,
        BOLDSIGN_API_KEY,
        BOLDSIGN_BASE_URL
      );

      if (downloadResult.success && downloadResult.fileUrl) {
        console.log('Creating customer_documents record...');

        const { data: docRecord, error: docError } = await supabaseClient
          .from('customer_documents')
          .insert({
            customer_id: rental.customer_id,
            document_type: 'Other',
            document_name: `Signed Rental Agreement - ${rental.customers.name}`,
            file_url: downloadResult.fileUrl,
            file_name: downloadResult.fileName || `rental-agreement-${documentId}-signed.pdf`,
            mime_type: 'application/pdf',
            verified: true,
            status: 'Active',
            tenant_id: rental.tenant_id,
          })
          .select()
          .single();

        if (docError) {
          console.error('Error creating document record:', docError);
        } else {
          console.log('Created document record:', docRecord.id);
          updateData.signed_document_id = docRecord.id;
          updateData.envelope_completed_at = new Date().toISOString();
        }
      } else {
        console.error('Failed to download signed document:', downloadResult.error);
      }
    }

    // Update rental record
    const { error: updateError } = await supabaseClient
      .from('rentals')
      .update(updateData)
      .eq('id', rental.id);

    if (updateError) {
      console.error('Error updating rental:', updateError);
      return { ok: false, error: updateError.message };
    }

    console.log('Successfully processed webhook for rental:', rental.id);
    return { ok: true };
  } catch (error) {
    console.error('Error handling webhook:', error);
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );

    const rawBody = await req.text();
    let event: BoldSignEvent;
    try {
      event = JSON.parse(rawBody) as BoldSignEvent;
    } catch {
      console.error('Failed to parse webhook body as JSON. Body starts with:', rawBody.substring(0, 200));
      return jsonResponse({ ok: false, error: 'Invalid JSON payload' });
    }

    console.log('Received BoldSign webhook event:', {
      eventType: event.event?.eventType,
      documentId: event.document?.documentId,
      status: event.document?.status,
    });

    if (!event.document?.documentId) {
      console.error('No document ID in webhook payload');
      return jsonResponse({ ok: false, error: 'No document ID in payload' });
    }

    const result = await handleBoldSignWebhook(supabaseClient, event);

    return jsonResponse(result, result.ok ? 200 : 400);
  } catch (error) {
    console.error('Webhook function error:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Internal server error',
      500
    );
  }
});
