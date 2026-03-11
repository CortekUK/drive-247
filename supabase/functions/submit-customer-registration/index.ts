import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function errorResponse(message: string, status = 400) {
  return jsonResponse({ error: message }, status);
}

interface RegistrationData {
  token: string;
  name: string;
  email: string;
  phone: string;
  verificationSessionId?: string;
  isGigDriver?: boolean;
  gigDriverImagePaths?: string[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body: RegistrationData = await req.json();
    const { token, name, email, phone, verificationSessionId, isGigDriver, gigDriverImagePaths } = body;

    // Validate required fields
    if (!token) return errorResponse('token is required');
    if (!name) return errorResponse('name is required');
    if (!email) return errorResponse('email is required');
    if (!phone) return errorResponse('phone is required');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Atomic claim: update invite status from 'pending' to 'used' and return it
    // This prevents race conditions where two submissions use the same token
    const { data: invite, error: claimError } = await supabase
      .from('customer_registration_invites')
      .update({ status: 'used', completed_at: new Date().toISOString() })
      .eq('token', token)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .select('id, tenant_id')
      .single();

    if (claimError || !invite) {
      return errorResponse('Invalid, expired, or already used invite link');
    }

    const tenantId = invite.tenant_id;

    // Check if email is globally blacklisted
    const { data: blacklisted } = await supabase
      .rpc('is_globally_blacklisted', { p_email: email.trim().toLowerCase() });

    if (blacklisted) {
      await supabase
        .from('customer_registration_invites')
        .update({ status: 'pending', completed_at: null })
        .eq('id', invite.id);
      return errorResponse('Registration cannot be completed. Please contact support.', 403);
    }

    // Check if email is in blocked_identities for this tenant
    const { data: blockedEmail } = await supabase
      .from('blocked_identities')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('identity_number', email.trim().toLowerCase())
      .eq('identity_type', 'email')
      .eq('is_active', true)
      .maybeSingle();

    if (blockedEmail) {
      await supabase
        .from('customer_registration_invites')
        .update({ status: 'pending', completed_at: null })
        .eq('id', invite.id);
      return errorResponse('Registration cannot be completed. Please contact support.', 403);
    }

    // Check duplicate email (global unique constraint on customers.email)
    if (email) {
      const { data: dupEmail } = await supabase
        .from('customers')
        .select('id, name')
        .eq('email', email.trim().toLowerCase())
        .limit(1)
        .single();

      if (dupEmail) {
        await supabase
          .from('customer_registration_invites')
          .update({ status: 'pending', completed_at: null })
          .eq('id', invite.id);
        return errorResponse('A customer with this email already exists');
      }
    }

    // Insert the customer
    const customerPayload: Record<string, unknown> = {
      tenant_id: tenantId,
      customer_type: 'Individual',
      type: 'Individual',
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      status: 'Active',
    };
    if (isGigDriver) {
      customerPayload.is_gig_driver = true;
    }

    const { data: newCustomer, error: customerError } = await supabase
      .from('customers')
      .insert(customerPayload)
      .select('id')
      .single();

    if (customerError) {
      console.error('Error creating customer:', customerError);
      // Revert invite
      await supabase
        .from('customer_registration_invites')
        .update({ status: 'pending', completed_at: null })
        .eq('id', invite.id);
      const isDuplicate = customerError.message?.includes('unique constraint') || customerError.code === '23505';
      const msg = isDuplicate ? 'A customer with this email already exists' : 'Failed to create customer. Please try again.';
      return errorResponse(msg, isDuplicate ? 400 : 500);
    }

    // Link the invite to the customer
    await supabase
      .from('customer_registration_invites')
      .update({ customer_id: newCustomer.id })
      .eq('id', invite.id);

    // Link identity verification to new customer if verificationSessionId provided
    if (verificationSessionId) {
      const { error: linkError } = await supabase
        .from('identity_verifications')
        .update({
          customer_id: newCustomer.id,
          customer_email: email.trim().toLowerCase(),
        })
        .eq('session_id', verificationSessionId)
        .eq('tenant_id', tenantId);

      if (linkError) {
        console.error('Error linking verification:', linkError);
        // Non-fatal — customer was still created
      }

      // Check if the linked verification's document number is in blocked_identities
      const { data: verification } = await supabase
        .from('identity_verifications')
        .select('document_number')
        .eq('session_id', verificationSessionId)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (verification?.document_number) {
        const { data: blockedIdentity } = await supabase
          .from('blocked_identities')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('identity_number', verification.document_number)
          .eq('is_active', true)
          .maybeSingle();

        if (blockedIdentity) {
          // Block the newly created customer
          await supabase
            .from('customers')
            .update({
              is_blocked: true,
              blocked_at: new Date().toISOString(),
              blocked_reason: 'Blocked identity document detected during registration',
            })
            .eq('id', newCustomer.id);

          return errorResponse('Registration cannot be completed. Please contact support.', 403);
        }
      }
    }

    // Link gig driver images if provided
    if (isGigDriver && gigDriverImagePaths && gigDriverImagePaths.length > 0) {
      for (const imagePath of gigDriverImagePaths) {
        // Move from pending/ to proper path
        const fileName = imagePath.split('/').pop() || imagePath;
        const finalPath = `${tenantId}/${newCustomer.id}/${fileName}`;

        const { error: moveError } = await supabase.storage
          .from('gig-driver-images')
          .move(imagePath, finalPath);

        const storedPath = moveError ? imagePath : finalPath;

        const { error: imgError } = await supabase
          .from('gig_driver_images')
          .insert({
            customer_id: newCustomer.id,
            tenant_id: tenantId,
            image_url: storedPath,
            file_name: fileName,
          });

        if (imgError) {
          console.error('Error linking gig driver image:', imgError);
          // Non-fatal
        }
      }
    }

    return jsonResponse({
      ok: true,
      customerId: newCustomer.id,
    });
  } catch (error) {
    console.error('Function error:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Internal server error',
      500
    );
  }
});
