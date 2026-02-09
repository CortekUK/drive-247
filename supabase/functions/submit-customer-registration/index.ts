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
  customer_type: 'Individual' | 'Company';
  name: string;
  email: string;
  phone: string;
  license_number?: string;
  id_number?: string;
  whatsapp_opt_in?: boolean;
  nok_full_name?: string;
  nok_relationship?: string;
  nok_phone?: string;
  nok_email?: string;
  nok_address?: string;
  verificationSessionId?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body: RegistrationData = await req.json();
    const { token, customer_type, name, email, phone, license_number, id_number, whatsapp_opt_in, nok_full_name, nok_relationship, nok_phone, nok_email, nok_address, verificationSessionId } = body;

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

    // Check blocked identities
    const identifiersToCheck = [license_number, id_number].filter(Boolean);
    if (identifiersToCheck.length > 0) {
      const { data: blockCheck } = await supabase
        .from('blocked_identities')
        .select('identity_type, reason, identity_number')
        .in('identity_number', identifiersToCheck)
        .eq('is_active', true)
        .in('identity_type', ['license', 'id_card', 'passport'])
        .limit(1)
        .single();

      if (blockCheck) {
        // Revert the invite back to pending since registration failed
        await supabase
          .from('customer_registration_invites')
          .update({ status: 'pending', completed_at: null })
          .eq('id', invite.id);
        return errorResponse(`This ${blockCheck.identity_type} number is blocked: ${blockCheck.reason}`);
      }

      // Also check blocked customers by license/ID
      const orConditions: string[] = [];
      if (license_number) orConditions.push(`license_number.eq.${license_number}`);
      if (id_number) orConditions.push(`id_number.eq.${id_number}`);

      if (orConditions.length > 0) {
        const { data: blockedCustomer } = await supabase
          .from('customers')
          .select('name, blocked_reason')
          .eq('is_blocked', true)
          .or(orConditions.join(','))
          .limit(1)
          .single();

        if (blockedCustomer) {
          await supabase
            .from('customer_registration_invites')
            .update({ status: 'pending', completed_at: null })
            .eq('id', invite.id);
          return errorResponse(`This identity belongs to a blocked customer: ${blockedCustomer.blocked_reason || 'Blocked'}`);
        }
      }
    }

    // Check duplicate license number within this tenant
    if (license_number) {
      const { data: dupLicense } = await supabase
        .from('customers')
        .select('id, name')
        .eq('tenant_id', tenantId)
        .eq('license_number', license_number.trim())
        .limit(1)
        .single();

      if (dupLicense) {
        await supabase
          .from('customer_registration_invites')
          .update({ status: 'pending', completed_at: null })
          .eq('id', invite.id);
        return errorResponse(`A customer with this license number already exists: ${dupLicense.name}`);
      }
    }

    // Check duplicate email within this tenant
    if (email) {
      const { data: dupEmail } = await supabase
        .from('customers')
        .select('id, name')
        .eq('tenant_id', tenantId)
        .eq('email', email.trim().toLowerCase())
        .limit(1)
        .single();

      if (dupEmail) {
        await supabase
          .from('customer_registration_invites')
          .update({ status: 'pending', completed_at: null })
          .eq('id', invite.id);
        return errorResponse(`A customer with this email already exists: ${dupEmail.name}`);
      }
    }

    // Insert the customer
    const { data: newCustomer, error: customerError } = await supabase
      .from('customers')
      .insert({
        tenant_id: tenantId,
        customer_type: customer_type || 'Individual',
        type: customer_type || 'Individual',
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        license_number: license_number?.trim() || null,
        id_number: id_number?.trim() || null,
        whatsapp_opt_in: whatsapp_opt_in || false,
        status: 'Active',
        nok_full_name: nok_full_name || null,
        nok_relationship: nok_relationship || null,
        nok_phone: nok_phone || null,
        nok_email: nok_email || null,
        nok_address: nok_address || null,
      })
      .select('id')
      .single();

    if (customerError) {
      console.error('Error creating customer:', customerError);
      // Revert invite
      await supabase
        .from('customer_registration_invites')
        .update({ status: 'pending', completed_at: null })
        .eq('id', invite.id);
      return errorResponse('Failed to create customer: ' + customerError.message, 500);
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
