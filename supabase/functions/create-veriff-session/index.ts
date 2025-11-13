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
}

interface CreateSessionResponse {
  ok: boolean;
  verificationId?: string;
  sessionUrl?: string;
  sessionToken?: string;
  error?: string;
  detail?: string;
}

// Create Veriff verification session
async function createVeriffSession(
  apiKey: string,
  apiSecret: string,
  baseUrl: string,
  customerName: string,
  vendorData: string,
  callbackUrl?: string
): Promise<{ sessionUrl: string; sessionToken: string; sessionId: string } | null> {
  try {
    console.log('Creating Veriff session for:', vendorData);

    const requestBody: any = {
      verification: {
        person: {
          firstName: customerName?.split(' ')[0] || 'Unknown',
          lastName: customerName?.split(' ').slice(1).join(' ') || 'Customer',
        },
        vendorData: vendorData,
      }
    };

    // Add callback URL if provided (overrides dashboard settings)
    if (callbackUrl) {
      requestBody.verification.callback = callbackUrl;
    }

    const response = await fetch(`${baseUrl}/v1/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AUTH-CLIENT': apiKey,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Veriff session creation error:', response.status, errorText);
      return null;
    }

    const data = await response.json();
    console.log('Veriff session created:', data.verification.id);

    return {
      sessionUrl: data.verification.url,
      sessionToken: data.verification.sessionToken || data.verification.id,
      sessionId: data.verification.id,
    };

  } catch (error) {
    console.error('Error creating Veriff session:', error);
    return null;
  }
}

async function createVerificationSession(
  supabase: any,
  customerId: string
): Promise<CreateSessionResponse> {
  try {
    console.log('Creating Veriff verification session for customer:', customerId);

    // Get customer details
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('*')
      .eq('id', customerId)
      .single();

    if (customerError || !customer) {
      return {
        ok: false,
        error: 'Customer not found',
        detail: customerError?.message || 'Customer does not exist'
      };
    }

    // Get Veriff credentials from environment
    const VERIFF_API_KEY = Deno.env.get('VERIFF_API_KEY');
    const VERIFF_API_SECRET = Deno.env.get('VERIFF_API_SECRET');
    const VERIFF_BASE_URL = Deno.env.get('VERIFF_BASE_URL') || 'https://stationapi.veriff.com';

    if (!VERIFF_API_KEY) {
      return {
        ok: false,
        error: 'Veriff configuration missing',
        detail: 'Missing VERIFF_API_KEY environment variable'
      };
    }

    // Create Veriff session (no callback URL - will use dashboard settings for portal)
    const sessionResult = await createVeriffSession(
      VERIFF_API_KEY,
      VERIFF_API_SECRET || '',
      VERIFF_BASE_URL,
      customer.name,
      customer.id,
      undefined // Use dashboard default callback for portal
    );

    if (!sessionResult) {
      return {
        ok: false,
        error: 'Failed to create Veriff session',
        detail: 'Could not create session with Veriff'
      };
    }

    // Create verification record
    const { data: verification, error: verificationError } = await supabase
      .from('identity_verifications')
      .insert({
        customer_id: customerId,
        provider: 'veriff',
        session_id: sessionResult.sessionId,
        verification_token: sessionResult.sessionToken,
        external_user_id: customerId,
        status: 'init',
        review_status: 'init',
        verification_url: sessionResult.sessionUrl,
      })
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

    // Update customer status
    await supabase
      .from('customers')
      .update({ identity_verification_status: 'pending' })
      .eq('id', customerId);

    console.log('Verification session created successfully');

    return {
      ok: true,
      verificationId: verification.id,
      sessionUrl: sessionResult.sessionUrl,
      sessionToken: sessionResult.sessionToken,
    };

  } catch (error) {
    console.error('Error creating verification session:', error);
    return {
      ok: false,
      error: 'Verification session creation failed',
      detail: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Create verification session for booking flow (without existing customer)
async function createBookingVerificationSession(
  customerName: string,
  customerEmail: string,
  customerPhone: string
): Promise<CreateSessionResponse> {
  try {
    console.log('Creating Veriff verification session for booking:', customerEmail);

    // Get Veriff credentials from environment
    const VERIFF_API_KEY = Deno.env.get('VERIFF_API_KEY');
    const VERIFF_API_SECRET = Deno.env.get('VERIFF_API_SECRET');
    const VERIFF_BASE_URL = Deno.env.get('VERIFF_BASE_URL') || 'https://stationapi.veriff.com';

    if (!VERIFF_API_KEY) {
      return {
        ok: false,
        error: 'Veriff configuration missing',
        detail: 'Missing VERIFF_API_KEY environment variable'
      };
    }

    // Create Veriff session with email as vendorData (since no customer ID yet)
    const vendorData = `booking_${customerEmail}_${Date.now()}`;

    // For booking flow, don't set a callback URL - popup will stay on Veriff success page
    // User can close the popup manually after verification completes
    // The webhook will still update the verification status in the background
    const sessionResult = await createVeriffSession(
      VERIFF_API_KEY,
      VERIFF_API_SECRET || '',
      VERIFF_BASE_URL,
      customerName,
      vendorData,
      undefined // No callback URL for booking flow
    );

    if (!sessionResult) {
      return {
        ok: false,
        error: 'Failed to create Veriff session',
        detail: 'Could not create session with Veriff'
      };
    }

    console.log('Booking verification session created successfully');

    // Return session details without storing in DB (will be stored when customer is created)
    return {
      ok: true,
      sessionUrl: sessionResult.sessionUrl,
      sessionToken: sessionResult.sessionToken,
      verificationId: sessionResult.sessionId,
    };

  } catch (error) {
    console.error('Error creating booking verification session:', error);
    return {
      ok: false,
      error: 'Verification session creation failed',
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
    const { customerId, customerDetails } = await req.json() as CreateSessionRequest;

    // Validate request - either customerId or customerDetails must be provided
    if (!customerId && !customerDetails) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Either customerId or customerDetails is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let result: CreateSessionResponse;

    if (customerId) {
      // Portal usage - existing customer
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );
      result = await createVerificationSession(supabaseClient, customerId);
    } else if (customerDetails) {
      // Booking flow - no existing customer
      const { name, email, phone } = customerDetails;
      if (!name || !email || !phone) {
        return new Response(
          JSON.stringify({ ok: false, error: 'customerDetails must include name, email, and phone' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      result = await createBookingVerificationSession(name, email, phone);
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
