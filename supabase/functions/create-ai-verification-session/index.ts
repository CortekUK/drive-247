// @ts-nocheck - This is a Deno Edge Function, not Node.js TypeScript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CreateSessionRequest {
  customerId?: string;
  customerDetails?: {
    name: string;
    email: string;
    phone: string;
  };
  tenantId: string;
  tenantSlug: string;
}

interface CreateSessionResponse {
  ok: boolean;
  sessionId?: string;
  qrToken?: string;
  qrUrl?: string;
  expiresAt?: string;
  error?: string;
  detail?: string;
}

/**
 * Generate a secure QR session token
 * Combines UUID with timestamp for uniqueness
 */
function generateQRToken(): string {
  const uuid = crypto.randomUUID();
  const timestamp = Date.now().toString(36);
  return `${uuid}-${timestamp}`;
}

/**
 * Build the QR URL for the mobile verification page
 */
function buildQRUrl(tenantSlug: string, qrToken: string): string {
  // Use environment variable for base URL, fallback to production URL
  const baseUrl = Deno.env.get('BOOKING_APP_URL') || `https://${tenantSlug}.drive-247.com`;
  return `${baseUrl}/verify/${qrToken}`;
}

/**
 * Check rate limit: max 10 verification sessions per customer per hour
 */
async function checkRateLimit(
  supabase: any,
  customerId?: string,
  customerEmail?: string,
  tenantId?: string
): Promise<{ allowed: boolean; error?: string }> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const MAX_ATTEMPTS_PER_HOUR = 10;

  let query = supabase
    .from('identity_verifications')
    .select('id', { count: 'exact', head: true })
    .eq('verification_provider', 'ai')
    .gte('created_at', oneHourAgo);

  if (customerId) {
    query = query.eq('customer_id', customerId);
  } else if (customerEmail && tenantId) {
    // For booking flow without customer ID, check by external_user_id pattern
    query = query.like('external_user_id', `%${customerEmail}%`);
  }

  const { count, error } = await query;

  if (error) {
    console.error('Rate limit check error:', error);
    // Allow on error to not block legitimate requests
    return { allowed: true };
  }

  console.log(`Rate limit check: ${count}/${MAX_ATTEMPTS_PER_HOUR} attempts for ${customerEmail || customerId}`);

  if (count !== null && count >= MAX_ATTEMPTS_PER_HOUR) {
    return {
      allowed: false,
      error: `Too many verification attempts (${count}/${MAX_ATTEMPTS_PER_HOUR}). Please try again in an hour.`
    };
  }

  return { allowed: true };
}

/**
 * Create AI verification session for an existing customer (portal flow)
 */
