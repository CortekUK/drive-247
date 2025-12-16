import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { create } from 'https://deno.land/x/djwt@v3.0.1/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-docusign-signature-1',
};

interface DocuSignEvent {
  event: string;
  apiVersion: string;
  uri: string;
  retryCount: number;
  configurationId: string;
  generatedDateTime: string;
  data: {
    accountId: string;
    userId: string;
    envelopeId: string;
    envelopeSummary?: {
      status: string;
      emailSubject: string;
      statusChangedDateTime: string;
      documentsUri: string;
      recipientsUri: string;
      envelopeUri: string;
      emailBlurb?: string;
      envelopeId: string;
      customFieldsUri: string;
      notificationUri: string;
      enableWetSign: string;
      allowMarkup: string;
      allowReassign: string;
    };
  };
}

// Helper function to convert PKCS#1 to PKCS#8 format
function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  const version = new Uint8Array([0x02, 0x01, 0x00]);
  const algorithmOid = new Uint8Array([
    0x06, 0x09,
    0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01
  ]);
  const algorithmNull = new Uint8Array([0x05, 0x00]);
  const algorithmSequence = new Uint8Array([
    0x30, algorithmOid.length + algorithmNull.length,
    ...algorithmOid,
    ...algorithmNull
  ]);
  const privateKeyOctetString = new Uint8Array([
    0x04,
    ...encodeLengthBytes(pkcs1.length),
    ...pkcs1
  ]);
  const inner = new Uint8Array([
    ...version,
    ...algorithmSequence,
    ...privateKeyOctetString
  ]);
  return new Uint8Array([
    0x30,
    ...encodeLengthBytes(inner.length),
    ...inner
  ]);
}

function encodeLengthBytes(length: number): Uint8Array {
  if (length < 128) {
    return new Uint8Array([length]);
  }
  const bytes: number[] = [];
  let temp = length;
  while (temp > 0) {
    bytes.unshift(temp & 0xff);
    temp >>= 8;
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

// Get DocuSign JWT access token
async function getDocuSignAccessToken(
  integrationKey: string,
  userId: string,
  privateKey: string,
  baseUrl: string
): Promise<{ accessToken: string; expiresIn: number } | null> {
  try {
    console.log('Generating JWT for DocuSign authentication...');

    // Parse the private key
    const pemKey = privateKey
      .replace(/\\n/g, '\n')
      .replace(/-----BEGIN RSA PRIVATE KEY-----/, '')
      .replace(/-----END RSA PRIVATE KEY-----/, '')
      .trim();

    // Base64 decode PKCS#1 key
    const pkcs1 = Uint8Array.from(atob(pemKey), c => c.charCodeAt(0));

    // Convert to PKCS#8
    const pkcs8 = pkcs1ToPkcs8(pkcs1);

    // Import the private key for signing
    const cryptoKey = await crypto.subtle.importKey(
      'pkcs8',
      pkcs8,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );

    // Create JWT payload
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: integrationKey,
      sub: userId,
      aud: baseUrl.includes('demo') ? 'account-d.docusign.com' : 'account.docusign.com',
      iat: now,
      exp: now + 3600,
      scope: 'signature impersonation'
    };

    // Sign the JWT
    const jwt = await create(
      { alg: 'RS256', typ: 'JWT' },
      payload,
      cryptoKey
    );

    console.log('JWT generated, requesting access token...');

    // Exchange JWT for access token
    const authUrl = baseUrl.includes('demo')
      ? 'https://account-d.docusign.com/oauth/token'
      : 'https://account.docusign.com/oauth/token';

    const response = await fetch(authUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('DocuSign auth error:', response.status, errorText);
      return null;
    }

    const data = await response.json();
    console.log('Access token obtained successfully');

    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in
    };

  } catch (error) {
    console.error('Error getting DocuSign access token:', error);
    return null;
  }
}

