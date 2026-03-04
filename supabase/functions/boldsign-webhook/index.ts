import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getBoldSignApiKey, getBoldSignBaseUrl, getTenantBoldSignMode } from '../_shared/boldsign-client.ts';
import type { BoldSignMode } from '../_shared/boldsign-client.ts';

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

    // Step 1: Look up rental_agreements by document_id (new table)
    const { data: agreement } = await supabaseClient
      .from('rental_agreements')
      .select('id, rental_id, tenant_id, agreement_type, boldsign_mode')
      .eq('document_id', documentId)
      .maybeSingle();

    let rental: any;
    let agreementType: 'original' | 'extension' = 'original';
    let agreementId: string | null = null;

    if (agreement) {
      // Found in rental_agreements table
      agreementId = agreement.id;
      agreementType = agreement.agreement_type as 'original' | 'extension';
      console.log('Found agreement:', agreementId, 'type:', agreementType);

      const { data: rentalData, error: rentalError } = await supabaseClient
        .from('rentals')
        .select('*, tenant_id, boldsign_mode, customers:customer_id(id, name, email)')
        .eq('id', agreement.rental_id)
        .single();

      if (rentalError || !rentalData) {
        console.error('Rental not found for agreement:', agreementId);
        return { ok: false, error: 'Rental not found' };
      }
      rental = rentalData;
    } else {
      // Step 2: Fallback to rentals.docusign_envelope_id (backward compat)
      console.log('Agreement not found in rental_agreements, falling back to rentals table');
      const { data: rentalData, error: rentalError } = await supabaseClient
        .from('rentals')
        .select('*, tenant_id, boldsign_mode, customers:customer_id(id, name, email)')
        .eq('docusign_envelope_id', documentId)
        .single();

      if (rentalError || !rentalData) {
        console.error('Rental not found for document:', documentId);
        return { ok: false, error: 'Rental not found' };
      }
      rental = rentalData;
    }

    console.log('Found rental:', rental.id, 'Event:', eventType, 'Agreement type:', agreementType);

    const mappedStatus = mapBoldSignStatus(eventType);

    // Always update rental_agreements row if we have one
    if (agreementId) {
      const agreementUpdate: Record<string, unknown> = {
        document_status: mappedStatus,
      };
      if (mappedStatus === 'completed') {
        agreementUpdate.envelope_completed_at = new Date().toISOString();
      }

      // Download signed document for completed agreements (both original and extension)
      if (mappedStatus === 'completed') {
        const resolvedMode = await resolveMode(supabaseClient, agreement, rental);
        const downloadResult = await downloadAndStore(supabaseClient, documentId, resolvedMode, rental, agreementType);
        if (downloadResult.docRecordId) {
          agreementUpdate.signed_document_id = downloadResult.docRecordId;
        }
      }

      await supabaseClient
        .from('rental_agreements')
        .update(agreementUpdate)
        .eq('id', agreementId);
    }

    // For original agreements (or fallback without agreement row): update rentals too
    if (agreementType === 'original') {
      const rentalUpdate: Record<string, unknown> = {
        document_status: mappedStatus,
      };

      if (mappedStatus === 'completed') {
        rentalUpdate.status = 'Active';

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

        // Download signed doc if not already done via agreement path
        if (!agreementId) {
          const resolvedMode = await resolveMode(supabaseClient, null, rental);
          const downloadResult = await downloadAndStore(supabaseClient, documentId, resolvedMode, rental, 'original');
          if (downloadResult.docRecordId) {
            rentalUpdate.signed_document_id = downloadResult.docRecordId;
            rentalUpdate.envelope_completed_at = new Date().toISOString();
          }
        } else {
          // Copy signed_document_id from agreement update
          const { data: updatedAgreement } = await supabaseClient
            .from('rental_agreements')
            .select('signed_document_id, envelope_completed_at')
            .eq('id', agreementId)
            .single();
          if (updatedAgreement?.signed_document_id) {
            rentalUpdate.signed_document_id = updatedAgreement.signed_document_id;
            rentalUpdate.envelope_completed_at = updatedAgreement.envelope_completed_at;
          }
        }
      }

      const { error: updateError } = await supabaseClient
        .from('rentals')
        .update(rentalUpdate)
        .eq('id', rental.id);

      if (updateError) {
        console.error('Error updating rental:', updateError);
        return { ok: false, error: updateError.message };
      }
    }
    // For extension agreements: do NOT change rental status or vehicle status

    // Send customer notification when agreement is signed or completed
    if (mappedStatus === 'signed' || mappedStatus === 'completed') {
      try {
        const { data: customerUser } = await supabaseClient
          .from('customer_users')
          .select('id')
          .eq('customer_id', rental.customer_id)
          .eq('tenant_id', rental.tenant_id)
          .maybeSingle();

        if (customerUser?.id) {
          // Fetch tenant name for the notification message
          const { data: tenantData } = await supabaseClient
            .from('tenants')
            .select('company_name, app_name')
            .eq('id', rental.tenant_id)
            .single();

          const companyName = tenantData?.company_name || tenantData?.app_name || 'Drive 247';

          await supabaseClient
            .from('customer_notifications')
            .insert({
              customer_user_id: customerUser.id,
              tenant_id: rental.tenant_id,
              title: 'Rental Agreement Signed',
              message: `Your rental agreement with ${companyName} has been successfully signed. You can view and download it from your Agreements page.`,
              type: 'agreement',
              link: '/portal/agreements',
              metadata: { rental_id: rental.id, document_id: documentId },
            });
          console.log('Agreement signed notification sent to customer:', customerUser.id);
        }
      } catch (notifErr) {
        console.warn('Failed to create agreement signed notification:', notifErr);
      }
    }

    console.log('Successfully processed webhook for rental:', rental.id, 'agreement type:', agreementType);
    return { ok: true };
  } catch (error) {
    console.error('Error handling webhook:', error);
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Helper: resolve BoldSign mode from agreement/rental/tenant
async function resolveMode(
  supabaseClient: ReturnType<typeof createClient>,
  agreement: { boldsign_mode: string | null } | null,
  rental: any
): Promise<BoldSignMode> {
  let mode: BoldSignMode = (agreement?.boldsign_mode as BoldSignMode) || (rental.boldsign_mode as BoldSignMode) || 'test';
  if (!mode || mode === ('test' as any)) {
    if (rental.tenant_id) {
      mode = await getTenantBoldSignMode(supabaseClient, rental.tenant_id);
    }
  }
  return mode;
}

// Helper: download signed PDF, store in customer_documents, return record ID
async function downloadAndStore(
  supabaseClient: ReturnType<typeof createClient>,
  documentId: string,
  boldsignMode: BoldSignMode,
  rental: any,
  agreementType: string
): Promise<{ docRecordId?: string }> {
  let BOLDSIGN_API_KEY: string;
  try {
    BOLDSIGN_API_KEY = getBoldSignApiKey(boldsignMode);
  } catch {
    console.error('BoldSign API key not configured for mode:', boldsignMode);
    return {};
  }
  const BOLDSIGN_BASE_URL = getBoldSignBaseUrl();

  const downloadResult = await downloadSignedDocument(
    supabaseClient,
    documentId,
    BOLDSIGN_API_KEY,
    BOLDSIGN_BASE_URL
  );

  if (downloadResult.success && downloadResult.fileUrl) {
    console.log('Creating customer_documents record...');
    const docLabel = agreementType === 'extension' ? 'Extension Agreement' : 'Rental Agreement';

    const { data: docRecord, error: docError } = await supabaseClient
      .from('customer_documents')
      .insert({
        customer_id: rental.customer_id,
        document_type: 'Other',
        document_name: `Signed ${docLabel} - ${rental.customers?.name || 'Customer'}`,
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
      return {};
    }
    console.log('Created document record:', docRecord.id);
    return { docRecordId: docRecord.id };
  }

  console.error('Failed to download signed document:', downloadResult.error);
  return {};
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
