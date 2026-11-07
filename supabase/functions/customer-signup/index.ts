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

    // Check if user already exists in auth. listUsers() returns ONE page (50
    // users) by default, and the platform has far more, so an existing login
    // was usually missed and createUser then failed with a generic error. Walk
    // every page.
    const wanted = String(email).trim().toLowerCase();
    let existingAuthUser: any = null;
    for (let page = 1; page <= 50 && !existingAuthUser; page++) {
      const { data: batch, error: listError } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
      if (listError) { console.error('listUsers failed:', listError.message); break; }
      const users = batch?.users ?? [];
      existingAuthUser = users.find((u: any) => (u.email ?? '').toLowerCase() === wanted) ?? null;
      if (users.length < 1000) break;
    }

    let authUserId = '';

    if (existingAuthUser) {
      // Already linked to a customer for THIS tenant? Then it's a real account.
      let alreadyLinkedQuery = supabaseAdmin
        .from('customer_users')
        .select('id')
        .eq('auth_user_id', existingAuthUser.id);
      if (tenant_id) alreadyLinkedQuery = alreadyLinkedQuery.eq('tenant_id', tenant_id);
      const { data: existingCustomerUser } = await alreadyLinkedQuery.maybeSingle();

      if (existingCustomerUser) {
        return new Response(
          JSON.stringify({ error: 'An account with this email already exists. Please log in instead.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // The login already exists but is not linked to THIS company. Three cases:
      //  1. The person proved they own it (the password they typed is its
      //     password): link this company to it, change nothing on the login.
      //  2. It is a true orphan — no customer link anywhere and not a staff
      //     login — left by a half-finished signup: reclaim it (below).
      //  3. Otherwise it belongs to someone — a customer at another company or
      //     a staff member. Resetting its password here let anyone take over
      //     that account by signing up with its email on any Drive247 site
      //     (QA sheet C13.7). Refuse instead.
      const anon = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } });
      const { error: pwError } = await anon.auth.signInWithPassword({ email: wanted, password });
      const ownsLogin = !pwError;

      if (ownsLogin) {
        authUserId = existingAuthUser.id;
        console.log('Existing login proved by password; linking this tenant:', authUserId);
      } else {
        const [{ count: linkCount }, { count: staffCount }] = await Promise.all([
          supabaseAdmin.from('customer_users').select('id', { count: 'exact', head: true }).eq('auth_user_id', existingAuthUser.id),
          supabaseAdmin.from('app_users').select('id', { count: 'exact', head: true }).eq('auth_user_id', existingAuthUser.id),
        ]);
        if ((linkCount ?? 0) > 0 || (staffCount ?? 0) > 0) {
          return new Response(
            JSON.stringify({
              error: 'This email already has a Drive247 login. Enter the password you use for it, or reset your password, to add this company to your account.',
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    }

    if (existingAuthUser && !authUserId) {
      // SELF-HEAL: a true orphan (see case 2 above) — no customer link and not
      // staff. Reclaim it: set the password just provided, confirm the email,
      // and fall through to create the customer + customer_users link below.
      const { error: reclaimError } = await supabaseAdmin.auth.admin.updateUserById(
        existingAuthUser.id,
        {
          password,
          email_confirm: true,
          user_metadata: {
            ...(existingAuthUser.user_metadata || {}),
            name: customer_name || existingAuthUser.user_metadata?.name || email.split('@')[0],
            type: 'customer',
          },
        }
      );

      if (reclaimError) {
        console.error('Failed to reclaim orphaned auth user:', reclaimError);
        return new Response(
          JSON.stringify({ error: 'Failed to recover your account. Please contact support.' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      authUserId = existingAuthUser.id;
      console.log('Reclaimed orphaned auth user:', authUserId);
    } else if (!existingAuthUser) {
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

      authUserId = authData.user.id;
    }

    let finalCustomerId = customer_id;

    // If no existing customer_id provided, reuse an existing customer for this
    // email+tenant if present (another orphan shape), else create a new one.
    if (!finalCustomerId) {
      // Case-blind: a record staff typed as "Pat@Example.com" is the same person
      // as a sign-up for "pat@example.com" (QA sheet C13.5).
      let existingCustomerQuery = supabaseAdmin
        .from('customers')
        .select('id')
        .ilike('email', wanted.replace(/[\\%_]/g, (c: string) => '\\' + c))
        .limit(1);
      if (tenant_id) existingCustomerQuery = existingCustomerQuery.eq('tenant_id', tenant_id);
      const { data: existingRows } = await existingCustomerQuery;
      const existingCustomer = existingRows?.[0] ?? null;

      if (existingCustomer) {
        finalCustomerId = existingCustomer.id;
        console.log('Reusing existing customer for tenant:', finalCustomerId);
      } else {
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
          // Clean up only a freshly-created auth user, never a reclaimed orphan
          if (!existingAuthUser) await supabaseAdmin.auth.admin.deleteUser(authUserId);
          return new Response(
            JSON.stringify({ error: 'Failed to create customer profile' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        finalCustomerId = newCustomer.id;
        console.log('Created new customer:', finalCustomerId);
      }
    } else {
      // Verify the customer exists and belongs to the tenant
      const { data: existingCustomer, error: fetchError } = await supabaseAdmin
        .from('customers')
        .select('id, tenant_id')
        .eq('id', customer_id)
        .single();

      if (fetchError || !existingCustomer) {
        console.error('Customer not found:', fetchError);
        if (!existingAuthUser) await supabaseAdmin.auth.admin.deleteUser(authUserId);
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
      // Clean up only a freshly-created auth user, never a reclaimed orphan
      if (!existingAuthUser) await supabaseAdmin.auth.admin.deleteUser(authUserId);
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