async function downloadSignedDocument(
  supabaseClient: any,
  envelopeId: string,
  accountId: string,
  baseUrl: string,
  accessToken: string
): Promise<{ success: boolean; fileUrl?: string; error?: string }> {
  try {
    console.log('Downloading signed document from DocuSign for envelope:', envelopeId);

    // Download the combined signed PDF from DocuSign
    const docUrl = `${baseUrl}/v2.1/accounts/${accountId}/envelopes/${envelopeId}/documents/combined`;
    console.log('Fetching document from:', docUrl);

    const response = await fetch(docUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error downloading from DocuSign:', response.status, errorText);
      return { success: false, error: `DocuSign download failed: ${response.status}` };
    }

    const pdfBlob = await response.blob();
    console.log('Document downloaded, size:', pdfBlob.size, 'bytes');

    // Upload to Supabase Storage
    const fileName = `rental-agreement-${envelopeId}-signed.pdf`;
    console.log('Uploading to Supabase Storage, filename:', fileName);

    const { data: uploadData, error: uploadError } = await supabaseClient.storage
      .from('customer-documents')
      .upload(fileName, pdfBlob, {
        contentType: 'application/pdf',
        upsert: true  // Changed to true in case file already exists
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

async function handleDocuSignWebhook(supabaseClient: any, event: DocuSignEvent) {
  try {
    console.log('Processing DocuSign webhook:', event.event);
    console.log('Full event data:', JSON.stringify(event, null, 2));

    const envelopeId = event.data.envelopeId;
    const status = event.data.envelopeSummary?.status || event.event?.replace('envelope-', '');

    if (!envelopeId) {
      console.error('No envelope ID in webhook event');
      return { ok: false, error: 'Missing envelope ID' };
    }

    console.log(`Envelope ${envelopeId} status: ${status}`);

    // Find the rental by envelope ID
    const { data: rental, error: rentalError } = await supabaseClient
      .from('rentals')
      .select('*, customers:customer_id(id, name, email)')
      .eq('docusign_envelope_id', envelopeId)
      .single();

    if (rentalError || !rental) {
      console.error('Rental not found for envelope:', envelopeId);
      return { ok: false, error: 'Rental not found' };
    }

    console.log('Found rental:', rental.id, 'Status:', status);

    // Map DocuSign status to our status
    const statusMap: Record<string, string> = {
      'sent': 'sent',
      'delivered': 'delivered',
      'signed': 'signed',
      'completed': 'completed',
      'declined': 'declined',
      'voided': 'voided'
    };

    const mappedStatus = statusMap[status?.toLowerCase() || ''] || 'pending';
    const updateData: any = {
      document_status: mappedStatus
    };

    // If completed, download the signed document
    if (mappedStatus === 'completed') {
      console.log('Envelope completed, downloading signed document...');

      // Get DocuSign credentials
      const DOCUSIGN_INTEGRATION_KEY = Deno.env.get('DOCUSIGN_INTEGRATION_KEY');
      const DOCUSIGN_USER_ID = Deno.env.get('DOCUSIGN_USER_ID');
      const DOCUSIGN_ACCOUNT_ID = Deno.env.get('DOCUSIGN_ACCOUNT_ID');
      const DOCUSIGN_PRIVATE_KEY = Deno.env.get('DOCUSIGN_PRIVATE_KEY');
      const DOCUSIGN_BASE_URL = Deno.env.get('DOCUSIGN_BASE_URL') || 'https://demo.docusign.net/restapi';

      if (!DOCUSIGN_INTEGRATION_KEY || !DOCUSIGN_USER_ID || !DOCUSIGN_PRIVATE_KEY) {
        console.error('DocuSign credentials not configured');
        return { ok: false, error: 'DocuSign credentials missing' };
      }

      // Get access token
      const authResult = await getDocuSignAccessToken(
        DOCUSIGN_INTEGRATION_KEY,
        DOCUSIGN_USER_ID,
        DOCUSIGN_PRIVATE_KEY,
        DOCUSIGN_BASE_URL
      );

      if (!authResult) {
        console.error('Failed to get DocuSign access token');
        return { ok: false, error: 'Authentication failed' };
      }

      // Download signed document
      const downloadResult = await downloadSignedDocument(
        supabaseClient,
        envelopeId,
        event.data.accountId || DOCUSIGN_ACCOUNT_ID!,
        DOCUSIGN_BASE_URL,
        authResult.accessToken
      );

      if (downloadResult.success && downloadResult.fileUrl) {
        console.log('Creating customer_documents record...');
        console.log('Customer ID:', rental.customer_id);
        console.log('Customer name:', rental.customers.name);
        console.log('File URL:', downloadResult.fileUrl);

        // Create customer_documents record
        const { data: docRecord, error: docError } = await supabaseClient
          .from('customer_documents')
          .insert({
            customer_id: rental.customer_id,
            document_type: 'Other',  // Changed from 'Rental Agreement' to match DB constraint
            document_name: `Signed Rental Agreement - ${rental.customers.name}`,
            file_url: downloadResult.fileUrl,
            file_name: downloadResult.fileName || `rental-agreement-${envelopeId}-signed.pdf`,
            mime_type: 'application/pdf',
            verified: true,
            status: 'Active'
          })
          .select()
          .single();

        if (docError) {
          console.error('Error creating document record:', docError);
          console.error('Full error details:', JSON.stringify(docError, null, 2));
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

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // DocuSign webhooks don't need authentication - we verify by checking the envelope exists in our DB
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      }
    );

    const event = await req.json() as DocuSignEvent;

    // Log webhook event
    console.log('Received DocuSign webhook event:', {
      event: event.event,
      envelopeId: event.data.envelopeId,
      status: event.data.envelopeSummary?.status
    });

    const result = await handleDocuSignWebhook(supabaseClient, event);

    return new Response(
      JSON.stringify(result),
      {
        status: result.ok ? 200 : 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Webhook function error:', error);
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Internal server error',
        detail: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