async function createSessionForCustomer(
  supabase: any,
  customerId: string,
  tenantSlug: string
): Promise<CreateSessionResponse> {
  try {
    console.log('Creating AI verification session for customer:', customerId);

    // Get customer details
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id, name, email, phone, tenant_id')
      .eq('id', customerId)
      .single();

    if (customerError || !customer) {
      return {
        ok: false,
        error: 'Customer not found',
        detail: customerError?.message || 'Customer does not exist'
      };
    }

    // Check rate limit
    const rateLimitCheck = await checkRateLimit(supabase, customerId);
    if (!rateLimitCheck.allowed) {
      return {
        ok: false,
        error: rateLimitCheck.error || 'Rate limit exceeded'
      };
    }

    // Generate QR token and URL
    const qrToken = generateQRToken();
    const qrUrl = buildQRUrl(tenantSlug, qrToken);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Create verification record
    const verificationData: any = {
      customer_id: customerId,
      tenant_id: customer.tenant_id,
      provider: 'ai',
      verification_provider: 'ai',
      external_user_id: customerId,
      status: 'init',
      review_status: 'init',
      qr_session_token: qrToken,
      qr_session_expires_at: expiresAt.toISOString(),
    };

    const { data: verification, error: verificationError } = await supabase
      .from('identity_verifications')
      .insert(verificationData)
      .select()
      .single();

    if (verificationError) {
      console.error('Error creating verification record:', verificationError);
      return {
        ok: false,
        error: 'Database error',
        detail: verificationError.message
      };
    }

    // Update customer status to pending
    await supabase
      .from('customers')
      .update({ identity_verification_status: 'pending' })
      .eq('id', customerId);

    console.log('AI verification session created successfully:', verification.id);

    return {
      ok: true,
      sessionId: verification.id,
      qrToken: qrToken,
      qrUrl: qrUrl,
      expiresAt: expiresAt.toISOString(),
    };

  } catch (error) {
    console.error('Error creating AI verification session:', error);
    return {
      ok: false,
      error: 'Session creation failed',
      detail: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Create AI verification session for booking flow (no existing customer)
 */
async function createSessionForBooking(
  customerName: string,
  customerEmail: string,
  customerPhone: string,
  tenantId: string,
  tenantSlug: string,
  supabase: any
): Promise<CreateSessionResponse> {
  try {
    console.log('Creating AI verification session for booking:', customerEmail);

    // Check rate limit by email
    const rateLimitCheck = await checkRateLimit(supabase, undefined, customerEmail, tenantId);
    if (!rateLimitCheck.allowed) {
      return {
        ok: false,
        error: rateLimitCheck.error || 'Rate limit exceeded'
      };
    }

    // Generate QR token and URL
    const qrToken = generateQRToken();
    const qrUrl = buildQRUrl(tenantSlug, qrToken);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Create verification record without customer_id (will be auto-linked by email when rental is created)
    const vendorData = `booking_${customerEmail}_${Date.now()}`;
    const verificationData: any = {
      tenant_id: tenantId,
      provider: 'ai',
      verification_provider: 'ai',
      external_user_id: vendorData,
      customer_email: customerEmail.toLowerCase().trim(), // Store email for auto-linking
      status: 'init',
      review_status: 'init',
      qr_session_token: qrToken,
      qr_session_expires_at: expiresAt.toISOString(),
      // Store customer details in a way that can be retrieved later
      first_name: customerName.split(' ')[0] || null,
      last_name: customerName.split(' ').slice(1).join(' ') || null,
    };

    const { data: verification, error: verificationError } = await supabase
      .from('identity_verifications')
      .insert(verificationData)
      .select()
      .single();

    if (verificationError) {
      console.error('Error creating verification record:', verificationError);
      return {
        ok: false,
        error: 'Database error',
        detail: verificationError.message
      };
    }

    console.log('AI booking verification session created successfully:', verification.id);

    return {
      ok: true,
      sessionId: verification.id,
      qrToken: qrToken,
      qrUrl: qrUrl,
      expiresAt: expiresAt.toISOString(),
    };

  } catch (error) {
    console.error('Error creating AI booking verification session:', error);
    return {
      ok: false,
      error: 'Session creation failed',
      detail: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { customerId, customerDetails, tenantId, tenantSlug } = await req.json() as CreateSessionRequest;

    // Validate request
    if (!customerId && !customerDetails) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Either customerId or customerDetails is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!tenantSlug) {
      return new Response(
        JSON.stringify({ ok: false, error: 'tenantSlug is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client with service role
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    let result: CreateSessionResponse;

    if (customerId) {
      // Portal usage - existing customer
      result = await createSessionForCustomer(supabaseClient, customerId, tenantSlug);
    } else if (customerDetails) {
      // Booking flow - no existing customer
      const { name, email, phone } = customerDetails;
      if (!name || !email || !phone) {
        return new Response(
          JSON.stringify({ ok: false, error: 'customerDetails must include name, email, and phone' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (!tenantId) {
        return new Response(
          JSON.stringify({ ok: false, error: 'tenantId is required for booking flow' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      result = await createSessionForBooking(name, email, phone, tenantId, tenantSlug, supabaseClient);
    } else {
      return new Response(
        JSON.stringify({ ok: false, error: 'Invalid request' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify(result),
      {
        status: result.ok ? 200 : 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Function error:', error);
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
