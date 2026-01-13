import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface CustomerSignupRequest {
  email: string;
  password: string;
  customer_id?: string;  // Optional: link to existing customer from booking
  tenant_id?: string;    // Tenant for multi-tenancy
  customer_name?: string;
  customer_phone?: string;
}

Deno.serve(async (req) => {
  console.log('customer-signup function called');

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Service role client for admin operations
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const {
      email,
      password,
      customer_id,
      tenant_id,
      customer_name,
      customer_phone
    }: CustomerSignupRequest = await req.json();

    // Validate required fields
    if (!email || !password) {
      return new Response(
        JSON.stringify({ error: 'Email and password are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate password strength
    if (password.length < 8) {
      return new Response(
        JSON.stringify({ error: 'Password must be at least 8 characters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if user already exists in auth
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    const existingAuthUser = existingUsers?.users?.find(u => u.email === email);

    if (existingAuthUser) {
      // Check if they already have a customer_users record
      const { data: existingCustomerUser } = await supabaseAdmin
        .from('customer_users')
        .select('id')
        .eq('auth_user_id', existingAuthUser.id)
        .single();

      if (existingCustomerUser) {
        return new Response(
          JSON.stringify({ error: 'An account with this email already exists. Please log in instead.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Auth user exists but no customer_users record - this might be an admin
      // Don't allow creating a customer account
      return new Response(
        JSON.stringify({ error: 'This email is already associated with another account type' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create new user in Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm email
      user_metadata: {
        name: customer_name || email.split('@')[0],
        type: 'customer'
      }
    });

    if (authError || !authData.user) {
      console.error('Failed to create auth user:', authError);
      return new Response(
        JSON.stringify({ error: authError?.message || 'Failed to create account' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const authUserId = authData.user.id;
    let finalCustomerId = customer_id;

    // If no existing customer_id provided, create a new customer record
    if (!finalCustomerId) {
      const { data: newCustomer, error: customerError } = await supabaseAdmin
        .from('customers')
        .insert({
          email,
          name: customer_name || email.split('@')[0],
          phone: customer_phone || null,
          tenant_id: tenant_id || null,
          type: 'Individual',
          status: 'Active',
        })
        .select()
        .single();

      if (customerError) {
        console.error('Failed to create customer record:', customerError);
        // Clean up auth user
        await supabaseAdmin.auth.admin.deleteUser(authUserId);
        return new Response(
          JSON.stringify({ error: 'Failed to create customer profile' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      finalCustomerId = newCustomer.id;
      console.log('Created new customer:', finalCustomerId);
    } else {
      // Verify the customer exists and belongs to the tenant
      const { data: existingCustomer, error: fetchError } = await supabaseAdmin
        .from('customers')
        .select('id, tenant_id')
        .eq('id', customer_id)
        .single();

      if (fetchError || !existingCustomer) {
        console.error('Customer not found:', fetchError);
        await supabaseAdmin.auth.admin.deleteUser(authUserId);
        return new Response(
          JSON.stringify({ error: 'Customer record not found' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('Linking to existing customer:', finalCustomerId);
    }

    // Create the customer_users link
    const { data: customerUser, error: linkError } = await supabaseAdmin
      .from('customer_users')
      .insert({
        auth_user_id: authUserId,
        customer_id: finalCustomerId,
        tenant_id: tenant_id || null,
      })
      .select()
      .single();

    if (linkError) {
      console.error('Failed to create customer_users link:', linkError);
      // Clean up auth user
      await supabaseAdmin.auth.admin.deleteUser(authUserId);
      return new Response(
        JSON.stringify({ error: 'Failed to link account to customer profile' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create a welcome notification
    await supabaseAdmin
      .from('customer_notifications')
      .insert({
        customer_user_id: customerUser.id,
        tenant_id: tenant_id || null,
        title: 'Welcome to Drive247!',
        message: 'Your account has been created successfully. You can now view your bookings and manage your profile.',
        type: 'welcome',
      });

    console.log('Customer signup completed:', {
      auth_user_id: authUserId,
      customer_id: finalCustomerId,
      customer_user_id: customerUser.id
    });

    return new Response(
      JSON.stringify({
        success: true,
        user_id: authUserId,
        customer_user_id: customerUser.id,
        customer_id: finalCustomerId,
        message: 'Account created successfully'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
