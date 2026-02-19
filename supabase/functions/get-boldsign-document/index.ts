import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { envelopeId, rentalId } = await req.json();

    if (!envelopeId && !rentalId) {
      return errorResponse('envelopeId or rentalId is required', 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    let documentId = envelopeId;

    // If rentalId provided, get document ID from rental
    if (rentalId && !envelopeId) {
      const { data: rental, error: rentalError } = await supabase
        .from('rentals')
        .select('docusign_envelope_id, document_status, signed_document_id')
        .eq('id', rentalId)
        .single();

      if (rentalError || !rental) {
        return errorResponse('Rental not found', 404);
      }

      // If signed document exists, return its URL
      if (rental.signed_document_id) {
        const { data: doc } = await supabase
          .from('customer_documents')
          .select('file_url')
          .eq('id', rental.signed_document_id)
          .single();

        if (doc?.file_url) {
          if (doc.file_url.startsWith('http')) {
            return jsonResponse({
              ok: true,
              documentUrl: doc.file_url,
              status: 'completed',
              source: 'stored',
            });
          }

          const { data: urlData } = supabase.storage
            .from('customer-documents')
            .getPublicUrl(doc.file_url);

          return jsonResponse({
            ok: true,
            documentUrl: urlData.publicUrl,
            status: 'completed',
            source: 'stored',
          });
        }
      }

      if (!rental.docusign_envelope_id) {
        return errorResponse('No signed document for this rental', 404);
      }

      documentId = rental.docusign_envelope_id;
    }

    // Get BoldSign credentials
    const BOLDSIGN_API_KEY = Deno.env.get('BOLDSIGN_API_KEY');
    const BOLDSIGN_BASE_URL = Deno.env.get('BOLDSIGN_BASE_URL') || 'https://api.boldsign.com';

    if (!BOLDSIGN_API_KEY) {
      return errorResponse('BoldSign not configured', 500);
    }

    // Get document properties for status
    const propsResponse = await fetch(
      `${BOLDSIGN_BASE_URL}/v1/document/properties?documentId=${documentId}`,
      {
        headers: { 'X-API-KEY': BOLDSIGN_API_KEY },
      }
    );

    if (!propsResponse.ok) {
      return errorResponse('Failed to get document properties', 500);
    }

    const propsData = await propsResponse.json();
    const documentStatus = propsData.status;

    // Download the document PDF
    const docResponse = await fetch(
      `${BOLDSIGN_BASE_URL}/v1/document/download?documentId=${documentId}`,
      {
        headers: { 'X-API-KEY': BOLDSIGN_API_KEY },
      }
    );

    if (!docResponse.ok) {
      return errorResponse('Failed to get document from BoldSign', 500);
    }

    // Get the PDF as base64
    const pdfBuffer = await docResponse.arrayBuffer();
    const uint8Array = new Uint8Array(pdfBuffer);

    // Convert to base64 in chunks to avoid stack overflow
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length));
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    const pdfBase64 = btoa(binary);

    return jsonResponse({
      ok: true,
      documentBase64: pdfBase64,
      contentType: 'application/pdf',
      status: documentStatus,
      source: 'boldsign',
    });
  } catch (error) {
    console.error('Error:', error);
    return errorResponse(`Internal error: ${String(error)}`, 500);
  }
});
