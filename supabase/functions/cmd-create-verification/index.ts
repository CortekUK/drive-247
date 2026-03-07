import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  createModivesVerification,
  getVerificationDetail,
  generateMagicLink,
} from "../_shared/modives-client.ts";

interface CreateVerificationRequest {
  rentalId: string;
  customerId: string;
  tenantId: string;
  verificationType: 'insurance' | 'license';
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  initiatedBy?: string;
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const body: CreateVerificationRequest = await req.json();

    const {
      rentalId,
      customerId,
      tenantId,
      verificationType,
      firstName,
      lastName,
      email,
      phone,
      initiatedBy,
    } = body;

    if (!rentalId || !customerId || !tenantId || !verificationType || !firstName || !lastName || !email || !phone) {
      return errorResponse('Missing required fields: rentalId, customerId, tenantId, verificationType, firstName, lastName, email, phone', 400);
    }

    if (verificationType !== 'insurance' && verificationType !== 'license') {
      return errorResponse('verificationType must be "insurance" or "license"', 400);
    }

    console.log(`[CMD] Creating ${verificationType} verification for rental:`, rentalId);

    // Fetch customer record for address fields required by Modives API
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    const { data: customer, error: customerError } = await supabaseClient
      .from('customers')
      .select('address_street, address_city, address_state, address_zip, phone')
      .eq('id', customerId)
      .single();

    if (customerError || !customer) {
      console.error('[CMD] Failed to fetch customer:', customerError);
      return errorResponse('Failed to fetch customer data', 500);
    }

    // Validate required fields for Modives API
    const missingFields: string[] = [];
    if (!customer.address_street) missingFields.push('Street Address');
    if (!customer.address_city) missingFields.push('City');
    if (!customer.address_state) missingFields.push('State');
    if (!customer.address_zip) missingFields.push('Zip Code');
    if (!phone && !customer.phone) missingFields.push('Phone Number');

    if (missingFields.length > 0) {
      return jsonResponse({
        error: 'missing_customer_fields',
        message: `Customer is missing required fields for CheckMyDriver verification: ${missingFields.join(', ')}. Please update the customer profile first.`,
        missingFields,
      }, 422);
    }

    // Step 1: Create verification (verificationTypeId is always "Rental" at Modives level;
    // our verificationType (insurance/license) is tracked in our DB only)
    console.log('[CMD] Calling createModivesVerification with:', JSON.stringify({
      firstName,
      lastName,
      email,
      phone: phone || customer.phone,
      addressLine1: customer.address_street,
      city: customer.address_city,
      state: customer.address_state,
      zipCode: customer.address_zip,
    }));

    const createResult = await createModivesVerification({
      firstName,
      lastName,
      email,
      phone: phone || customer.phone,
      addressLine1: customer.address_street!,
      city: customer.address_city!,
      state: customer.address_state!,
      zipCode: customer.address_zip!,
    });

    // Step 2: Get verification detail (to get applicantVerificationReqGUIDId)
    console.log('[CMD] createModivesVerification returned:', JSON.stringify(createResult));
    const { verificationId } = createResult;
    console.log('[CMD] Extracted verificationId:', verificationId, 'type:', typeof verificationId);

    const detail = await getVerificationDetail(verificationId);
    const applicantVerificationReqGUIDId = detail.applicantVerificationReqGUIDId;

    if (!applicantVerificationReqGUIDId) {
      console.error('[CMD] No applicantVerificationReqGUIDId in detail:', detail);
      return errorResponse('Failed to get applicant verification reference', 500);
    }

    // Step 3: Generate magic link
    const magicLinkUrl = await generateMagicLink(applicantVerificationReqGUIDId);

    // Step 4: Insert record into database
    const { data: verification, error: insertError } = await supabaseClient
      .from('cmd_verifications')
      .insert({
        tenant_id: tenantId,
        rental_id: rentalId,
        customer_id: customerId,
        verification_type: verificationType,
        cmd_verification_id: verificationId,
        applicant_verification_req_guid_id: applicantVerificationReqGUIDId,
        magic_link_url: magicLinkUrl,
        magic_link_generated_at: new Date().toISOString(),
        status: 'link_generated',
        consumer_first_name: firstName,
        consumer_last_name: lastName,
        consumer_email: email,
        consumer_phone: phone,
        initiated_by: initiatedBy || null,
      })
      .select()
      .single();

    if (insertError) {
      console.error('[CMD] Failed to insert verification record:', insertError);
      return errorResponse(`Failed to save verification: ${insertError.message}`, 500);
    }

    console.log('[CMD] Verification created successfully:', verification.id);

    return jsonResponse({
      ok: true,
      id: verification.id,
      magicLinkUrl,
      cmdVerificationId: verificationId,
    });

  } catch (error) {
    console.error('[CMD] Create verification error:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Internal server error',
      500
    );
  }
});
